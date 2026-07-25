# Database Indexing — Foundation (Part 2)

[← Part 1 T1-T5](0_foundation_part1.md)

## Table of Contents

- [T6. Selectivity and Cardinality](#t6-selectivity-and-cardinality)
- [T7. Write Amplification from Indexes](#t7-write-amplification-from-indexes)
- [T8. Hash Indexes](#t8-hash-indexes)
- [T9. Partial and Expression Indexes](#t9-partial-and-expression-indexes)
- [T10. Reading a Query Plan](#t10-reading-a-query-plan)

## T6. Selectivity and Cardinality

<sub>Levels: Foundation · [Understand](1_understand_part2.md#t6-selectivity-and-cardinality) · [Interview](2_interview_part2.md#t6-selectivity-and-cardinality) · [Production](3_production_part2.md#t6-selectivity-and-cardinality)</sub>

Cardinality is how many distinct values a column holds. Selectivity is the fraction of the
table a particular condition keeps — a condition matching 20 rows out of a million is highly
selective.

These two numbers decide whether an index is worth using. An index is a detour: read the
index, then fetch the matching rows. That detour pays only when it eliminates most of the
table. Filtering to half the rows through an index is slower than reading the whole table
straight through.

This is why a column with two values, like `is_active`, is usually a poor index on its own, and
why the planner may ignore an index you were sure it would use.

**Recall:** what does high selectivity mean? The condition matches a small fraction of the
rows.

## T7. Write Amplification from Indexes

<sub>Levels: Foundation · [Understand](1_understand_part2.md#t7-write-amplification-from-indexes) · [Interview](2_interview_part2.md#t7-write-amplification-from-indexes) · [Production](3_production_part2.md#t7-write-amplification-from-indexes)</sub>

Every index is a second copy of some of your data, and every copy has to be kept correct.
Inserting one row means writing to the table plus every index on it. Five indexes turn one
insert into six writes.

Deletes and updates behave the same way, and updates are worse: changing an indexed column
means removing the old index entry and adding a new one in a different place in the tree.

This is the cost side of indexing, and the reason "add an index" is a trade rather than a free
win. Read speed is bought with write throughput, disk space, and memory.

**Recall:** how many structures does an insert touch on a table with three indexes? Four — the
table and all three indexes.

## T8. Hash Indexes

<sub>Levels: Foundation · [Understand](1_understand_part2.md#t8-hash-indexes) · [Interview](2_interview_part2.md#t8-hash-indexes) · [Production](3_production_part2.md#t8-hash-indexes)</sub>

A hash index stores the hash of the indexed value and uses it to jump straight to a bucket
holding the matching entries. It answers "is this value equal to that one" and nothing else.

Because a hash destroys ordering, a hash index cannot serve a range query, cannot sort, and
cannot be used for a leading-prefix search. What it offers in exchange is a lookup that does
not depend on the table's size and entries that stay small even when the indexed values are
long.

It is a specialist tool. B-trees answer equality perfectly well, so hash indexes only earn
their place in narrow cases.

**Recall:** which query shapes can a hash index not answer? Ranges, sorts, and prefix
searches — anything that needs order.

## T9. Partial and Expression Indexes

<sub>Levels: Foundation · [Understand](1_understand_part2.md#t9-partial-and-expression-indexes) · [Interview](2_interview_part2.md#t9-partial-and-expression-indexes) · [Production](3_production_part2.md#t9-partial-and-expression-indexes)</sub>

A partial index indexes only the rows matching a condition you supply — for example only the
orders that are still pending. It is smaller than a full index, so it is cheaper to keep and
faster to search.

An expression index indexes the result of a computation instead of a stored column, such as
`lower(email)`. It exists because a query that computes something on a column cannot use an
index on the raw column: the index is sorted by the raw value, and the computation reorders
things.

Both are ways of shaping an index around the queries you actually run rather than around the
table's columns.

**Recall:** why does an expression index exist? So a query that filters on a computed value
can still use an index, since the index is built on the same computation.

## T10. Reading a Query Plan

<sub>Levels: Foundation · [Understand](1_understand_part2.md#t10-reading-a-query-plan) · [Interview](2_interview_part2.md#t10-reading-a-query-plan) · [Production](3_production_part2.md#t10-reading-a-query-plan)</sub>

A query plan is the database's description of how it intends to execute a query: which
indexes it will use, in which order it will join tables, and what each step is expected to
cost. `EXPLAIN` prints the plan; `EXPLAIN ANALYZE` runs the query and prints what actually
happened alongside it.

The plan is the only reliable answer to "is my index being used". Reasoning about it from the
SQL is guesswork, because the choice depends on table statistics that change as the data
changes.

Reading plans is the skill that makes every other indexing decision checkable rather than
superstitious.

**Recall:** what does `EXPLAIN ANALYZE` add over `EXPLAIN`? It executes the query and reports
real row counts and timings next to the estimates.

[← Part 1 T1-T5](0_foundation_part1.md)
