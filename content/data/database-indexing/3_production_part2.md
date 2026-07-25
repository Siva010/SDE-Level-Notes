# Database Indexing — Production (Part 2)

[← Part 1 T1-T5](3_production_part1.md)

## Table of Contents

- [T6. Selectivity and Cardinality](#t6-selectivity-and-cardinality)
- [T7. Write Amplification from Indexes](#t7-write-amplification-from-indexes)
- [T8. Hash Indexes](#t8-hash-indexes)
- [T9. Partial and Expression Indexes](#t9-partial-and-expression-indexes)
- [T10. Reading a Query Plan](#t10-reading-a-query-plan)

## T6. Selectivity and Cardinality

<sub>Levels: [Foundation](0_foundation_part2.md#t6-selectivity-and-cardinality) · [Understand](1_understand_part2.md#t6-selectivity-and-cardinality) · [Interview](2_interview_part2.md#t6-selectivity-and-cardinality) · Production</sub>

### Statistics are an operational concern

The planner is only as good as its statistics, and statistics go stale exactly when it matters
most — after a bulk load, after a backfill, after a migration that rewrites a column.

```sql
-- always the last step of a load, before traffic arrives
ANALYZE orders;

-- more detail on a skewed or high-cardinality column
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 500;
ANALYZE orders;
```

Raising `STATISTICS` for a column grows its most-common-values list and histogram, which costs a
little more `ANALYZE` time and helps precisely where the default 100 buckets smooth over the
distribution you care about.

### Correlated predicates

```sql
-- what it looks like: estimate 40 rows, actual 380,000
SELECT * FROM addresses WHERE city = 'Paris' AND country = 'FR';
```

The planner multiplies the two selectivities as if they were independent, so a Nested Loop that
would be right for 40 rows is chosen for 380,000. Extended statistics fix the estimate at the
source:

```sql
CREATE STATISTICS addresses_city_country (dependencies, ndistinct) ON city, country FROM addresses;
ANALYZE addresses;
```

### Tuning the cost model for the hardware

**Current approach:** on SSD or cloud block storage, lower `random_page_cost` toward
`seq_page_cost` — 1.1 is a common setting ⚠️ verify against your own measurements.

**Legacy approach:** the default 4.0, which encodes the seek cost of a spinning disk. It is
correct for the hardware it was written for and is still the default today, which means a
modern instance is running a 1990s storage model unless someone changed it.

```sql
ALTER SYSTEM SET random_page_cost = 1.1;
SELECT pg_reload_conf();
```

> ⚠️ **Warning:** Change it on a staging copy with production statistics first. It shifts plan
> choices across every query at once, which is exactly as large a change as it sounds.

### What to watch

| Signal | Where | What it means |
|---|---|---|
| `last_analyze`, `last_autoanalyze` | `pg_stat_user_tables` | how old the estimates are |
| `n_mod_since_analyze` | `pg_stat_user_tables` | how much changed since then |
| `n_distinct = -1` | `pg_stats` | the column is unique; a good lookup candidate |
| `correlation` near ±1 | `pg_stats` | range scans on it are near-sequential (T4) |

A table with millions of modifications since its last analyze is a plan incident waiting for
the next deploy to be blamed for it. Alerting on `n_mod_since_analyze` relative to row count
catches it while it is still cheap.

### Debugging scenario

A query is fast from psql and slow from the application, byte-identical SQL, same database.

<details><summary>Cause and fix</summary>

The application uses a prepared statement, and after five executions PostgreSQL may switch to a
generic plan built from average selectivity rather than the actual parameter values. On a skewed
column the generic plan is wrong for the values the application actually sends.

Confirm by comparing `EXPLAIN` for a generic plan against the value-specific one. Set
`plan_cache_mode = force_custom_plan` for that workload, or pass the value as a literal where
the skew is known. The same mechanism explains "it got slow after the sixth call".

</details>

## T7. Write Amplification from Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t7-write-amplification-from-indexes) · [Understand](1_understand_part2.md#t7-write-amplification-from-indexes) · [Interview](2_interview_part2.md#t7-write-amplification-from-indexes) · Production</sub>

### Budget indexes like any other resource

A useful working rule for an OLTP table in the write path: every index past the fourth or fifth
needs a named query and a measured win. Reporting queries usually belong on a replica, where an
index costs the replica's writes rather than the primary's.

```sql
-- what the write path costs today
SELECT relname,
       pg_size_pretty(pg_relation_size(relid))       AS heap,
       pg_size_pretty(pg_indexes_size(relid))        AS indexes,
       n_tup_ins, n_tup_upd, n_tup_del
FROM pg_stat_user_tables ORDER BY pg_indexes_size(relid) DESC LIMIT 10;
```

When index size exceeds heap size on a write-heavy table, that is a finding, not a curiosity.

### Dropping an index safely

```sql
-- reversible check: hide it from the planner inside one transaction
BEGIN;
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'orders_status_idx'::regclass;
EXPLAIN ANALYZE SELECT …;   -- confirm nothing regresses
ROLLBACK;
```

Then drop it for real with `DROP INDEX CONCURRENTLY`. Reset `pg_stat_user_indexes` counters
before a full business cycle rather than reading them at an arbitrary moment — a monthly report
is easy to miss in a week-long sample.

### Bulk write patterns

- **Load then index.** For large loads, drop or defer indexes, `COPY`, rebuild, `ANALYZE`.
  Rebuilding sorts once instead of splitting pages per row (T3).
- **Batch, do not trickle.** Ten thousand single-row inserts in autocommit are ten thousand
  transactions, each flushing write-ahead log for every index.
- **Watch the primary key pattern.** Random keys spread the writes across the whole index; on a
  checkpoint, that is far more dirty pages to flush.

> ✅ **Best Practice:** Treat "add an index" in a migration review the same as "add a
> dependency": name the query it serves, and say what will drop it when that query goes away.

### The cost lands on replicas too

Index maintenance is written to the write-ahead log, so every index on the primary is also
replay work on every replica. A replica replays serially, so a write-heavy primary with many
indexes is a common and badly-understood source of replication lag — the replica is not slow,
it is doing the same index work with less parallelism.

```sql
SELECT client_addr, state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_bytes
FROM pg_stat_replication;
```

If lag correlates with write bursts rather than with query load on the replica, count the
indexes before reaching for a bigger replica.

### Debugging scenario

Write latency spikes every few minutes on an otherwise healthy database. Reads are unaffected,
and the spikes line up with nothing in the application.

<details><summary>Cause and fix</summary>

Checkpoints. Random-key inserts dirty pages spread across every index, and at each checkpoint
all of them are flushed at once, saturating the disk.

Confirm with `log_checkpoints = on` and look at buffers written per checkpoint. Spread the work
by raising `max_wal_size` and keeping `checkpoint_completion_target` at its modern default, and
attack the cause by moving to a sequential or time-ordered key so writes concentrate in far
fewer pages (T4).

</details>

## T8. Hash Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t8-hash-indexes) · [Understand](1_understand_part2.md#t8-hash-indexes) · [Interview](2_interview_part2.md#t8-hash-indexes) · Production</sub>

### When to reach for one, honestly

The case that survives contact with production is a long text value compared only with `=`: a
URL, a rendered template, a serialized payload. There the B-tree stores the whole value in every
level it appears in, and the hash index stores 32 bits.

```sql
-- current approach where the value is long and only ever compared with =
CREATE INDEX pages_url_hash ON pages USING hash (url);

-- legacy approach, from before hash indexes were crash-safe: index a hash column by hand
ALTER TABLE pages ADD COLUMN url_md5 text GENERATED ALWAYS AS (md5(url)) STORED;
CREATE INDEX pages_url_md5_idx ON pages (url_md5);
```

The hand-rolled hash column was the standard workaround before PostgreSQL 10, and it is still
the portable answer on databases without a usable hash index type. Its remaining advantage is
that it works on any engine and can participate in a composite index; its cost is a visible
column that every writer must not touch.

### Operational caveats

- Hash indexes cannot back a `UNIQUE` constraint, so a uniqueness requirement rules them out
  regardless of access pattern.
- They are single-column, so they cannot serve any query that also constrains a second column
  through the same index.
- Measure before adopting: on short keys the size win is small and the flexibility loss is total.

```sql
SELECT pg_size_pretty(pg_relation_size('pages_url_hash')) AS hash_size,
       pg_size_pretty(pg_relation_size('pages_url_btree_idx')) AS btree_size;
```

### Debugging scenario

A hash index was created on a URL column, and a lookup that used it in staging does a sequential
scan in production.

<details><summary>Cause and fix</summary>

The production query is not a bare equality. Common culprits: an `ORDER BY url` added for stable
pagination, a `LIKE 'prefix%'` introduced by a search box, or a join on the column with a range
condition — none of which a hash index can serve.

Check the plan and the actual statement, then either revert to a B-tree, which handles all of
these, or keep both if the equality path genuinely dominates and the size win is measured. In
most cases the B-tree alone is the right answer.

</details>

## T9. Partial and Expression Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t9-partial-and-expression-indexes) · [Understand](1_understand_part2.md#t9-partial-and-expression-indexes) · [Interview](2_interview_part2.md#t9-partial-and-expression-indexes) · Production</sub>

### The three that pay for themselves

```sql
-- 1. work queue: tiny index over a huge table
CREATE INDEX jobs_pending_idx ON jobs (run_after) WHERE state = 'pending';

-- 2. case-insensitive uniqueness and lookup in one object
CREATE UNIQUE INDEX users_lower_email_idx ON users (lower(email));

-- 3. at most one active subscription per user
CREATE UNIQUE INDEX subs_one_active_idx ON subscriptions (user_id) WHERE status = 'active';
```

The third is the one people reach for a trigger or an application-level check to enforce. A
partial unique index does it in the database, correctly, under concurrency.

### Soft deletes

**Current approach:** a partial index over live rows only.

```sql
CREATE INDEX orders_customer_live_idx ON orders (customer_id) WHERE deleted_at IS NULL;
```

**Legacy approach:** `deleted_at IS NULL` bolted onto every composite index as a leading boolean
column, or no index and a filter. The composite form still works and is required if the query
sometimes wants deleted rows too — but it indexes rows nobody queries, and it keeps maintaining
them long after they stop mattering.

Note the matching requirement: queries must literally include `WHERE deleted_at IS NULL` for the
partial index to apply. An ORM's default scope usually does; a hand-written report often does
not.

### Expression indexes and ORMs

```sql
-- what it looks like: an ORM emitting a function the index doesn't share
SELECT * FROM users WHERE lower(email) = lower($1);          -- uses users_lower_email_idx
SELECT * FROM users WHERE email ILIKE $1;                     -- does not
```

`ILIKE` without wildcards looks equivalent and is not — it is not the same expression, and it
does not use an index on `lower(email)`. Either normalise the query to the indexed expression, or
add a trigram index if genuine pattern matching is required.

> 💡 **Tip:** Put the exact indexed expression in a comment above the query in application code.
> The failure mode is silent: someone edits the expression slightly and the index quietly stops
> being used.

### Debugging scenario

A queue table's polling query degrades steadily over a month, then recovers instantly after a
manual `REINDEX`.

<details><summary>Cause and fix</summary>

The partial index accumulated dead entries faster than autovacuum removed them. Every completed
job leaves a dead entry until vacuum runs, and with a small index and a high completion rate the
dead-to-live ratio climbs quickly — so scanning "two thousand pending jobs" actually walks tens
of thousands of dead entries.

Tune autovacuum aggressively for that table rather than scheduling a periodic `REINDEX`: a low
`autovacuum_vacuum_scale_factor` with a small threshold keeps the index at its real size. The
instant recovery after `REINDEX` is the diagnostic — it says the structure, not the plan, was the
problem.

</details>

## T10. Reading a Query Plan

<sub>Levels: [Foundation](0_foundation_part2.md#t10-reading-a-query-plan) · [Understand](1_understand_part2.md#t10-reading-a-query-plan) · [Interview](2_interview_part2.md#t10-reading-a-query-plan) · Production</sub>

### Read plans from production, not from your laptop

A plan is only meaningful against the data distribution and statistics that produced it. A local
database with 200 rows will not reproduce anything.

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT … ;   -- with the parameters the application actually sends
```

For statements you cannot run interactively, `auto_explain` captures plans for anything slower
than a threshold:

```sql
LOAD 'auto_explain';
SET auto_explain.log_min_duration = '500ms';
SET auto_explain.log_analyze = true;
SET auto_explain.log_buffers = true;
```

### What to check, in order

1. **Estimated versus actual rows** at each node. Order-of-magnitude divergence means the
   statistics are the problem (T6), not the index.
2. **`Rows Removed by Filter`.** Large numbers say a predicate is not in the index (T5).
3. **`Heap Fetches`** on an index-only scan. Large numbers say vacuum, not indexing (T4.1).
4. **`loops=`** on the inner side of a Nested Loop. Per-loop time times loops is the real cost.
5. **`Buffers: shared read`** versus `hit`. High reads mean the working set does not fit in
   cache.

### Anti-pattern: tuning by adding indexes

```sql
-- what it looks like
CREATE INDEX ON orders (status);
CREATE INDEX ON orders (customer_id);
CREATE INDEX ON orders (created_at);
CREATE INDEX ON orders (status, created_at);
-- …six months later, nine indexes and the original query is still slow
```

Every index was added without reading a plan afterwards to confirm it was used. The discipline
that prevents this is small: capture the plan before, add the index, capture the plan after, and
drop it if the plan did not change.

### Make plans reviewable

Plans are worth treating as artefacts rather than as things you look at during an incident.

```sql
-- machine-readable, diffable between two runs
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT … ;
```

- Attach the before-and-after plan to any pull request that adds or drops an index. It makes
  the claim checkable by someone who was not there.
- Keep `pg_stat_statements` on permanently. Without it, "which query regressed" is answered by
  guessing.
- In CI, run the important statements against a seeded database and fail on a `Seq Scan` where
  an index scan is expected. It is a blunt check and it still catches the migration that
  silently dropped the index the query needed.

### Debugging scenario

An endpoint's p99 latency doubled overnight. No deploy, no schema change, and the plan for the
main query looks reasonable when you run it by hand.

<details><summary>Cause and fix</summary>

Almost always a plan flip driven by data, not by code: a table crossed a size threshold, a bulk
import skewed a distribution, or autovacuum reset statistics and a Nested Loop became viable
where a Hash Join was chosen before. Running it by hand with a typical parameter reproduces the
good plan, not the bad one.

Capture real plans with `auto_explain` filtered to that statement, compare against the parameter
values in the slow requests, then fix the estimate — `ANALYZE`, higher statistics target, or
extended statistics (T6). Reach for an index change only after the estimates are right, because
an index chosen against wrong estimates is the next incident.

</details>

[← Part 1 T1-T5](3_production_part1.md)
