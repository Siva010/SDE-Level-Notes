# Database Indexing — Production (Part 1)

[Part 2 T6-T10 →](3_production_part2.md)

## Table of Contents

- [T1. Why Indexes Exist](#t1-why-indexes-exist)
- [T2. Heap Files and Row Identifiers](#t2-heap-files-and-row-identifiers)
- [T3. B-Tree Index Structure](#t3-b-tree-index-structure)
- [T4. Clustered and Secondary Indexes](#t4-clustered-and-secondary-indexes)
- [T4.1. Covering Indexes and Index Only Scans](#t4-1-covering-indexes-and-index-only-scans)
- [T5. Composite Index Column Order](#t5-composite-index-column-order)

## T1. Why Indexes Exist

<sub>Levels: [Foundation](0_foundation_part1.md#t1-why-indexes-exist) · [Understand](1_understand_part1.md#t1-why-indexes-exist) · [Interview](2_interview_part1.md#t1-why-indexes-exist) · Production</sub>

### Creating indexes without taking the table down

**Current approach — PostgreSQL 8.2 and later:** `CREATE INDEX CONCURRENTLY`. It does two
passes over the table and never takes a lock that blocks writes.

**Legacy approach — plain `CREATE INDEX`:** takes a `SHARE` lock for the whole build, blocking
every write to the table until it finishes. On a large table that is an outage, and it is still
the default if you forget the keyword. There is one legitimate use left: inside a transaction
that created the table, where nothing else can see it yet, and during bulk loads where the table
is not serving traffic.

```sql
CREATE INDEX CONCURRENTLY orders_email_idx ON orders (email);
-- cannot run inside a transaction block; if it fails it leaves an INVALID index behind
DROP INDEX CONCURRENTLY orders_email_idx;
```

> ⚠️ **Warning:** A failed `CREATE INDEX CONCURRENTLY` leaves an invalid index that still costs
> writes but is never used for reads. Check for them after every failed migration:
> `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`

### Rules that hold up

- **Index for the query, not for the column.** Start from the slow statement and its plan;
  never from a list of column names.
- **One composite index usually beats two single-column ones** when the predicates always appear
  together — one descent instead of a bitmap intersection (T5).
- **Every index needs a named owner query.** Write it in the migration comment. An index whose
  reason is forgotten never gets dropped.

### Finding the ones that matter

```sql
-- slowest statements by total time (requires pg_stat_statements)
SELECT calls, round(mean_exec_time::numeric, 2) AS ms, query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;

-- indexes nothing has used since the last stats reset
SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC;
```

Check `idx_scan` on replicas too. A reporting replica is often the only consumer of an index,
and the primary's counters will not show it.

### Debugging scenario

An index was added to fix a slow endpoint. The endpoint is unchanged, and now inserts are 30%
slower.

<details><summary>Cause and fix</summary>

The index is not being used, and it is not free. Most likely causes, in order: the predicate
does not match the index's leading column (T5); the query wraps the column in a function, so it
needs an expression index (T9); or `CREATE INDEX CONCURRENTLY` failed and left an invalid index,
which is maintained on write and ignored on read.

Confirm with `EXPLAIN (ANALYZE, BUFFERS)` on the real statement with real parameters, and check
`pg_index.indisvalid`. Drop the index if the plan does not name it.

</details>

## T2. Heap Files and Row Identifiers

<sub>Levels: [Foundation](0_foundation_part1.md#t2-heap-files-and-row-identifiers) · [Understand](1_understand_part1.md#t2-heap-files-and-row-identifiers) · [Interview](2_interview_part1.md#t2-heap-files-and-row-identifiers) · Production</sub>

### Keeping updates HOT

The single highest-leverage tuning decision on an update-heavy table is whether its updates
avoid index maintenance. Two things control it: which columns are indexed, and whether the page
has room.

```sql
ALTER TABLE sessions SET (fillfactor = 80);   -- leave 20% for new row versions
VACUUM FULL sessions;                          -- rewrite so the new fillfactor takes effect
```

```sql
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables ORDER BY n_tup_upd DESC LIMIT 10;
```

A HOT ratio below about 50% on a hot table is worth investigating. The usual culprit is an index
on a column that changes on every update — `last_seen_at`, `status`, a counter.

### Anti-pattern: the indexed mutable timestamp

```sql
-- what it looks like
CREATE INDEX sessions_last_seen_idx ON sessions (last_seen_at);
UPDATE sessions SET last_seen_at = now() WHERE id = $1;   -- every request
```

Every request now performs a delete-and-insert in a B-tree, at a position that moves rightwards
constantly, and disqualifies the update from HOT. The fix is to decide whether the query that
needs that index is worth it — usually it is a cleanup job that can accept a sequential scan
during a quiet hour, or it can be served by a partial index over only the rows old enough to
matter (T9).

### Vacuum is a reliability concern, not just housekeeping

Dead row versions inflate every scan and every index. When autovacuum falls behind on a
high-churn table the symptoms are gradual: plans stay the same, timings drift upward, index-only
scans start reporting heap fetches (T4.1).

```sql
ALTER TABLE sessions SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 500);
SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;
```

> ✅ **Best Practice:** Tune autovacuum per table on the few tables that churn, rather than
> globally. The default scale factor of 0.2 means a 50-million-row table waits for ten million
> dead rows before a vacuum starts.

### Debugging scenario

A table's on-disk size has tripled in a month, but `count(*)` is flat. Reads are slower and
`VACUUM` runs constantly without shrinking anything.

<details><summary>Cause and fix</summary>

Bloat held open by long-running transactions. `VACUUM` cannot reclaim a dead row version that is
still visible to an open snapshot, so a forgotten `idle in transaction` connection — or a
long-running analytics query on a replica with `hot_standby_feedback` on — pins every dead row
since it started.

Find it with `SELECT pid, state, xact_start, query FROM pg_stat_activity ORDER BY xact_start;`,
terminate or fix the offender, then reclaim space with `pg_repack` (online) or `VACUUM FULL`
(takes an exclusive lock). Set `idle_in_transaction_session_timeout` so it cannot recur silently.

</details>

## T3. B-Tree Index Structure

<sub>Levels: [Foundation](0_foundation_part1.md#t3-b-tree-index-structure) · [Understand](1_understand_part1.md#t3-b-tree-index-structure) · [Interview](2_interview_part1.md#t3-b-tree-index-structure) · Production</sub>

### Key width is a cache decision

Fanout falls as keys widen, and a deeper tree means more page reads per lookup and a larger
resident working set. A 320-character email as a primary key is not merely wasteful on disk; it
is fewer keys per page at every level, in every index that references it.

```sql
-- what it looks like
CREATE TABLE memberships (
  org_slug   text,      -- up to 200 chars
  user_email text,      -- up to 320 chars
  PRIMARY KEY (org_slug, user_email)
);
```

The fix is a surrogate key with a unique constraint on the natural pair. The natural key is
still enforced; it just stops being what every other index carries around.

### Index bloat and rebuilds

**Current approach — PostgreSQL 12 and later:** `REINDEX CONCURRENTLY`, which rebuilds without
blocking writes.

**Legacy approach — `REINDEX` (blocking), or the `CREATE INDEX CONCURRENTLY` + rename dance**
that everyone wrote before 12. The blocking form is still correct for maintenance windows and
for indexes on tables nothing is writing to; the manual dance has no remaining use on a
supported version.

```sql
REINDEX INDEX CONCURRENTLY orders_created_idx;

-- how bloated is it, roughly: compare index size against live tuples
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size, idx_scan
FROM pg_stat_user_indexes WHERE relname = 'orders';
```

Bloat comes mostly from random-key insert patterns and from mass deletes that empty leaves
without merging them. PostgreSQL 13 added deduplication of repeated keys in B-trees, which
substantially shrinks indexes on low-cardinality columns ⚠️ verify — worth measuring before
assuming an old sizing rule still applies.

### Where it surfaces in the ecosystem

- Every ORM's `add_index` / `@Index` emits a plain B-tree unless told otherwise, and most
  default to *not* concurrent. Check what your migration tool generates before it runs on a
  large table.
- Django's `Meta.indexes`, Rails' `add_index … algorithm: :concurrently`, and Prisma's
  `@@index` all map to the same `CREATE INDEX`; the difference is only in the lock they take.

### Debugging scenario

A nightly job inserts 20 million rows into an empty table that already has five indexes. It
takes six hours and the machine is not CPU-bound.

<details><summary>Cause and fix</summary>

The indexes are being maintained per row, with random-ish keys splitting pages across five trees
while the buffer cache thrashes. The standard fix is to drop the indexes, load, then rebuild:
building an index in one pass over sorted data is dramatically cheaper than a page split per
insert, and it produces a dense index rather than a half-full one.

Load with `COPY` rather than row-by-row `INSERT`, rebuild indexes afterwards, then `ANALYZE` so
the planner sees the new distribution before the first morning query (T6).

</details>

## T4. Clustered and Secondary Indexes

<sub>Levels: [Foundation](0_foundation_part1.md#t4-clustered-and-secondary-indexes) · [Understand](1_understand_part1.md#t4-clustered-and-secondary-indexes) · [Interview](2_interview_part1.md#t4-clustered-and-secondary-indexes) · Production</sub>

### Choosing a primary key

**Current approach:** a narrow, monotonically increasing key — `bigint` identity, or UUIDv7 when
ids must be generated client-side or merged across systems.

**Legacy approach — random UUIDv4 as the primary key:** still common in codebases written
between roughly 2015 and 2022, when v4 was the only widely available UUID version. It remains
legitimate where ids must be unguessable *and* the table is small or write-light. On a large
InnoDB table it fragments the table itself, since the table *is* the primary key index; on
PostgreSQL it fragments the primary key index and every index that shares its insert pattern.

```sql
-- PostgreSQL 16: identity column, narrow and sequential
CREATE TABLE orders (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id  uuid NOT NULL DEFAULT gen_random_uuid(),   -- unguessable id for URLs
  UNIQUE (public_id)
);
```

Keeping the internal key sequential and exposing a random one externally gets both properties,
at the cost of one extra unique index.

### Physical correlation

PostgreSQL's planner tracks how well a column's order matches physical row order, as
`pg_stats.correlation`. A high correlation makes range scans on that column nearly sequential; a
low one makes them scattered random reads and pushes the planner toward a bitmap scan or a
sequential scan.

```sql
SELECT attname, correlation FROM pg_stats WHERE tablename = 'orders';
CLUSTER orders USING orders_created_idx;   -- one-time, takes an ACCESS EXCLUSIVE lock
```

`CLUSTER` is a maintenance operation, not a schema property — new rows go wherever there is
space, so correlation decays. It is worth doing for an append-mostly table that was loaded out of
order; it is not a substitute for a clustered index.

### Debugging scenario

Two identical schemas — one MySQL, one PostgreSQL — and a query on a secondary index is
noticeably slower on MySQL despite better hardware.

<details><summary>Cause and fix</summary>

The InnoDB secondary lookup is two B-tree descents, and the primary key is wide, so every
secondary index entry carries a large copy of it and fanout suffers twice over.

Fix it by narrowing the primary key, or by covering the query so the second descent disappears
(T4.1). Covering is the larger win on InnoDB precisely because it removes a whole tree traversal
rather than a single page fetch.

</details>

## T4.1. Covering Indexes and Index Only Scans

<sub>Levels: [Foundation](0_foundation_part1.md#t4-1-covering-indexes-and-index-only-scans) · [Understand](1_understand_part1.md#t4-1-covering-indexes-and-index-only-scans) · [Interview](2_interview_part1.md#t4-1-covering-indexes-and-index-only-scans) · Production</sub>

### Where covering earns its size

Covering is worth it for a hot, narrow query — a dashboard count, a lookup returning two
columns, an existence check. It is a bad trade for `SELECT *`, and it is a bad trade when the
payload is wide enough to double the index.

```sql
-- current approach: payload columns in INCLUDE, PostgreSQL 11+
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at) INCLUDE (total_cents);

-- legacy approach: payload columns appended to the key, pre-11
CREATE INDEX orders_customer_idx_old ON orders (customer_id, created_at, total_cents);
```

The legacy form still works and is still what you will find in older migrations. It is worse in
two ways: the payload widens every level of the tree rather than only the leaves, and the index
can no longer be used to enforce a unique constraint on the real key columns. It remains the only
option on databases older than 11.

### Measure the fetches, not the plan name

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT created_at, total_cents FROM orders WHERE customer_id = 7;
```

```text
Index Only Scan using orders_customer_idx on orders
  (actual time=0.021..0.104 rows=38 loops=1)
  Heap Fetches: 0
  Buffers: shared hit=5
```

`Heap Fetches: 0` is the win. Anything large means the visibility map is stale and the plan is
doing the work it was supposed to avoid — an autovacuum tuning problem (T2), not an index
problem.

### Anti-pattern: covering everything

```sql
-- what it looks like
CREATE INDEX orders_everything_idx ON orders (customer_id)
  INCLUDE (created_at, status, total_cents, notes, shipping_address, billing_address);
```

The index approaches the size of the table, so it stops fitting in cache, evicts pages other
queries need, and slows every write. Cover the two columns the hot query returns, and let the
rest come from the heap.

### Debugging scenario

A covering index was added for a dashboard query. It helped for a week, then the query drifted
back to its old latency. Nothing was deployed.

<details><summary>Cause and fix</summary>

Write churn outgrew autovacuum, so the visibility map no longer marks most pages all-visible and
the index-only scan fell back to heap fetches. `EXPLAIN (ANALYZE)` will show `Heap Fetches`
climbing over the period.

Fix it by tuning autovacuum for that table — a lower `autovacuum_vacuum_scale_factor` — rather
than by touching the index. Track `Heap Fetches` for the query as a monitored number, since the
plan node name stays reassuringly identical while the behaviour degrades.

</details>

## T5. Composite Index Column Order

<sub>Levels: [Foundation](0_foundation_part1.md#t5-composite-index-column-order) · [Understand](1_understand_part1.md#t5-composite-index-column-order) · [Interview](2_interview_part1.md#t5-composite-index-column-order) · Production</sub>

### Design from the query set

For every hot query, write down the equality columns, the range column and the sort column. The
index is: equalities in any order, then the range or sort column. Then look for indexes whose
key list is a leading prefix of another's — those are pure cost.

```sql
-- redundant: fully served by orders_customer_created_idx
DROP INDEX orders_customer_idx;
CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at);
```

```sql
-- find prefix-redundant indexes
SELECT indexrelid::regclass AS idx, indrelid::regclass AS tbl, indkey
FROM pg_index WHERE indrelid = 'orders'::regclass;
```

> 🎯 **Interview Note:** Ordering composite columns "most selective first" is a rule of thumb
> that survives from single-table textbook examples. What actually decides is which columns the
> query constrains with equality, and which one it ranges or sorts on.

### Multi-tenant tables

Almost every predicate in a multi-tenant schema starts with the tenant. Leading every composite
index with `tenant_id` is correct even though its cardinality is low: it is always an equality,
it makes each tenant's rows contiguous, and it turns cross-tenant leakage in a missing-predicate
bug into an obvious plan regression.

```sql
CREATE INDEX events_tenant_time_idx ON events (tenant_id, occurred_at DESC);
```

### Keyset pagination

`OFFSET 100000` reads and discards 100,000 rows on every page. With the sort column in the
index, keyset pagination reads only the page it returns.

```sql
-- current approach
SELECT * FROM events
WHERE tenant_id = $1 AND (occurred_at, id) < ($2, $3)
ORDER BY occurred_at DESC, id DESC
LIMIT 50;

-- legacy approach, still everywhere: cost grows with page number
SELECT * FROM events WHERE tenant_id = $1 ORDER BY occurred_at DESC OFFSET $2 LIMIT 50;
```

`OFFSET` remains reasonable for small, bounded result sets and for admin screens nobody pages
deeply into. It stops being reasonable the moment a crawler walks to page 4,000.

### Debugging scenario

A feed query is fast for most tenants and times out for the three largest ones. Same plan
shape for everybody.

<details><summary>Cause and fix</summary>

The index is `(occurred_at, tenant_id)` or the sort is not covered, so the plan filters after
ordering. For small tenants the filtered set is small enough that nobody notices; for large ones
the sort spills to disk.

Reorder to `(tenant_id, occurred_at DESC)` so each tenant's rows are contiguous and already
ordered, then confirm the Sort node has disappeared from the plan and that `LIMIT` stops the
scan early rather than after sorting everything.

</details>

[Part 2 T6-T10 →](3_production_part2.md)
