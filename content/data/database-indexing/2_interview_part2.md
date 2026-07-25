# Database Indexing — Interview (Part 2)

[← Part 1 T1-T5](2_interview_part1.md)

## Table of Contents

- [T6. Selectivity and Cardinality](#t6-selectivity-and-cardinality)
- [T7. Write Amplification from Indexes](#t7-write-amplification-from-indexes)
- [T8. Hash Indexes](#t8-hash-indexes)
- [T9. Partial and Expression Indexes](#t9-partial-and-expression-indexes)
- [T10. Reading a Query Plan](#t10-reading-a-query-plan)

## T6. Selectivity and Cardinality

<sub>Levels: [Foundation](0_foundation_part2.md#t6-selectivity-and-cardinality) · [Understand](1_understand_part2.md#t6-selectivity-and-cardinality) · Interview · [Production](3_production_part2.md#t6-selectivity-and-cardinality)</sub>

### Definition

Cardinality is the number of distinct values in a column. Selectivity is the fraction of rows a
predicate keeps — lower fraction, higher selectivity.

### Why It Exists

The planner has to choose between an index scan and a sequential scan without running either.
Selectivity is the estimate that decides, and cardinality is its main input.

### Interview Explanation

`ANALYZE` samples the table and records, per column, the number of distinct values, the null
fraction, the most common values with their frequencies, and a histogram for the rest. From
those the planner estimates how many rows a predicate will keep, then prices two plans: a
sequential scan at roughly one unit per page, or an index scan plus one random heap fetch per
matching row, charged at `random_page_cost`. The index wins only when it eliminates enough of
the table to cover those random fetches. That is why a highly selective predicate uses the index
and an unselective one on the same column does not.

### Syntax

```sql
ANALYZE orders;
SELECT n_distinct, most_common_vals, correlation
FROM pg_stats WHERE tablename = 'orders' AND attname = 'status';
CREATE STATISTICS orders_city_country (dependencies) ON city, country FROM orders;
```

### Example

```sql
-- 2% of rows: Index Scan
SELECT * FROM people WHERE country = 'FR';
-- 61% of rows: Seq Scan, from the same index on the same column
SELECT * FROM people WHERE country = 'US';
```

### Common Interview Questions

- **What is selectivity?** The fraction of rows a predicate keeps. Highly selective means few
  rows survive.
- **Why is a boolean column usually a bad index?** Two distinct values means no predicate on it
  alone can be selective; the planner will prefer a scan.
- **Where do the estimates come from?** Statistics gathered by `ANALYZE`, stored in `pg_stats`.

### Follow-up Questions

- **Why does the planner underestimate `city = 'Paris' AND country = 'France'`?** It assumes
  independence and multiplies the two selectivities, but the columns are almost perfectly
  correlated. `CREATE STATISTICS … (dependencies)` teaches it the correlation.
- **How can the same prepared statement be fast for one parameter and slow for another?**
  With a generic plan, the planner uses average selectivity rather than the value's actual
  frequency, so a skewed column gets a plan tuned for neither extreme.

### Comparisons

| Axis | High cardinality column | Low cardinality column |
|---|---|---|
| Use case | direct lookups: email, user id | grouping, or a partial index predicate |
| Typical selectivity | very high | very low |
| Standalone index | usually worth it | usually ignored by the planner |
| Composite position | leading column | leading only if always an equality |
| Better alternative | none needed | partial index on the value (T9) |
| Pick this when… | the predicate identifies few rows | the value is a filter, not a locator |

### Complexity

Estimation is `O(1)` per predicate against stored statistics; the cost is in `ANALYZE`, which
samples rather than reading the whole table — controlled by `default_statistics_target`.

### Common Mistakes

- Indexing `is_deleted` or `status` alone and expecting a lookup.
- Judging an index by whether it exists rather than by whether the plan uses it.
- Forgetting to `ANALYZE` after a bulk load, then blaming the index.

### Important Facts to Remember

- `random_page_cost` defaults to 4.0 and `seq_page_cost` to 1.0; on SSDs the ratio is wrong and
  usually worth lowering.
- Most-common-value statistics are what make skewed columns work.
- Predicate selectivities are multiplied as if independent unless extended statistics exist.
- Estimated-versus-actual row counts are the first thing to read in a plan.

### Mock Follow-up

**Interviewer:** After a nightly bulk load, the first queries of the day are catastrophically
slow, then recover. Why?

**Strong answer:** The load invalidated the statistics — autovacuum's `ANALYZE` has not caught
up, so the planner is estimating against yesterday's distribution and picking wrong plans. Once
autovacuum runs, estimates recover. The fix is to run `ANALYZE` explicitly as the last step of
the load rather than waiting for autovacuum.

**Weak answer:** "Cold cache. It warms up after the first few queries."

## T7. Write Amplification from Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t7-write-amplification-from-indexes) · [Understand](1_understand_part2.md#t7-write-amplification-from-indexes) · Interview · [Production](3_production_part2.md#t7-write-amplification-from-indexes)</sub>

### Definition

Write amplification is the multiplication of a single logical write into one physical write per
structure that must stay consistent with it — the table plus every index on it.

### Why It Exists

An index is a redundant copy. Redundancy is what makes reads fast and what makes writes
expensive; there is no way to have one without the other.

### Interview Explanation

An insert into a table with five indexes is six writes, each with its own tree descent, its own
page modification and its own write-ahead log record. Deletes are the same. Updates are worse
than either: if an indexed column changes, that index must delete the old entry and insert a new
one, usually in a different leaf. In PostgreSQL there is an escape hatch — a HOT update, where
no indexed column changed and the new version fits on the same page, skips index maintenance
entirely. That makes "which columns are indexed" a direct control on update throughput.

### Example

```sql
-- three indexes plus the primary key: one insert, four writes
CREATE INDEX ON orders (customer_id);
CREATE INDEX ON orders (status);
CREATE INDEX ON orders (created_at);

-- leave room on the page so updates can stay HOT
ALTER TABLE orders SET (fillfactor = 85);
```

### Common Interview Questions

- **How many structures does an insert touch?** The table plus every index — indexes are not
  updated lazily.
- **Why is updating an indexed column more expensive than updating an unindexed one?** It forces
  a delete plus insert in that index, and it disqualifies the update from being HOT.
- **What is a redundant index?** One whose columns are a leading prefix of another index; it
  costs writes and buys nothing.

### Follow-up Questions

- **Why is a random UUID primary key worse for writes than a sequential one?** Sequential keys
  append to the rightmost leaf, so splits are local and pages fill densely. Random keys touch a
  different leaf per insert, dirtying many more pages per checkpoint and splitting throughout
  the tree.
- **How would you find indexes to drop?** `pg_stat_user_indexes.idx_scan` shows indexes never
  used since the last statistics reset; cross-check against replicas, since a read replica may
  be the only user.

### Comparisons

| Axis | Sequential key | Random key |
|---|---|---|
| Use case | append-heavy tables | keys generated client-side |
| Insert locality | rightmost leaf only | scattered across the tree |
| Page splits | one edge, dense pages | everywhere, half-full pages |
| Cache behaviour | small hot working set | whole index must be resident |
| Index size over time | compact | inflated by half-full pages |
| Pick this when… | you control key generation | you need client-side ids — then prefer UUIDv7 |

### Complexity

Each index write is `O(log n)` page accesses plus amortised split cost; total write cost is
linear in the number of indexes.

### Common Mistakes

- Adding indexes for reports on a table in the write path.
- Leaving indexes behind after the query that motivated them was removed.
- Indexing a frequently-updated column when the query could use a different one.

### Important Facts to Remember

- One insert = one heap write + one write per index.
- Updating an indexed column disqualifies the update from HOT.
- HOT needs both conditions: no indexed column changed, and space on the page.
- `fillfactor` defaults to 100 for tables; lowering it buys HOT updates at the cost of size.

### Mock Follow-up

**Interviewer:** Insert throughput on a table has halved over six months while row count only
grew 20%. What do you check?

**Strong answer:** How many indexes have been added in that time, and whether the primary key is
random. Each new index is another descent, another write-ahead log record and another page to
dirty per insert. I would list indexes with their scan counts, drop the unused and the redundant
ones, then check index bloat — half-full pages from random-key splits make every subsequent
insert touch more pages.

**Weak answer:** "The table is bigger, so inserts are naturally slower."

## T8. Hash Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t8-hash-indexes) · [Understand](1_understand_part2.md#t8-hash-indexes) · Interview · [Production](3_production_part2.md#t8-hash-indexes)</sub>

### Definition

A hash index stores a hash of the indexed value in buckets, supporting equality lookups only.

### Why It Exists

Hashing gives a lookup that does not depend on the number of rows, and entries whose size does
not depend on the size of the value.

### Interview Explanation

Lookup hashes the search key, goes directly to a bucket and compares candidates — no tree
descent. Because only the hash is stored, the index stays small even for long text values, which
is where it wins over a B-tree. What you lose is everything derived from ordering: no ranges, no
sorting, no prefix matching, no multi-column keys, and no unique constraints. In PostgreSQL
there is also a historical caveat: before version 10 hash indexes were not written to the
write-ahead log, so they were neither crash-safe nor replicated. They have been since, but the
reputation has outlived the fix.

### Syntax

```sql
CREATE INDEX pages_url_hash ON pages USING hash (url);
```

### Example

```sql
SELECT * FROM pages WHERE url = 'https://example.com/a';        -- uses the hash index
SELECT * FROM pages WHERE url LIKE 'https://example.com/%';     -- cannot: needs ordering
SELECT * FROM pages ORDER BY url LIMIT 10;                      -- cannot: needs ordering
```

### Common Interview Questions

- **When is a hash index the right choice?** Equality-only access on large values, where B-tree
  entry size is the binding constraint.
- **Why can it not serve a range query?** Hashing does not preserve order, so adjacent values
  land in unrelated buckets.
- **Can it enforce uniqueness?** No — PostgreSQL hash indexes do not support unique constraints.

### Follow-up Questions

- **Why are hash indexes rare in practice even for equality?** A B-tree answers equality in
  three or four page reads, nearly all cached, so the theoretical advantage rarely shows up in
  measurement — while the B-tree also handles every other query shape.
- **What changed in PostgreSQL 10?** Hash indexes became WAL-logged, and therefore crash-safe
  and replicable. Before that they were effectively unusable in production.

### Comparisons

| Axis | Hash index | B-tree index (T3) |
|---|---|---|
| Use case | equality on large values | everything else |
| Range and sort support | none | full |
| Composite keys | single column only | multi-column with prefixes |
| Unique constraints | not supported | supported |
| Entry size | fixed-size hash | full key |
| Lookup cost | one bucket access | 3–4 page reads |
| Pick this when… | values are long and only ever compared with `=` | by default |

### Complexity

Average lookup is `O(1)` bucket accesses, degrading with collisions; a B-tree is `O(log_f n)`
with a very large `f`.

### Common Mistakes

- Choosing a hash index for a column that also appears in `ORDER BY`.
- Assuming hash indexes are still crash-unsafe on a current PostgreSQL.
- Expecting a measurable speed-up over a B-tree for short integer keys.

### Important Facts to Remember

- Equality only — no ranges, sorts, prefixes, or multi-column keys.
- WAL-logged and crash-safe since PostgreSQL 10.
- Cannot back a unique constraint.
- The win is index size on large values, not lookup speed on small ones.

### Mock Follow-up

**Interviewer:** A colleague proposes hash indexes everywhere because "hash lookup is O(1) and
B-tree is O(log n)". Respond.

**Strong answer:** The complexity classes describe comparisons, but the real cost is page reads,
and a B-tree lookup is three or four of them with the upper levels cached. Replacing that with a
single bucket read saves very little, while losing ranges, sorting, prefix matching, composite
keys and unique constraints. I would use hash only where index size on long values is measurably
the problem.

**Weak answer:** "Agreed for equality lookups — we can add B-trees later if we need ranges."

## T9. Partial and Expression Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t9-partial-and-expression-indexes) · [Understand](1_understand_part2.md#t9-partial-and-expression-indexes) · Interview · [Production](3_production_part2.md#t9-partial-and-expression-indexes)</sub>

### Definition

A partial index indexes only the rows satisfying a `WHERE` predicate. An expression index
indexes the result of a computation rather than a stored column value.

### Why It Exists

Queries rarely address whole columns evenly. Both let the index match the query's shape — one by
narrowing the rows, the other by changing the key — instead of duplicating the table.

### Interview Explanation

A partial index on a work queue holds only the pending rows, so it stays tiny and cached however
large the table grows, and finished rows cost nothing to maintain. The catch is that the planner
must prove the query's predicate implies the index's, which a literal does and a bind parameter
does not. An expression index stores a computed key such as `lower(email)`, and is used only by
queries that compute the same expression; the expression must be immutable, which rules out
anything time-dependent. Together they cover case-insensitive lookup, JSON extraction, and
"only the live rows" — three shapes that appear in nearly every schema.

### Syntax

```sql
CREATE INDEX jobs_pending_idx ON jobs (created_at) WHERE state = 'pending';
CREATE UNIQUE INDEX users_lower_email_idx ON users (lower(email));
CREATE INDEX events_payload_user_idx ON events ((payload ->> 'user_id'));
```

### Example

```sql
-- uses jobs_pending_idx: the predicate literally matches
SELECT * FROM jobs WHERE state = 'pending' ORDER BY created_at LIMIT 10;

-- does not: the planner cannot prove $1 = 'pending' for all values of $1
PREPARE q AS SELECT * FROM jobs WHERE state = $1 ORDER BY created_at LIMIT 10;
```

### Common Interview Questions

- **What makes a partial index cheaper?** It has entries only for matching rows, so it is
  smaller to search and cheaper to maintain for every non-matching row.
- **Why doesn't my query use the partial index?** The planner must prove implication; a
  parameterised predicate usually cannot be proven.
- **Why can't `WHERE email = $1` use an index on `lower(email)`?** The index is sorted by the
  computed value; the raw column is not stored in it.

### Follow-up Questions

- **How would you enforce case-insensitive uniqueness on email?** A unique expression index on
  `lower(email)`. It enforces the constraint and serves the lookup, and it is the standard
  alternative to storing a second normalised column.
- **Why must an expression index be immutable?** The index is built once. A function whose
  output can change for the same input — anything involving `now()` or a session setting — would
  silently make the index wrong.

### Edge Cases

- A partial unique index enforces uniqueness only among matching rows: "at most one active
  subscription per user" is a partial unique index on `(user_id) WHERE status = 'active'`.
- Expression indexes cost extra on write, since the expression is evaluated per insert.

### Comparisons

| Axis | Partial index | Expression index |
|---|---|---|
| Use case | a subset of rows is queried | a computed value is queried |
| What changes | which rows are indexed | what the key is |
| Query must | imply the index predicate | use the identical expression |
| Size effect | proportional to matching rows | same row count, different key |
| Typical use | work queues, soft-deleted rows | `lower(email)`, JSON fields |
| Pick this when… | the filter is stable and selective | the query computes before comparing |

### Common Mistakes

- Writing a partial index predicate that no query matches literally.
- Using a mutable function in an expression index.
- Adding a normalised duplicate column where a unique expression index would do.

### Important Facts to Remember

- The planner needs a proof, not a coincidence, to use a partial index.
- Expression indexes require the query to repeat the expression exactly.
- Expression functions must be `IMMUTABLE`.
- Partial unique indexes scope uniqueness to the matching subset.

### Mock Follow-up

**Interviewer:** Your partial index on pending jobs is not used by the application, but the same
SQL in psql uses it. Explain.

**Strong answer:** The application is almost certainly using a bind parameter for the state, so
the planner cannot prove that `state = $1` implies `state = 'pending'` — the proof must hold for
every possible parameter value. In psql the literal makes the implication trivially provable.
Fixes are to inline the constant in that query, or to change the index predicate to something
the parameterised query implies.

**Weak answer:** "The application connection has a stale plan cache — reconnecting will fix it."

## T10. Reading a Query Plan

<sub>Levels: [Foundation](0_foundation_part2.md#t10-reading-a-query-plan) · [Understand](1_understand_part2.md#t10-reading-a-query-plan) · Interview · [Production](3_production_part2.md#t10-reading-a-query-plan)</sub>

### Definition

A query plan is the tree of operations the planner chose for a statement, annotated with cost
estimates — and, under `ANALYZE`, with what actually happened.

### Why It Exists

Index choices depend on statistics that change with the data, so the only reliable answer to "is
this index being used" is to ask the database rather than to reason from the SQL.

### Interview Explanation

Read it as a tree from the innermost node outwards. Each node reports estimated rows and cost;
with `ANALYZE` it also reports actual rows, actual time, and loop count. The comparison that
matters most is estimated versus actual rows — a large divergence means the statistics are wrong
and the plan was chosen on bad information. After that, look at whether predicates appear as
`Index Cond`, meaning the index narrowed the search, or as `Filter` with `Rows Removed by
Filter`, meaning rows were fetched and then thrown away. `BUFFERS` adds how many pages came from
cache versus disk.

### Syntax

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT …;
```

### Example

```text
Bitmap Heap Scan on orders  (cost=42.11..981.42 rows=1210 width=64)
                            (actual time=0.412..3.882 rows=1188 loops=1)
  Recheck Cond: (customer_id = 7)
  Filter: (status = 'shipped')
  Rows Removed by Filter: 940
  Buffers: shared hit=318 read=42
  ->  Bitmap Index Scan on orders_customer_idx  (cost=0.00..41.81 rows=2128 width=0)
```

### Common Interview Questions

- **What is the difference between `Index Cond` and `Filter`?** `Index Cond` narrowed the index
  search; `Filter` was applied after rows were retrieved, so the work of retrieving the
  discarded rows was wasted.
- **What does a Bitmap Heap Scan mean?** Too many matches for scattered single-row fetches:
  collect the row addresses, sort them, then read the heap in physical order.
- **What does `loops=` mean?** How many times that node was executed — on the inner side of a
  Nested Loop, multiply its cost by the loop count.

### Follow-up Questions

- **Estimated 12 rows, actual 240,000, and the parent is a Nested Loop. What is wrong?** The
  estimate. The join method was reasonable for twelve rows and catastrophic for 240,000. Fix the
  statistics — `ANALYZE`, extended statistics for correlated predicates — rather than the index.
- **Why can `EXPLAIN` without `ANALYZE` be misleading?** It reports only the planner's beliefs.
  Every number is an estimate, including the ones that are wrong.

### Edge Cases

- `EXPLAIN ANALYZE` executes the statement, including writes — wrap it in a transaction you roll
  back.
- Timing instrumentation itself has overhead on plans with very many rows; `TIMING OFF` removes
  it.

### Common Mistakes

- Reading total cost as milliseconds. It is an arbitrary unit relative to `seq_page_cost`.
- Ignoring `loops=` and comparing a per-loop time against total execution time.
- Concluding an index is unused from the SQL alone rather than reading a plan.

### Important Facts to Remember

- Read plans innermost-first; compare estimated with actual rows at every node.
- `Index Cond` narrows; `Filter` discards after fetching.
- `Rows Removed by Filter` is the strongest hint that a column belongs in the index.
- `EXPLAIN ANALYZE` runs the query for real.

### Mock Follow-up

**Interviewer:** A plan shows an Index Scan with `Rows Removed by Filter: 190000`. What do you
do?

**Strong answer:** The index located a broad range and then most rows were discarded, so the
filtering column is not in the index. I would extend the index to include that column in the key
— after the equality columns and before or instead of the range column depending on the
predicate (T5) — so the condition moves from `Filter` to `Index Cond`. Then re-check that the
rows removed drops to near zero.

**Weak answer:** "Add a separate index on the filtered column so both indexes can be used."

[← Part 1 T1-T5](2_interview_part1.md)
