# Database Indexing — Interview (Part 1)

[Part 2 T6-T10 →](2_interview_part2.md)

## Table of Contents

- [T1. Why Indexes Exist](#t1-why-indexes-exist)
- [T2. Heap Files and Row Identifiers](#t2-heap-files-and-row-identifiers)
- [T3. B-Tree Index Structure](#t3-b-tree-index-structure)
- [T4. Clustered and Secondary Indexes](#t4-clustered-and-secondary-indexes)
- [T4.1. Covering Indexes and Index Only Scans](#t4-1-covering-indexes-and-index-only-scans)
- [T5. Composite Index Column Order](#t5-composite-index-column-order)

## T1. Why Indexes Exist

<sub>Levels: [Foundation](0_foundation_part1.md#t1-why-indexes-exist) · [Understand](1_understand_part1.md#t1-why-indexes-exist) · Interview · [Production](3_production_part1.md#t1-why-indexes-exist)</sub>

### Definition

An index is an auxiliary, ordered structure over one or more columns that lets the database
locate qualifying rows without examining every row.

### Why It Exists

Table storage is ordered by insertion, not by any query's access pattern. Without a secondary
ordering, every filter degrades to a full scan whose cost is proportional to table size rather
than to result size.

### Interview Explanation

An index is a sorted copy of some columns, plus a pointer back to each row. Because it is
sorted, the database can binary-search it instead of reading the table. That turns a filter
from linear in the table into logarithmic to find the first match, plus the cost of returning
the matches. The catch is that it is a second structure holding the same data, so every write
has to maintain it, and the planner will refuse to use it when the filter is not selective
enough — reading a large fraction of the table through an index is slower than just reading
the table.

### Example

```sql
-- 10M rows, no index: Seq Scan, ~1.2 s
SELECT * FROM orders WHERE email = 'ada@example.com';

CREATE INDEX orders_email_idx ON orders (email);
-- Index Scan, ~0.3 ms for a handful of matches
```

### Common Interview Questions

- **Does an index change query results?** No. It changes only the plan and the time taken.
  If results differ with and without an index, you have a bug or a non-deterministic query
  without `ORDER BY`.
- **Why would the database ignore an index you created?** Because it estimates the scan to be
  cheaper — usually low selectivity (T6), stale statistics, or a predicate the index cannot
  answer.
- **Is an index always a win for reads?** No. It adds a structure to keep consistent, and a
  scan that returns most of the table through an index is slower than a sequential scan.

### Follow-up Questions

- **Why is an index scan that returns 60% of the table slower than a sequential scan?**
  Because it performs one random heap read per matching row instead of one sequential read
  per page. Random reads are several times more expensive per page, and each page is read
  repeatedly rather than once. The planner models this as `random_page_cost` versus
  `seq_page_cost`.
- **When does an index help a query that has no `WHERE` clause?** When it satisfies an
  `ORDER BY`, a `MIN`/`MAX`, or lets the query be answered index-only (T4.1). Ordering is the
  most commonly forgotten one.

### Common Mistakes

- Indexing every column that appears in a `WHERE` clause anywhere in the codebase.
- Treating index count as free because reads dominate — the write cost is paid by every write,
  including the ones in the hot path.
- Concluding "the index doesn't work" from a query that returns most of the table.

### Important Facts to Remember

- An index never changes results, only cost.
- Index lookup cost scales with matches, not table size; scan cost scales with table size, not
  matches.
- A secondary index lookup pays a heap fetch per row on top of the tree descent.
- The planner chooses per query and per parameter value, not per index.

### Mock Follow-up

**Interviewer:** You added an index and the query got slower. Explain.

**Strong answer:** Most likely the query is a write or a mixed workload — the extra index made
every insert and update more expensive, and that dominated. If it is genuinely a read that got
slower, the plan probably switched to an index scan with poor selectivity, doing thousands of
random heap fetches where a sequential scan read the table once. I would check `EXPLAIN
(ANALYZE, BUFFERS)` for estimated versus actual rows before touching anything else.

**Weak answer:** "Indexes always help reads, so it must be a caching artefact — I would run it
again."

## T2. Heap Files and Row Identifiers

<sub>Levels: [Foundation](0_foundation_part1.md#t2-heap-files-and-row-identifiers) · [Understand](1_understand_part1.md#t2-heap-files-and-row-identifiers) · Interview · [Production](3_production_part1.md#t2-heap-files-and-row-identifiers)</sub>

### Definition

The heap is the unordered file of fixed-size pages holding table rows; a row identifier such as
PostgreSQL's `ctid` is a row version's physical address within it.

### Why It Exists

Something has to hold the rows, and appending to an unordered file is the cheapest possible
write. Physical addressing gives indexes a pointer that costs a single page read to follow.

### Interview Explanation

Rows live in 8 KB pages, written wherever there is space. A `ctid` is a page number and a slot
number, and that is what index entries store in PostgreSQL. Because updates create new row
versions under MVCC rather than modifying in place, a row's `ctid` is not stable — an update can
move it, and every index then needs an entry pointing at the new address. The exception is a
HOT update, where nothing indexed changed and the new version fits on the same page; then the
indexes are left alone entirely.

### Syntax

```sql
SELECT ctid, id FROM orders WHERE id = 42;   -- (1493,3)
```

### Example

```sql
CREATE TABLE t (id int PRIMARY KEY, note text, tag text);
CREATE INDEX ON t (tag);

UPDATE t SET note = 'x' WHERE id = 1;   -- can be HOT: note is not indexed
UPDATE t SET tag  = 'y' WHERE id = 1;   -- cannot be HOT: tag is indexed
```

### Common Interview Questions

- **What is stored in a PostgreSQL index leaf entry?** The key values and a `ctid`.
- **Why is `ctid` unsafe as an application identifier?** It changes on update and on
  `VACUUM FULL`; it identifies a row version's location, not a row.
- **What is a HOT update and why does it matter?** An update that touches no indexed column and
  fits on the same page, so no index maintenance is needed — the single biggest lever on update
  throughput.

### Follow-up Questions

- **Why does an unvacuumed table slow down reads, not just consume disk?** Dead row versions
  still occupy pages, so scans read more pages for the same live rows, and index entries
  pointing at dead versions still have to be followed and discarded.
- **How does InnoDB differ here?** Secondary indexes store the primary key rather than a
  physical address, so a moved row does not invalidate them — at the cost of a second B-tree
  descent on every secondary lookup (T4).

### Edge Cases

- `VACUUM FULL` rewrites the table and changes every `ctid`; plain `VACUUM` does not relocate
  live rows.
- A row wider than roughly a quarter of a page is moved out of line into TOAST storage, and the
  heap keeps a pointer.

### Common Mistakes

- Caching `ctid` values in application code or in another table.
- Assuming an update is "in place" and therefore cheap regardless of which columns changed.

### Important Facts to Remember

- `ctid` = (page, slot), and it identifies a row *version*.
- PostgreSQL index entries point at `ctid`s; InnoDB secondary indexes point at primary keys.
- HOT requires two things: no indexed column changed, and free space on the page.
- Free space is governed by `fillfactor`, which defaults to 100 for tables.

### Mock Follow-up

**Interviewer:** A table of counters is updated thousands of times a second and keeps getting
slower. What do you look at?

**Strong answer:** Whether the updates can be HOT. If the counter column is indexed, every
update rewrites index entries; dropping that index may be the entire fix. If it is not indexed,
the pages are probably full, so I would lower `fillfactor` to leave room for new versions on the
same page and confirm with `pg_stat_user_tables` that the HOT-update ratio improved. I would
also check that autovacuum is keeping up, because dead versions are what fill the pages.

**Weak answer:** "Add an index on the counter column so the updates find the row faster."

## T3. B-Tree Index Structure

<sub>Levels: [Foundation](0_foundation_part1.md#t3-b-tree-index-structure) · [Understand](1_understand_part1.md#t3-b-tree-index-structure) · Interview · [Production](3_production_part1.md#t3-b-tree-index-structure)</sub>

### Definition

A B-tree index is a balanced, high-fanout search tree whose leaf pages hold sorted index entries
linked to their neighbours.

### Why It Exists

It answers equality, ranges, prefixes and ordering with one structure, at a page-read cost that
barely grows with table size — which is why it is the default index type nearly everywhere.

### Interview Explanation

Each page holds hundreds of keys, so the tree is wide and shallow: three or four levels covers
hundreds of millions of rows, and the upper levels stay cached. A search descends from the root
comparing against separator keys, lands on a leaf, and then — because leaves are sorted and
linked — a range scan is just a walk sideways. All leaves sit at the same depth, so lookup cost
does not depend on which value you search for. Inserts keep it that way by splitting full pages
and pushing separators upward.

### Syntax

```sql
CREATE INDEX orders_created_idx ON orders (created_at);          -- btree is the default
CREATE INDEX orders_created_desc_idx ON orders (created_at DESC NULLS LAST);
```

### Example

```sql
-- all four are served by one btree on (created_at)
SELECT * FROM orders WHERE created_at = DATE '2026-07-01';
SELECT * FROM orders WHERE created_at BETWEEN DATE '2026-07-01' AND DATE '2026-07-31';
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20;
SELECT max(created_at) FROM orders;
```

### Common Interview Questions

- **Why a B-tree rather than a binary search tree?** Pages, not comparisons, are the unit of
  cost. High fanout minimises page reads; a binary tree would need dozens.
- **What operations can a B-tree serve?** Equality, ranges, `IN` lists, prefix `LIKE`, ordering,
  and `MIN`/`MAX` — anything derived from sorted order.
- **Why is depth so stable?** Balance is maintained on insert by splitting, so all leaves stay
  at equal depth.

### Follow-up Questions

- **What is a page split and when does it hurt?** A full leaf splitting in two, pushing a
  separator into the parent. Random-key inserts cause splits all over the tree; sequential keys
  split only at the right edge, which is far cheaper and denser.
- **Why can a B-tree satisfy `ORDER BY` without a sort node?** Leaves are already in key order
  and linked, so an ordered walk emits rows in the required order.

### Comparisons

| Axis | B-tree | Hash (T8) |
|---|---|---|
| Use case | equality, ranges, sorting, prefixes | equality only |
| Lookup cost | 3–4 page reads, grows logarithmically | ~1 bucket read, independent of size |
| Ordering | preserved | destroyed |
| Composite keys | yes, leading prefixes usable | no, single column only |
| Unique constraints | supported | not supported |
| Entry size | stores the full key | stores a 32-bit hash |
| Pick this when… | you need anything ordered, or you are unsure | equality-only lookups on large values |

### Complexity

Search, insert and delete are `O(log_f n)` page accesses, where `f` is the fanout — several
hundred for a small key. A range scan adds `O(k / entries-per-page)` further reads for `k`
matches.

### Common Mistakes

- Reasoning about B-trees as binary trees and concluding lookups cost ~24 comparisons of I/O.
- Assuming an index on `(a)` helps `WHERE b = ?` because both are in the same table.
- Forgetting that ordering is often the bigger win over filtering.

### Important Facts to Remember

- Fanout, not depth, is what makes a B-tree fast.
- All leaves are at the same depth; lookup cost is uniform across values.
- Leaves are linked, so ranges need one descent and then a sideways walk.
- Sequential key inserts split only the rightmost leaf; random keys split everywhere.

### Mock Follow-up

**Interviewer:** Your table has 500 million rows. How many page reads to find one by an indexed
integer column?

**Strong answer:** Around four — a three or four level tree plus the heap fetch. With a fanout
in the high hundreds, 500 million entries fits in four levels, and the root and its children
are almost certainly in the buffer cache, so the physical reads are usually one or two. The
number would only grow meaningfully if the key were wide, since that lowers fanout.

**Weak answer:** "log₂(500,000,000), so about 29 reads."

## T4. Clustered and Secondary Indexes

<sub>Levels: [Foundation](0_foundation_part1.md#t4-clustered-and-secondary-indexes) · [Understand](1_understand_part1.md#t4-clustered-and-secondary-indexes) · Interview · [Production](3_production_part1.md#t4-clustered-and-secondary-indexes)</sub>

### Definition

A clustered index stores whole rows in its leaf pages, making the index the table. A secondary
index stores key columns plus a pointer to the row's location elsewhere.

### Why It Exists

Clustering removes one level of indirection for lookups on the clustering key, and makes ranges
on it physically sequential. Secondary indexes exist because a table can only be clustered one
way, and queries need more than one access path.

### Interview Explanation

The distinction is about where the row body lives. In InnoDB the primary key index *is* the
table, so a primary key lookup ends at the leaf, and every secondary index stores the primary
key as its pointer — which means a secondary lookup is two descents. In PostgreSQL there is no
clustered index: the heap is always separate and every index, including the primary key's,
stores physical row addresses, so every index costs one descent plus one heap fetch. Neither is
strictly better; they trade a cheaper primary key path against uniform cost for all indexes.

### Example

```sql
-- InnoDB: secondary entry is (email, id); the lookup then re-descends the clustered index
CREATE TABLE users (
  id    BIGINT PRIMARY KEY,
  email VARCHAR(320),
  name  VARCHAR(120),
  INDEX users_email_idx (email)
) ENGINE = InnoDB;
```

```sql
-- PostgreSQL: CLUSTER is a one-time reorganisation, not a maintained clustered index
CLUSTER orders USING orders_created_idx;
```

### Common Interview Questions

- **How many B-tree descents does an InnoDB secondary lookup take?** Two — the secondary index
  to get the primary key, then the clustered index to get the row.
- **Does PostgreSQL support clustered indexes?** No. `CLUSTER` physically reorders the heap
  once; subsequent writes are not kept in that order.
- **Why should an InnoDB primary key be narrow?** Every secondary index entry embeds a copy of
  it, so a wide key inflates every other index.

### Follow-up Questions

- **Why is a random UUID a poor InnoDB primary key?** Inserts land at random positions in the
  clustered index, so they split pages across the whole tree and fragment the table itself, not
  just an index. A time-ordered key such as UUIDv7 restores append-like behaviour.
- **When is PostgreSQL's lack of clustering an advantage?** When access is spread over many
  different indexes: no single index gets a privileged path, so adding one does not penalise the
  others, and the primary key is not baked into every secondary entry.

### Comparisons

| Axis | Clustered (InnoDB PK) | Secondary (PostgreSQL, all indexes) |
|---|---|---|
| Use case | primary key lookups and PK ranges | any access path, all equal |
| Row location | in the index leaf | in a separate heap |
| Lookup cost | one descent | one descent plus a heap fetch |
| Secondary lookup | two descents | one descent plus a heap fetch |
| Key width impact | inflates every secondary index | none beyond the index itself |
| Range scan locality | physically sequential | scattered unless correlated |
| Pick this when… | reads are dominated by one key | access paths are varied |

### Common Mistakes

- Believing `CLUSTER` in PostgreSQL creates a maintained clustered index.
- Using a wide natural key as an InnoDB primary key and then adding six secondary indexes.
- Assuming a "primary key lookup" costs the same in both engines.

### Important Facts to Remember

- InnoDB: PK index is the table; secondary entries carry the PK.
- PostgreSQL: heap is separate; every index entry carries a `ctid`.
- InnoDB secondary lookups = two descents; PostgreSQL = descent plus heap fetch.
- `CLUSTER` decays as soon as new rows are written.

### Mock Follow-up

**Interviewer:** Same schema on InnoDB and PostgreSQL. Which one benefits more from covering an
index, and why?

**Strong answer:** InnoDB, because covering removes an entire second B-tree descent, whereas in
PostgreSQL it removes a single heap page fetch. PostgreSQL also cannot always take the win —
the index-only scan still has to consult the visibility map, so a churn-heavy table falls back
to heap fetches anyway (T4.1).

**Weak answer:** "They are the same, since both skip reading the table."

## T4.1. Covering Indexes and Index Only Scans

<sub>Levels: [Foundation](0_foundation_part1.md#t4-1-covering-indexes-and-index-only-scans) · [Understand](1_understand_part1.md#t4-1-covering-indexes-and-index-only-scans) · Interview · [Production](3_production_part1.md#t4-1-covering-indexes-and-index-only-scans)</sub>

### Definition

An index covers a query when it contains every column that query touches; the resulting plan,
which reads no table rows, is an index-only scan.

### Why It Exists

The heap fetch is the expensive half of a secondary index lookup. Removing it turns a scattered
random read per row into pure sequential index reads.

### Interview Explanation

If everything the query mentions — filters, output columns, ordering — is in the index, the
database can answer from the index alone. In PostgreSQL you add non-searchable payload columns
with `INCLUDE`, which keeps them out of the key so they widen only the leaf pages. The catch is
visibility: the index does not know whether a row version is visible to your transaction, so an
index-only scan consults the visibility map, and any page not marked all-visible still gets
fetched. That is why `EXPLAIN ANALYZE` reports `Heap Fetches`, and why the benefit depends on
vacuuming.

### Syntax

```sql
CREATE INDEX orders_customer_idx
  ON orders (customer_id, created_at)
  INCLUDE (total_cents);
```

### Example

```sql
-- Index Only Scan, Heap Fetches: 0 on a well-vacuumed table
SELECT created_at, total_cents FROM orders WHERE customer_id = 7;

-- Index Scan — status is not in the index, so every row needs the heap
SELECT created_at, status FROM orders WHERE customer_id = 7;
```

### Common Interview Questions

- **What is the difference between a key column and an `INCLUDE` column?** Key columns are
  searchable, sortable and usable as a prefix; `INCLUDE` columns are stored in the leaves and
  only returnable.
- **Why might an index-only scan still read the heap?** Because the visibility map does not mark
  the page all-visible, so visibility must be checked in the heap.
- **Is covering a property of the index?** No — of the index and query together.

### Follow-up Questions

- **When would you put a column in the key rather than in `INCLUDE`?** When it is filtered,
  ranged or ordered on. Key columns widen every level of the tree, so payload-only columns
  belong in `INCLUDE`.
- **How do you make index-only scans actually pay off?** Keep the visibility map current —
  autovacuum tuned for the table's churn — and confirm with `Heap Fetches` near zero in
  `EXPLAIN (ANALYZE)`.

### Edge Cases

- A wide `INCLUDE` list can double the index size and evict more useful pages from cache.
- Expression indexes cannot be used for index-only scans on the underlying column, since the
  raw value is not stored.

### Common Mistakes

- Adding output columns to the key instead of to `INCLUDE`.
- Reporting "index-only scan" as a win without checking `Heap Fetches`.
- Building a covering index for a `SELECT *`.

### Important Facts to Remember

- `INCLUDE` was added in PostgreSQL 11.
- Coverage is per query-index pair, not per index.
- Index-only scans depend on the visibility map, and therefore on vacuum.
- Payload columns widen leaves only; key columns widen every level.

### Mock Follow-up

**Interviewer:** Your index-only scan reports `Heap Fetches: 812345`. What does that tell you?

**Strong answer:** That the plan is index-only in name only — almost every row still required a
heap visit because its page is not marked all-visible. The table has heavy write churn and
autovacuum is behind. I would tune autovacuum for this table and re-measure; if the churn is
inherent, the covering index is buying much less than the plan node suggests.

**Weak answer:** "It is still an index-only scan, so the index is working correctly."

## T5. Composite Index Column Order

<sub>Levels: [Foundation](0_foundation_part1.md#t5-composite-index-column-order) · [Understand](1_understand_part1.md#t5-composite-index-column-order) · Interview · [Production](3_production_part1.md#t5-composite-index-column-order)</sub>

### Definition

A composite index is an index on several columns, ordered lexicographically by the column list;
usable prefixes run from the leftmost column inwards.

### Why It Exists

Most real predicates constrain more than one column. Indexing the combination lets a single
descent narrow on all of them, instead of intersecting several single-column indexes.

### Interview Explanation

Entries are sorted by the first column, then the second within ties, and so on — a phone book
sorted by surname then given name. A query can use consecutive leading columns while each is an
equality, plus one range at the end. So `(a, b, c)` serves `a = ?`, `a = ? AND b = ?`, and
`a = ? AND b = ? AND c > ?`, but for `a = ? AND c = ?` only `a` narrows the search and `c`
becomes a filter. The practical rule is equality columns first, then the range or sort column,
and it is why `(status, created_at)` can serve a filtered, ordered feed with no sort step while
the reverse order cannot.

### Syntax

```sql
CREATE INDEX events_tenant_time_idx ON events (tenant_id, occurred_at);
CREATE INDEX events_mixed_sort_idx  ON events (tenant_id ASC, occurred_at DESC);
```

### Example

```sql
-- uses both columns, no sort node
SELECT * FROM events WHERE tenant_id = 3 ORDER BY occurred_at DESC LIMIT 50;

-- uses tenant_id only; severity is applied as a filter
SELECT * FROM events WHERE tenant_id = 3 AND severity = 'error';
```

### Common Interview Questions

- **Which prefixes of `(a, b, c)` are usable?** `a`, `(a, b)`, `(a, b, c)` — never `b` or `c`
  alone, and never a gap.
- **Where does the range column go?** Last among the columns the index will use, because
  everything after a range is unordered within it.
- **Is an index on `(a)` redundant given `(a, b)`?** For search purposes yes; the narrower index
  is smaller and marginally faster, but rarely worth its write cost.

### Follow-up Questions

- **Why does `WHERE a = 1 AND b > 5 AND c = 2` not use `c` from `(a, b, c)`?** Once `b` is a
  range, entries with different `b` values are interleaved, so `c` is not sorted within the
  scanned span. `c` is applied as a filter to rows the index returns.
- **When would you deliberately lead with a low-cardinality column?** When it is always an
  equality in the query and the second column provides ordering — `(status, created_at)` for a
  work queue. The leading column's cardinality matters far less than whether the query always
  constrains it.

### Comparisons

| Axis | One index on `(a, b)` | Two indexes on `(a)` and `(b)` |
|---|---|---|
| Use case | predicates that always include `a` | predicates on either column alone |
| `a = ? AND b = ?` | one descent, exact | bitmap AND of two scans, then heap |
| `b = ?` alone | unusable | direct |
| Ordering by `(a, b)` | free | needs a sort |
| Write cost | one index to maintain | two indexes to maintain |
| Size | one structure | two structures |
| Pick this when… | the pair is queried together | the columns are queried independently |

### Common Mistakes

- Ordering composite columns by cardinality instead of by how queries constrain them.
- Adding a second index that is a prefix of an existing one.
- Putting the range column before the equality columns.

### Important Facts to Remember

- Leading prefixes only — no middle column, no gaps.
- One range is usable, and it ends the index's usefulness for later columns.
- Equality first, then range or sort.
- Mixed `ASC`/`DESC` sorts need matching declared directions.

### Mock Follow-up

**Interviewer:** A feed query filters on `tenant_id` and sorts by `created_at`, and the plan
shows a Sort node consuming 400 MB. What is wrong?

**Strong answer:** The index is almost certainly `(created_at, tenant_id)`, or two separate
single-column indexes, so the tenant's rows are not contiguous in `created_at` order and the
whole matching set has to be sorted. Recreating it as `(tenant_id, created_at)` makes the
qualifying entries a contiguous run already in order, so the sort disappears and the `LIMIT`
stops the scan early.

**Weak answer:** "Increase `work_mem` so the sort fits in memory."

[Part 2 T6-T10 →](2_interview_part2.md)
