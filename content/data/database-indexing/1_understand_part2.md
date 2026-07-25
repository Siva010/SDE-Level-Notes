# Database Indexing — Understand (Part 2)

[← Part 1 T1-T5](1_understand_part1.md)

## Table of Contents

- [T6. Selectivity and Cardinality](#t6-selectivity-and-cardinality)
- [T7. Write Amplification from Indexes](#t7-write-amplification-from-indexes)
- [T8. Hash Indexes](#t8-hash-indexes)
- [T9. Partial and Expression Indexes](#t9-partial-and-expression-indexes)
- [T10. Reading a Query Plan](#t10-reading-a-query-plan)

## T6. Selectivity and Cardinality

<sub>Levels: [Foundation](0_foundation_part2.md#t6-selectivity-and-cardinality) · Understand · [Interview](2_interview_part2.md#t6-selectivity-and-cardinality) · [Production](3_production_part2.md#t6-selectivity-and-cardinality)</sub>

**Core intuition:** the planner is comparing two cost estimates, and selectivity is the number
that decides which one wins.

Estimation runs off statistics collected by `ANALYZE` and stored per column: the number of
distinct values, the fraction of nulls, a list of most-common values with their frequencies,
and a histogram of the rest. From those, a predicate's selectivity is estimated — for an
equality on a most-common value, its recorded frequency; otherwise, roughly one over the
number of distinct values.

The estimate is then turned into a cost. A sequential scan costs about one unit per page read
plus a small per-row charge. An index scan costs the tree descent, plus the leaf entries
scanned, plus one heap fetch per matching row — and heap fetches are charged at
`random_page_cost`, which defaults to 4.0 against `seq_page_cost` of 1.0. That 4:1 ratio is a
model of spinning disks; on SSDs it overstates random reads badly, and lowering it is one of
the most common and most effective planner adjustments.

Two failure modes matter in practice:

- **Correlated columns.** The planner multiplies selectivities as if predicates were
  independent. `WHERE city = 'Paris' AND country = 'France'` gets an estimate far below the
  truth, because the two are nearly the same condition. Extended statistics
  (`CREATE STATISTICS`) exist for exactly this.
- **Skew.** With 90% of rows in one status value, the average selectivity of `status = ?` is
  meaningless. The most-common-values list is what saves this case, and it is also why a
  prepared statement with a generic plan can be much worse than one planned per value.

Cardinality is the input to all of that: a column with two distinct values cannot produce a
selective predicate on its own, no matter how it is indexed. Its use is as a *secondary*
column, or as the condition of a partial index (T9) where the selective work is done by the
`WHERE` clause instead of by the key.

> 💡 **Tip:** When a plan looks wrong, compare estimated with actual row counts first. A large
> divergence means the statistics are wrong, and no amount of index tinkering will fix that.

**Predict the output.**

```sql
CREATE INDEX ON people (country);
SELECT * FROM people WHERE country = 'FR';   -- 2% of rows
SELECT * FROM people WHERE country = 'US';   -- 61% of rows
```

Same index, same column. Which uses it, and what changes the answer?

<details><summary>Answer</summary>

`'FR'` uses the index; `'US'` almost certainly does not. Both values are likely in the
most-common-values list, so the planner has an accurate frequency for each and prices the two
queries differently. If `ANALYZE` has never run, both fall back to a generic estimate and the
planner may get either one wrong.

</details>

## T7. Write Amplification from Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t7-write-amplification-from-indexes) · Understand · [Interview](2_interview_part2.md#t7-write-amplification-from-indexes) · [Production](3_production_part2.md#t7-write-amplification-from-indexes)</sub>

**Core intuition:** an insert is not one write, it is one write per structure — and index
writes land in random places while heap writes land at the end.

The heap append is cheap and sequential. Each index write is a tree descent to find the right
leaf, a modification, a write-ahead log record, and possibly a page split that touches several
pages at once. On a table with six indexes, insert throughput is dominated by index maintenance
rather than by the row itself.

Update behaviour is where the detail earns its keep. In PostgreSQL:

- Update a non-indexed column, with free space on the page → HOT update, no index writes at
  all (T2).
- Update a non-indexed column, page full → new version on another page, and *every* index gets
  a new entry pointing at it, even though none of their key values changed.
- Update an indexed column → that index must delete and re-insert; the new entry usually lands
  in a different leaf.

Two consequences shape real schemas. First, free space in pages is what buys HOT updates, which
is what `fillfactor` controls — the default is 100 for tables, so a table whose rows are updated
often is a candidate for lowering it, and the default for B-tree indexes is 90 ⚠️ verify.
Second, key choice matters: a monotonically increasing key appends to the rightmost leaf and
keeps splits local, while a random key such as UUIDv4 scatters writes across the whole tree,
dirtying far more pages per transaction. UUIDv7 exists largely to recover that locality.

Redundant indexes are the easiest waste to remove. An index on `(a)` is fully contained in one
on `(a, b)`, and every write pays for both.

**Predict the output.** `orders` has indexes on `(customer_id)`, `(status)` and
`(created_at)`. How many index entries does this statement write?

```sql
UPDATE orders SET status = 'shipped', notes = 'left at door' WHERE id = 42;
```

<details><summary>Answer</summary>

It depends on whether the new version fits on the same page. If it does not, all three indexes
plus the primary key index get a new entry — four, because the row moved. If it does fit, the
update still cannot be HOT, because `status` is indexed: the `status` index must be updated,
and once the row moves the others follow. The lesson is that indexing a frequently-updated
column is a much larger cost than indexing a static one.

</details>

## T8. Hash Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t8-hash-indexes) · Understand · [Interview](2_interview_part2.md#t8-hash-indexes) · [Production](3_production_part2.md#t8-hash-indexes)</sub>

**Core intuition:** hashing buys you size independence and small entries, and charges you every
property that depends on order.

A hash index stores a 32-bit hash of the value in buckets. Lookup hashes the search key, goes
straight to the bucket, and compares candidates — no descent, and no dependence on the number
of rows beyond the bucket. Because only the hash is stored, the entry size does not grow with
the value: a hash index on a 2 KB text column stays compact where a B-tree would store the
whole key in every level it appears in.

What is lost is everything ordered. No `<`, no `BETWEEN`, no `ORDER BY`, no `LIKE 'abc%'`, no
leading-prefix use in a composite index — PostgreSQL's hash indexes are single-column only. They
cannot enforce a unique constraint either, so a `UNIQUE` requirement rules them out.

In PostgreSQL specifically, the history matters: before version 10, hash indexes were not
written to the write-ahead log, so they did not survive a crash and were not replicated. That
made them unusable in production, and the reputation outlived the fix — they have been
crash-safe since PostgreSQL 10.

The honest summary is that a B-tree answers equality in three or four cached page reads, which
is already fast, so the hash index's win is narrow. It shows up for equality-only lookups on
large values — long URLs, text keys — where index size is the binding constraint. Comparing
against B-trees is a standard interview question precisely because the answer is "rarely, and
here is exactly when".

**Predict the output.**

```sql
CREATE INDEX urls_hash ON pages USING hash (url);
SELECT * FROM pages WHERE url = 'https://example.com/a';
SELECT * FROM pages WHERE url LIKE 'https://example.com/%';
```

<details><summary>Answer</summary>

The first uses the index; the second cannot, and falls back to a sequential scan. Prefix
matching needs ordered keys, and hashing deliberately destroys ordering — similar strings hash
to unrelated buckets.

</details>

## T9. Partial and Expression Indexes

<sub>Levels: [Foundation](0_foundation_part2.md#t9-partial-and-expression-indexes) · Understand · [Interview](2_interview_part2.md#t9-partial-and-expression-indexes) · [Production](3_production_part2.md#t9-partial-and-expression-indexes)</sub>

**Core intuition:** both are ways of making the index match the query's shape instead of the
table's shape — one narrows the rows, the other changes the key.

A partial index carries a `WHERE` clause and indexes only matching rows:

```sql
CREATE INDEX jobs_pending_idx ON jobs (created_at) WHERE state = 'pending';
```

If a queue holds ten million finished jobs and two thousand pending ones, that index has two
thousand entries. It is small enough to stay cached, and — this is the part people miss — rows
that are not pending cost nothing to maintain, so completing a job removes its entry and later
updates to it never touch the index at all.

The planner uses a partial index only when it can *prove* the query's predicate implies the
index's predicate. `WHERE state = 'pending' AND created_at < now()` qualifies. A parameterised
`WHERE state = $1` does not, even when the parameter's value happens to be `'pending'` — the
proof has to hold for every possible value. This is the single most common reason a partial
index appears to be ignored.

An expression index changes what is stored:

```sql
CREATE INDEX users_lower_email_idx ON users (lower(email));
```

The stored key is the computed value, so it is usable only by queries that compute the same
expression — `WHERE lower(email) = lower($1)` uses it, `WHERE email = $1` does not. The
expression must be immutable: it must return the same output for the same input forever. That
is why `now()` cannot appear in one, and why a partial index's predicate cannot be
time-relative either.

Case-insensitive lookup, JSON field extraction, and "only the rows that are still live" are the
three shapes these solve in almost every codebase.

> ✅ **Best Practice:** Prefer a partial index over adding a low-cardinality flag column to a
> composite key. It gives the same filtering with a fraction of the entries.

**Predict the output.** Both indexes above exist. Which queries use them?

```sql
SELECT * FROM users WHERE email = 'ADA@example.com';
SELECT * FROM jobs WHERE state = 'pending' ORDER BY created_at LIMIT 10;
```

<details><summary>Answer</summary>

The first does not use `users_lower_email_idx` — it compares the raw column, which the index
does not contain. The second does use `jobs_pending_idx`: the predicate literally matches the
index's, and because the index is ordered by `created_at`, the `LIMIT 10` is answered by
reading ten leaf entries.

</details>

## T10. Reading a Query Plan

<sub>Levels: [Foundation](0_foundation_part2.md#t10-reading-a-query-plan) · Understand · [Interview](2_interview_part2.md#t10-reading-a-query-plan) · [Production](3_production_part2.md#t10-reading-a-query-plan)</sub>

**Core intuition:** read a plan as a tree, from the innermost node outwards, and compare
estimated rows with actual rows at every level.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT total_cents FROM orders WHERE customer_id = 7 AND created_at > DATE '2026-01-01';
```

```text
Index Scan using orders_customer_idx on orders
  (cost=0.43..112.90 rows=41 width=8) (actual time=0.031..0.140 rows=38 loops=1)
  Index Cond: ((customer_id = 7) AND (created_at > '2026-01-01'::date))
  Buffers: shared hit=12
Planning Time: 0.180 ms
Execution Time: 0.171 ms
```

The vocabulary that carries most of the meaning:

| Node or field | What it tells you |
|---|---|
| `Seq Scan` | every page of the heap was read |
| `Index Scan` | tree descent, then a heap fetch per matching row |
| `Index Only Scan` | answered from the index; check `Heap Fetches` (T4.1) |
| `Bitmap Heap Scan` | many matches — collect `ctid`s first, then read the heap in physical order |
| `Index Cond` | predicates the index itself resolved |
| `Filter` with `Rows Removed by Filter` | predicates applied *after* fetching rows — wasted work |
| `rows=` estimated vs `rows=` actual | the health of the statistics (T6) |
| `Buffers: shared hit / read` | pages served from cache versus from disk |

The distinction that matters most is `Index Cond` versus `Filter`. A condition under
`Index Cond` narrowed the search; a condition under `Filter` did not, and every row it removes
was fetched for nothing. A large `Rows Removed by Filter` is the clearest possible signal that
a column belongs in the index.

A Bitmap Heap Scan is the planner's middle path: too many matches for scattered random fetches,
too few to justify reading everything. Seeing one is normal; seeing one where you expected a
plain index scan usually means the predicate is less selective than you thought.

> ⚠️ **Warning:** `EXPLAIN ANALYZE` actually executes the statement. Wrap a write in a
> transaction you roll back, or you will run it for real.

**Predict the output.** A plan shows `rows=12` estimated and `rows=240000` actual on the
innermost node, and the outer node is a Nested Loop. What went wrong?

<details><summary>Answer</summary>

The estimate, not the join. The planner chose a Nested Loop because it expected twelve rows on
the inner side; with 240,000 it repeats the inner lookup 240,000 times. The fix is upstream —
run `ANALYZE`, add extended statistics for correlated predicates (T6) — not a different index.

</details>

[← Part 1 T1-T5](1_understand_part1.md)
