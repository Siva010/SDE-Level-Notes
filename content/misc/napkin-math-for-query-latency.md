---
title: Napkin Math for Query Latency
summary: The handful of numbers that let you predict a query's cost before you run it.
tags: [performance, estimation, databases]
difficulty: intermediate
prereqs: [database-indexing]
---

# Napkin Math for Query Latency

Most latency questions are answered by arithmetic, not by profiling. Profiling tells you what
happened; napkin math tells you what *should* happen, which is what makes a measurement
surprising enough to be worth chasing.

> [!insight] If the measurement and the estimate disagree by an order of magnitude, one of them
> is wrong — and finding out which is the entire debugging session.

## The numbers worth memorising

| Operation | Order of magnitude |
|---|---|
| L1 cache reference | 1 ns |
| Main memory reference | 100 ns |
| SSD random read (4 KB) | 100 µs |
| Rotational disk seek | 10 ms |
| Same-datacentre round trip | 0.5 ms |
| Cross-continent round trip | 100–150 ms |

Precision does not matter here. What matters is that memory is a thousand times faster than an
SSD read, and that a cross-continent round trip costs more than a thousand SSD reads.

## Applying it to a query

A B-tree lookup is three or four page reads, and the upper levels are almost always cached — see
[[database-indexing#t3]] for why the depth is so stable. So the estimate for a single indexed
lookup is roughly one uncached page read:

$$
t_{\text{lookup}} \approx d_{\text{cached}} \times 100\,\text{ns} + 1 \times 100\,\mu\text{s} \approx 0.1\,\text{ms}
$$

Which means a request doing 40 sequential indexed lookups has a floor near 4 ms, and one doing
2,000 has a floor near 200 ms. That is the N+1 query problem expressed as arithmetic rather than
as a rule to be obeyed.

An index lookup returning {{one row costs about the same as one returning ten}}, because the
cost is dominated by the descent rather than by the matches.

## Where the estimate breaks

- **Random reads on a cold cache.** The estimate assumes the upper tree levels are resident. On
  a cold instance they are not, and every lookup pays for the full descent.
- **Row width.** Returning 200 columns is not the same as returning two, however identical the
  plans look.
- **Network shape.** Twenty round trips of 0.5 ms is 10 ms of doing nothing, and no index will
  fix it.

> ⚠️ **Warning:** Napkin math predicts the floor, never the ceiling. Locks, queueing and
> checkpoint stalls all live above it, and none of them appear in the arithmetic.

An SSD random read is about 100 µs on consumer hardware, though cloud block storage is typically
slower than a locally attached drive ⚠️ verify for the instance class you actually run.

```quiz
question: A request performs 500 indexed lookups against a warm database. What is the rough floor?
options:
  - About 0.5 ms
  - About 50 ms
  - About 5 s
answer: 1
why: Roughly 0.1 ms per lookup, so 500 lookups is about 50 ms before any other cost is counted.
```

Napkin math is for whole systems, not just databases :: Estimate first, measure second, and let
the disagreement point at the bug.

Related: [[database-indexing]] for how the lookup cost is actually structured.
