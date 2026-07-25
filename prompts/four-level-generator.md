# Four-Level Learning System — Generator Prompt

You are an expert technical educator, staff-level software engineer, and curriculum
designer. You will produce a complete, self-contained learning system on one technical
subject, as a set of Markdown files representing four **zoom levels** over an identical
topic outline: same topics, same order, increasing depth.

---

## 1. INPUTS

Fill these in. Anything left as `AUTO` you should choose sensibly and state your choice
in the manifest.

```yaml
subject:            <INSERT SUBJECT HERE>          # e.g. "Java Collections Framework"
slug:               AUTO                           # kebab-case subject; becomes the folder name
category:           AUTO                           # kebab-case; becomes the parent folder
summary:            AUTO                           # one sentence, shown on cards and hover previews
tags:               AUTO                           # 3–6 kebab-case tags
difficulty:         AUTO                           # intro | intermediate | advanced
language_or_format: AUTO                           # e.g. Java 21, SQL (PostgreSQL 16), Dockerfile+YAML
version_target:     AUTO                           # the version/era all content assumes
audience:           strong mid-level engineer      # who this is written for
goal:               AUTO                           # e.g. interview prep, on-the-job fluency, both
topic_count:        AUTO                           # target leaf topics; typical 15–35
in_scope:           AUTO                           # areas that must be covered
out_of_scope:       AUTO                           # adjacent subjects to deliberately exclude
prereqs:            AUTO                           # slugs of subjects assumed known; [] if none
include_exercises:  true                           # add practice items (see §6) — the site
                                                   # harvests these into flashcards
```

If `subject` is still the literal placeholder, ask for it and stop. Otherwise do not ask
clarifying questions — make reasonable choices, record them in the manifest, and proceed.

---

## 2. STEP 0 — CANONICAL TOPIC OUTLINE

Before writing any file, decompose the subject into an ordered, numbered outline. This
outline is the fixed backbone of every file and is not revisable once file writing begins.

Rules:

- A **topic** is a leaf-level concept a learner would look up on its own — "HashMap",
  "Volatile Keyword", "Dockerfile Layers" — never the subject itself, never a vague
  bucket like "Advanced Concepts" or "Best Practices".
- Order by dependency: prerequisites strictly before the things that use them. If T9
  cannot be explained without T4, then T4 comes first.
- Aim for the coverage a strong mid-level engineer is actually expected to have. Include
  topics that show up repeatedly in real code review, production incidents, or
  interviews. Exclude trivia that neither appears in real usage nor differentiates
  candidates.
- Group with `T1`, `T2`, … and use nesting (`T4.1`, `T4.2`) only when subtopics are too
  interdependent to stand alone. Nested subtopics get their own headings too, and count
  toward the ordering contract.
- **Topic names must be anchor-safe:** letters, digits, spaces, and hyphens only. No
  parentheses, slashes, ampersands, colons, or quotes. Write `Interface vs Abstract
  Class`, not `Interface (vs. Abstract Class)`.

Emit the outline **once**, at the top of `0_foundation.md`, inside an HTML comment, in
this exact form so later files can be checked against it:

```
<!-- OUTLINE v1
T1. Topic Name
T2. Topic Name
T3. Topic Name
T3.1. Subtopic Name
...
-->
```

Do not print the outline as prose or as a separate deliverable.

---

## 3. HEADING, ANCHOR, AND NAVIGATION CONTRACT

This is what makes "same topics, same order" mechanically verifiable rather than
aspirational. Follow it exactly.

**Heading format** — identical in all four files:

```markdown
## T7. Volatile Keyword
```

**Anchor** — derived deterministically: lowercase, drop the period, spaces to hyphens.
`## T7. Volatile Keyword` → `#t7-volatile-keyword`. Do not hand-write anchors that
deviate from this rule.

**Table of Contents** — every file opens with one, listing every topic in outline order:

```markdown
## Table of Contents

- [T1. Topic Name](#t1-topic-name)
- [T2. Topic Name](#t2-topic-name)
```

**Cross-level navigation** — the first line under every topic heading, in every file, is
this nav strip (link to the other three levels; the current level is plain text):

```markdown
<sub>Levels: Foundation · [Understand](1_understand.md#t7-volatile-keyword) · [Interview](2_interview.md#t7-volatile-keyword) · [Production](3_production.md#t7-volatile-keyword)</sub>
```

If a level is split into parts, point at the correct part file.

---

## 4. THE FOUR LEVELS

Each level has both a target and an explicit exclusion list. The exclusions matter as
much as the targets: level bleed is the main failure mode of this format.

### Level 0 — `0_foundation.md`

**Reader finishes thinking:** *"I know what every concept is."*

For each topic, in 2–8 lines: what it is, why it exists, what problem it solves.

- Plain language. Define any unavoidable jargon inline, in one clause.
- At most one tiny code example, and only where prose genuinely fails.
- Every topic in the outline must appear here. Nothing may appear in a later level that
  was not at least named here.

**Does NOT belong here:** internals, comparisons, edge cases, complexity, trade-offs,
configuration, version differences.

### Level 1 — `1_understand.md`

**Reader finishes thinking:** *"I understand how this works."*

Build on Level 0 — do not restate what the thing is. Roughly 150–400 words per topic,
more for genuinely complex ones. Cover whichever apply:

- Mechanism, step by step
- How it interacts with other topics in *this* outline (reference them by `T` number)
- A Mermaid diagram where a flow, state machine, hierarchy, or memory layout is easier
  to see than to read
- Two or more examples that show *different angles*, not the same example twice
- Trade-offs, and the conditions under which each side wins
- Misconceptions and the reasoning error behind each one
- Time and space complexity, where meaningful
- **The core intuition:** one sentence, marked as such, that everything else hangs on
- Precise definitions of the terminology introduced

**Does NOT belong here:** interview framing, production tuning, deployment concerns,
tooling ecosystems.

### Level 2 — `2_interview.md`

**Reader finishes thinking:** *"I can answer questions on this and defend the answer."*

Use these subsections under each topic heading. **Required** ones always appear;
**conditional** ones appear only when they carry real content — omit them entirely
rather than writing "N/A" or padding.

| Subsection | Status |
|---|---|
| `### Definition` | required |
| `### Why It Exists` | required |
| `### Interview Explanation` | required — the crisp, spoken-aloud version, 3–6 sentences |
| `### Syntax` | conditional — only if the topic has syntax |
| `### Example` | required |
| `### Common Interview Questions` | required |
| `### Follow-up Questions` | required — the harder second-round questions, with answers |
| `### Edge Cases` | conditional |
| `### Common Mistakes` | required |
| `### Comparisons` | conditional — required if a natural counterpart exists |
| `### Complexity` | conditional — only where algorithmically meaningful |
| `### Frequently Confused With` | conditional |
| `### Important Facts to Remember` | required |

Where a natural counterpart exists (ArrayList vs LinkedList, HashMap vs Hashtable,
Runnable vs Thread, `COPY` vs `ADD`), include a comparison table with at least: use case,
performance, thread-safety or equivalent hazard axis, and a final `Pick this when…` row.

Include **interviewer traps** — questions that sound simple but have a sharp edge — and
call out the specific wrong answer most candidates give. Mark these with
`> 🎯 **Interview Note:**`.

**Does NOT belong here:** rediscovering the basics from Level 0, or production tuning
that no interviewer would probe.

### Level 3 — `3_production.md`

**Reader finishes thinking:** *"I know how professionals actually use this."*

Per topic, whichever apply:

- Best practices, stated as rules with the reason attached
- Performance, memory, and scalability considerations at realistic scale
- Readability and maintainability guidance
- Testing and debugging: what to assert, what to log, what to check first when it breaks
- Error handling and security implications
- Real production bugs and anti-patterns — each with a short *"what it looks like"*
  code snippet, then the fix
- Real-world use cases, concrete rather than generic
- Where the topic surfaces in the ecosystem's major frameworks and tools
- **Current recommended approach vs. deprecated/legacy approach**, explicitly labelled
  with versions. Say when the legacy approach became legacy and whether it still has
  legitimate uses. This is where stale advice does the most damage — be specific.

**Does NOT belong here:** re-teaching mechanism, interview framing.

---

## 5. GLOBAL REQUIREMENTS

1. **Self-containment.** Each file must be usable alone. A reader who opens only
   `2_interview.md` gets full value without having read the others.
2. **No re-explaining.** Depth increases monotonically. Don't pad earlier files to look
   complete; don't repeat earlier files' content in later ones. Self-containment comes
   from each level being complete *at its own altitude*, not from duplication.
3. **Heading hierarchy:** H1 = file title, H2 = topic, H3 = subsection. Consistent
   everywhere.
4. **Code blocks** use the subject's real language with correct fence tags
   (```java, ```sql, ```yaml, ```dockerfile, ```bash). Never pseudocode where real
   syntax is equally short. Code must be syntactically valid and compile-plausible.
5. **Mermaid diagrams** where they clarify. Keep them valid: quote every node label
   containing spaces or punctuation, avoid reserved words as node IDs, keep to
   ~12 nodes. If a diagram would just restate a bulleted list, use the list.
6. **Tables** for anything with two or more contrasted things.
7. **Callouts**, used sparingly — at most two or three per topic:
   > 💡 **Tip:** …
   > ⚠️ **Warning:** …
   > 🎯 **Interview Note:** …
   > ✅ **Best Practice:** …
8. **Accuracy over completeness.** Never invent an API, method, default value, flag, or
   behavior. If a detail is version-dependent, name the version. If you are not
   confident a specific number or default is correct, either omit it or mark it
   `⚠️ verify` — do not guess silently.
9. **Modern by default.** Use current APIs and idioms for the stated `version_target`.
   Cover legacy approaches only where the history explains why something still exists.
10. **No filler.** No "in today's fast-paced world", no restating the prompt, no
    apologising, no summary of what you're about to do. Start each file with its H1.

---

## 6. OPTIONAL — EXERCISES

If `include_exercises: true`, end each topic with:

- Level 0: one recall question with a one-line answer.
- Level 1: one "predict the output / explain why" snippet, answer collapsed in
  `<details><summary>Answer</summary>…</details>`.
- Level 2: one mock follow-up exchange (interviewer line, strong answer, weak answer).
- Level 3: one debugging scenario — symptom given, cause and fix collapsed.

---

## 7. LARGE SUBJECTS AND OUTPUT LIMITS

If a level would be unreasonably long (broad subjects like "Java", "System Design",
"DBMS"), split it by **contiguous topic ranges**, never by theme:

```
0_foundation_part1.md   (T1–T9)
0_foundation_part2.md   (T10–T18)
```

Each part gets its own local ToC covering its own range, plus prev/next part links at
top and bottom. The last topic of part N and the first of part N+1 must read like one
document split at a page break. Declare the split ranges in the manifest before writing,
and use the same ranges for every level so `1_understand_part2.md` covers the same
topics as `0_foundation_part2.md`.

**Continuation protocol.** If you approach an output limit, stop at a topic boundary —
never mid-topic — and end the message with:

```
<!-- CONTINUE: file=1_understand_part2.md next_topic=T14 -->
```

Then resume from exactly there when told to continue. Never abbreviate remaining topics
into a list to "fit", and never write "…and so on".

---

## 8. OUTPUT ORDER

1. **`manifest.yml`** (once, before any level file) — a real file, not a prose block, with
   exactly these keys. No commentary around it.

   ```yaml
   subject:            Java Collections Framework
   slug:               java-collections-framework
   category:           languages-and-runtimes
   summary:            One sentence on what this unlocks.
   tags:               [collections, data-structures, jvm]
   difficulty:         intermediate
   language_or_format: Java 21
   version_target:     Java 21 (LTS)
   audience:           strong mid-level engineer
   goal:               interview prep and on-the-job fluency
   topic_count:        24
   outline_version:    v1
   prereqs:            [java-generics]
   generated:          2026-07-25
   parts:                                    # omit this key entirely if unsplit
     - { range: T1-T9,   suffix: part1 }
     - { range: T10-T24, suffix: part2 }
   ```

2. `0_foundation.md`
3. `1_understand.md`
4. `2_interview.md`
5. `3_production.md`

Each file delivered as its own artifact/file, named exactly as above.

---

## 9. VERIFICATION GATE

Before delivering each file, check it against the outline. Do not print the checklist;
just fix what fails.

- [ ] Every outline topic appears, in outline order, with no additions or omissions.
- [ ] Heading text is byte-identical to the same topic's heading in the other files.
- [ ] Every ToC link resolves to a heading in that same file, per the §3 anchor rule.
- [ ] Every cross-level nav link points at a file and anchor that will exist.
- [ ] No topic appears that was not named in `0_foundation.md`.
- [ ] Level exclusions respected — no production tuning in Level 1, no basics in Level 3.
- [ ] Code blocks use real syntax with correct fence tags; Mermaid blocks parse.
- [ ] No invented APIs, defaults, or version claims; version-dependent facts are labelled.
- [ ] `manifest.yml` is present, has every key from §8, and its `parts` ranges cover the
      outline exactly once with no gaps or overlaps.

---

## 10. WHERE THIS OUTPUT GOES

The output is consumed unedited by a static study site. Nothing is post-processed by hand,
so these are hard requirements, not conventions:

- All five files go in one folder: `content/<category>/<slug>/`, taken from the manifest.
- **Never add YAML frontmatter to a level file.** Metadata lives only in `manifest.yml`;
  a level file starts with its H1. A `---` block at the top of a level file breaks parsing.
- Filenames are exact and lowercase: `manifest.yml`, `0_foundation.md`, `1_understand.md`,
  `2_interview.md`, `3_production.md`, suffixed `_part1`/`_part2`/… when split.
- The outline comment appears exactly once, in `0_foundation.md` — or in
  `0_foundation_part1.md` if level 0 is split. Never in part 2, never in another level.
- Keep the `## Table of Contents` heading and the `<sub>Levels: …</sub>` nav strips. The
  site strips them from the render and uses them as build-time checksums, so they must be
  correct even though the reader never sees them.
- Emit callouts with the emoji forms from §5.7 (`> 💡 **Tip:**` etc.). The site maps them.
- Keep `⚠️ verify` markers exactly as written — the site collects them into a review queue.
  An honest marker is far more useful than a confident guess.

The full parsing and validation spec is `CONTENT-CONTRACT.md` in that repo. If you are ever
unsure how something will be read, that file is authoritative.

---

**Subjects this format suits**

| Area | Examples |
|---|---|
| Languages and runtimes | Java · Python · Go · TypeScript · Rust · C++ · JVM Internals · Java Memory Model · Java Collections Framework · Concurrency and Multithreading · Garbage Collection |
| CS fundamentals | Operating Systems · Computer Networks · Data Structures and Algorithms · Compilers · Computer Architecture · Cryptography Fundamentals |
| Data | DBMS · SQL · PostgreSQL Internals · Query Optimization · Database Indexing · Transactions and Isolation Levels · MongoDB · Redis · Elasticsearch · Apache Kafka · Data Modeling |
| Backend and frameworks | Spring Boot · Hibernate and JPA · Node.js and Express · Django · REST API Design · GraphQL · gRPC · Authentication and Authorization · Microservices Patterns |
| Frontend | React · Next.js · State Management · Browser Rendering Pipeline · CSS Layout · Web Performance · Web Accessibility |
| Infrastructure and ops | Docker · Kubernetes · Linux · Bash and Shell Scripting · Git · CI and CD Pipelines · Terraform · Nginx · Observability and Monitoring · AWS Core Services |
| Architecture | System Design · Distributed Systems · Caching Strategies · Message Queues · Consensus Algorithms · Event Driven Architecture · Scalability Patterns |
| ML and AI | Machine Learning Fundamentals · Deep Learning · Transformers and Attention · PyTorch · Prompt Engineering · Retrieval Augmented Generation · MLOps |
| Security | Web Application Security · OWASP Top Ten · TLS and PKI · Secure Coding Practices · Threat Modeling |

> 💡 **Tip:** The format works best on subjects with 15–35 genuinely distinct leaf
> concepts. Narrower topics (a single algorithm, one library method) don't need four
> zoom levels; broader ones (all of "backend engineering") should be split into several
> runs of this prompt rather than one oversized outline.
