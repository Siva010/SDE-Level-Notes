<!-- OUTLINE v1
T1. Why Indexes Exist
T2. Heap Files and Row Identifiers
T3. B-Tree Index Structure
T4. Clustered and Secondary Indexes
T4.1. Covering Indexes and Index Only Scans
T5. Composite Index Column Order
T6. Selectivity and Cardinality
T7. Write Amplification from Indexes
T8. Hash Indexes
T9. Partial and Expression Indexes
T10. Reading a Query Plan
-->

# Database Indexing — Foundation (Part 1)

[Part 2 T6-T10 →](0_foundation_part2.md)

## Table of Contents

- [T1. Why Indexes Exist](#t1-why-indexes-exist)
- [T2. Heap Files and Row Identifiers](#t2-heap-files-and-row-identifiers)
- [T3. B-Tree Index Structure](#t3-b-tree-index-structure)
- [T4. Clustered and Secondary Indexes](#t4-clustered-and-secondary-indexes)
- [T4.1. Covering Indexes and Index Only Scans](#t4-1-covering-indexes-and-index-only-scans)
- [T5. Composite Index Column Order](#t5-composite-index-column-order)

## T1. Why Indexes Exist

<sub>Levels: Foundation · [Understand](1_understand_part1.md#t1-why-indexes-exist) · [Interview](2_interview_part1.md#t1-why-indexes-exist) · [Production](3_production_part1.md#t1-why-indexes-exist)</sub>

An index is a separate, ordered data structure that lets the database find rows without
looking at all of them. Without one, answering `WHERE email = 'a@b.com'` means reading every
row in the table and discarding the ones that do not match — a sequential scan.

The problem it solves is that table data is stored in insertion order, not in the order any
particular query wants to search. An index maintains a second copy of one or more columns,
kept sorted, with a pointer back to the row. Finding a value becomes a search through sorted
data instead of a walk through all of it.

Indexes are an optimisation, not part of the data model. Dropping one never changes a query's
answer — only how long the answer takes.

**Recall:** what does an index physically contain? A sorted copy of the indexed columns plus
a pointer to the row's location in the table.

## T2. Heap Files and Row Identifiers

<sub>Levels: Foundation · [Understand](1_understand_part1.md#t2-heap-files-and-row-identifiers) · [Interview](2_interview_part1.md#t2-heap-files-and-row-identifiers) · [Production](3_production_part1.md#t2-heap-files-and-row-identifiers)</sub>

A heap is the unordered file where table rows actually live. Rows are written wherever there
is free space — usually the end of the file — so heap order reflects insertion history and
nothing else.

Every row has a physical address inside that file. PostgreSQL calls it the `ctid`: a pair of
page number and slot number within the page. That address is what an index entry points at.

The address matters because it is not stable. When a row is updated, the database may write a
new version elsewhere in the heap, which gives the row a new address and forces the indexes
that point at it to be updated too.

**Recall:** what is a `ctid`? The physical location of a row version — page number plus slot
number inside that page.

## T3. B-Tree Index Structure

<sub>Levels: Foundation · [Understand](1_understand_part1.md#t3-b-tree-index-structure) · [Interview](2_interview_part1.md#t3-b-tree-index-structure) · [Production](3_production_part1.md#t3-b-tree-index-structure)</sub>

A B-tree is a balanced tree of fixed-size pages. Internal pages hold separator keys that say
which child to descend into; leaf pages hold the actual index entries in sorted order, linked
to their neighbours.

Balanced means every leaf sits at the same depth, so every lookup costs the same small number
of page reads regardless of which value you search for. Because each page holds hundreds of
keys, even a large table is only a few levels deep.

It is the default index type in nearly every relational database because it answers equality
and range queries and returns rows already in sorted order.

**Recall:** why is a B-tree lookup cost roughly constant across values? Every leaf is at the
same depth, so every search descends the same number of levels.

## T4. Clustered and Secondary Indexes

<sub>Levels: Foundation · [Understand](1_understand_part1.md#t4-clustered-and-secondary-indexes) · [Interview](2_interview_part1.md#t4-clustered-and-secondary-indexes) · [Production](3_production_part1.md#t4-clustered-and-secondary-indexes)</sub>

A clustered index stores the table rows themselves in the index's leaf pages — the index is
the table. A secondary index stores only the indexed columns plus a pointer to where the row
lives.

The difference decides what a lookup costs. Reading a row through a clustered index finishes
at the leaf. Reading through a secondary index finds the pointer, then has to fetch the row
from wherever it lives.

Which one you get depends on the engine, not on your SQL. MySQL's InnoDB always clusters a
table on its primary key. PostgreSQL has no clustered indexes at all — every index is
secondary, and the heap is always a separate file.

**Recall:** what does a secondary index entry hold? The indexed column values and a pointer to
the row, not the row itself.

## T4.1. Covering Indexes and Index Only Scans

<sub>Levels: Foundation · [Understand](1_understand_part1.md#t4-1-covering-indexes-and-index-only-scans) · [Interview](2_interview_part1.md#t4-1-covering-indexes-and-index-only-scans) · [Production](3_production_part1.md#t4-1-covering-indexes-and-index-only-scans)</sub>

A covering index contains every column a particular query needs, so the database can answer
that query from the index alone and never touch the table. The resulting plan is called an
index-only scan.

Coverage is a property of the pair, not of the index: an index covers a query, and the same
index may cover one query and not the next one. Adding a column purely to be read back — never
to be searched on — is what `INCLUDE` is for.

**Recall:** what makes a scan index-only? The index contains every column the query reads, so
no heap fetch is needed.

## T5. Composite Index Column Order

<sub>Levels: Foundation · [Understand](1_understand_part1.md#t5-composite-index-column-order) · [Interview](2_interview_part1.md#t5-composite-index-column-order) · [Production](3_production_part1.md#t5-composite-index-column-order)</sub>

A composite index indexes several columns at once. Its entries are sorted by the first column,
then by the second within equal firsts, and so on — the same way a phone book is sorted by
surname first and given name second.

That ordering is why column order matters. An index on `(tenant_id, created_at)` can answer a
search on `tenant_id` alone, or on both, but not one on `created_at` alone — just as a phone
book cannot find everyone named Ada without reading all of it.

**Recall:** which prefixes of a composite index are usable? Any leading prefix — the first
column, the first two, and so on, never a middle column by itself.

[Part 2 T6-T10 →](0_foundation_part2.md)
