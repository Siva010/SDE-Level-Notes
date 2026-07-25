# Content contract

Normative. This is the interface between notes written in chat and the site that renders
them. Both sides are built against this file; where any other document disagrees, this one
wins.

---

## 1. Folder layout

### Subject — the primary shape

```
content/<category>/<slug>/
  manifest.yml
  0_foundation.md
  1_understand.md
  2_interview.md
  3_production.md
```

Split subjects repeat each level across contiguous topic ranges, identically per level:

```
  0_foundation_part1.md    1_understand_part1.md    2_interview_part1.md    3_production_part1.md
  0_foundation_part2.md    1_understand_part2.md    2_interview_part2.md    3_production_part2.md
```

Level base names are fixed: `0_foundation`, `1_understand`, `2_interview`, `3_production`.
Part suffix is `_<suffix>` where `<suffix>` comes from `manifest.parts[].suffix`.

### Note — the secondary shape

`content/<category>/<slug>.md`, a single file with ordinary YAML frontmatter
(`title`, `summary`, `tags`, `difficulty`, optional `prereqs`). Treated as a subject with
one level and no outline. Same reading page; depth control hidden.

---

## 2. `manifest.yml`

| Key | Type | Required | Validation |
|---|---|---|---|
| `subject` | string | yes | non-empty |
| `slug` | string | yes | kebab-case; **must equal the folder name** |
| `category` | string | yes | kebab-case; **must equal the parent folder name** |
| `summary` | string | yes | one sentence, ≤ 200 chars |
| `tags` | string[] | yes | kebab-case, 1–8 entries |
| `difficulty` | enum | yes | `intro` \| `intermediate` \| `advanced` |
| `language_or_format` | string | yes | free text |
| `version_target` | string | yes | free text |
| `audience` | string | yes | free text |
| `goal` | string | yes | free text |
| `topic_count` | integer | yes | must equal the parsed outline length |
| `outline_version` | string | yes | must equal the version in the outline comment |
| `prereqs` | string[] | yes | subject slugs; `[]` allowed; every entry must resolve |
| `generated` | date | yes | ISO `YYYY-MM-DD` |
| `parts` | array | no | omit when unsplit; see below |

`parts[]` entries are `{ range: "T1-T9", suffix: "part1" }`. Ranges are inclusive, use
top-level topic IDs only, must be contiguous and ascending, must cover the outline exactly
once, and every `(level, suffix)` file they imply must exist.

Unknown top-level keys are a warning, not an error — the generator may add fields later.

---

## 3. The outline comment

Appears **exactly once** per subject, in `0_foundation.md`, or in `0_foundation_part1.md`
when level 0 is split. Never elsewhere. Never rendered.

```
<!-- OUTLINE v1
T1. Topic Name
T2. Topic Name
T3. Topic Name
T3.1. Subtopic Name
-->
```

Line grammar: `^(T\d+(?:\.\d+)?)\.\s+(.+)$` → `id`, `name`.

The outline is the single source of truth for which topics exist and in what order. Every
level is checked against it. Nothing is inferred from a level file that contradicts it.

`Tn.m` is a child of `Tn`; it must appear directly after `Tn` or after a sibling `Tn.k`.
Nesting is one level deep only.

**Topic names are anchor-safe by contract:** letters, digits, spaces, hyphens. Anything
else is an error, because the generator hard-codes anchors derived from these names.

---

## 4. Topic headings and anchors

Every topic is an H2, byte-identical across all four levels:

```markdown
## T7. Volatile Keyword
```

Anchor derivation — deterministic, and your slugifier must be overridden to match, because
the generator writes these anchors into links before the site exists:

```
anchor(id, name) = lower(id.replace('.', '-')) + '-' + lower(name).replace(/\s+/g, '-')
```

| Heading | Anchor |
|---|---|
| `## T7. Volatile Keyword` | `t7-volatile-keyword` |
| `## T4.1. Fail Fast Iterators` | `t4-1-fail-fast-iterators` |
| `## T12. Interface vs Abstract Class` | `t12-interface-vs-abstract-class` |

`## Table of Contents` is also an H2. Recognise it by exact text and exclude it from topic
detection. Anything else that is an H2 and does not match the topic grammar is an error.

Heading hierarchy inside a topic: H3 = subsection. H1 is the file title only.

---

## 5. Part stitching

Parts are an output-limit artifact, never a reading unit. Concatenate a level's parts in
`manifest.parts` order into one continuous level before rendering. The reader must never
see a seam: no part links in the UI, prev/next crosses boundaries invisibly, the level ToC
and read time cover the whole level.

Strip from every part file before stitching:

- The `## Table of Contents` heading and its list.
- Prev/next part links at the top and bottom (a link whose target matches
  `<level_base>_<suffix>.md`, in a paragraph containing no other content).
- Any trailing `<!-- CONTINUE: … -->` comment.

If two parts both contain the same topic ID, that is an error — not a silent dedupe.

---

## 6. Strip and verify

These exist in the source for the generator's own consistency. Remove them from the render,
but check them first — they are free checksums.

**In-file ToC.** Its links must match this file's topic range in outline order. Mismatch is
an error.

**Cross-level nav strip.** The first line under every topic heading:

```markdown
<sub>Levels: Foundation · [Understand](1_understand.md#t7-volatile-keyword) · [Interview](2_interview.md#t7-volatile-keyword) · [Production](3_production.md#t7-volatile-keyword)</sub>
```

Parse it: the plain-text level names which level file this is, and the anchors declare what
this topic's anchor should be. Disagreement with the filename or the computed anchor is an
error. Then strip the line — the depth control replaces it.

---

## 7. Extraction targets

**Level 2 subsections.** `2_interview.md` uses a closed H3 vocabulary. Parse into named
fields; this is structured data wearing markdown.

Required: `Definition`, `Why It Exists`, `Interview Explanation`, `Example`,
`Common Interview Questions`, `Follow-up Questions`, `Common Mistakes`,
`Important Facts to Remember`.
Conditional: `Syntax`, `Edge Cases`, `Comparisons`, `Complexity`, `Frequently Confused With`.

A missing required subsection is a warning. An unrecognised H3 is a warning and renders as
a plain subsection.

**Callouts.** Blockquotes whose first line starts with a known emoji marker:

| Source prefix | Type |
|---|---|
| `> 💡 **Tip:**` | `tip` |
| `> ⚠️ **Warning:**` | `warning` |
| `> 🎯 **Interview Note:**` | `interview` |
| `> ✅ **Best Practice:**` | `best-practice` |
| `> [!note]` / `> [!warning]` / `> [!insight]` | same components, for notes |

Strip the marker and the bold label from the rendered body; the component supplies them.

**Verify markers.** The literal `⚠️ verify` anywhere in body text marks a fact the generator
was not confident about. Render as an inline chip, and collect every instance with subject,
topic ID, level, and the containing sentence into a `/verify` queue. Never an error.

**T-references.** Match `T\d+(\.\d+)?` in prose, link to that topic in the same subject at
the **current level**. Only when the ID exists in the outline. Never inside code spans,
fenced blocks, headings, or link text. Backticks opt out.

**Wikilinks.** `[[subject-slug]]` and `[[subject-slug#t7]]`. Unresolvable target is an
error. Hover preview shows the manifest summary; for topic links, the Level 0 body of that
topic — a two-to-eight-line definition is exactly hover-card sized.

**Also render:** mermaid, KaTeX `$…$` and `$$…$$`, footnotes, task lists, tables,
`<details>` blocks, heading permalinks, and fenced code with a copy button.

---

## 8. Card harvesting

Generated files contain no `::` or `{{cloze}}` markers and never will. Cards come from
structure. Every card carries `{ subject, topicId, level, sourceKind }`.

| Source | Card |
|---|---|
| Level 0 topic body | basic — topic name → what it is |
| L2 `Common Interview Questions` | Q/A, one per question |
| L2 `Follow-up Questions` | Q/A, tagged `hard` |
| L2 `Important Facts to Remember` | cloze, one blank per bullet |
| L2 `Comparisons` table | cloze over cells, keyed by row + column header |
| L1 `<details><summary>Answer</summary>` | predict-the-output; prompt is the preceding snippet |
| L3 debugging scenario `<details>` | symptom → cause/fix |
| `::` and `{{curly}}` | only in loose notes |

Card identity is `subject/topicId/level/sourceKind/index`, so regenerating a subject
preserves scheduling for cards that still exist and orphans the rest cleanly. Never key a
card by its text.

---

## 9. Reading-view stripping summary

Removed before render: outline comment, in-file ToC, nav strips, part prev/next links,
`CONTINUE` comments. Everything else renders.

---

## 10. Parsed shape

```ts
type LevelId = 0 | 1 | 2 | 3;

interface TopicNode {
  id: string;            // "T7" | "T4.1"
  name: string;
  anchor: string;
  children: TopicNode[];
}

interface TopicBody {
  topicId: string;
  html: string;
  wordCount: number;
  readTimeMin: number;
  headings: { depth: 3; text: string; anchor: string }[];
  subsections?: Record<string, string>;   // level 2 only
  verifyMarkers: VerifyMarker[];
}

interface Level {
  id: LevelId;
  topics: Map<string, TopicBody>;         // keyed by topic id, outline-ordered
  readTimeMin: number;
}

interface Subject {
  slug: string;
  category: string;
  manifest: Manifest;
  outline: TopicNode[];
  levels: Map<LevelId, Level>;
  cards: Card[];
  verifyMarkers: VerifyMarker[];
}
```

---

## 11. Validation gate

Run at build (failing the build on any error) and on demand via `npm run validate`. Every
message names the file, the topic ID, and expected vs actual. Codes are stable and
greppable.

### Errors

| Code | Condition |
|---|---|
| `E001` | `manifest.yml` missing, unparseable, or missing a required key |
| `E002` | `manifest.slug` or `manifest.category` disagrees with the folder path |
| `E003` | A level file is missing, or a file implied by `parts` is absent |
| `E004` | `parts` ranges have a gap, an overlap, or don't cover the outline exactly |
| `E005` | Outline comment missing, malformed, or present in more than one file |
| `E006` | A topic name contains a character outside `[A-Za-z0-9 -]` |
| `E007` | A level's topic set differs from the outline — missing, extra, or misordered |
| `E008` | Heading text for a topic is not byte-identical across all present levels |
| `E009` | A topic appears in a later level but not in `0_foundation.md` |
| `E010` | Duplicate topic ID, or two topics resolving to the same anchor |
| `E011` | An H2 that is neither `Table of Contents` nor a valid topic heading |
| `E012` | In-file ToC disagrees with the outline for that file's range |
| `E013` | A nav strip's declared level or anchor disagrees with the file or heading |
| `E014` | A `T`-reference resolves to an ID not in the outline |
| `E015` | An unresolvable `[[wikilink]]` or `prereqs` entry |
| `E016` | `topic_count` or `outline_version` disagrees with the parsed outline |
| `E017` | YAML frontmatter found at the top of a level file |
| `E018` | Nesting deeper than one level (`T4.1.2`), or `Tn.m` with no preceding `Tn` |

### Warnings

Surfaced in the build report and on `/verify`; never fail the build.

| Code | Condition |
|---|---|
| `W001` | A required Level 2 subsection is missing for a topic |
| `W002` | A code fence has no language tag |
| `W003` | A mermaid block fails to parse — render the source in a fallback, never blank |
| `W004` | A topic's Level 3 body is shorter than its Level 1 body |
| `W005` | A topic is absent from levels 1–3 while present in level 0 (incomplete run) |
| `W006` | An `⚠️ verify` marker |
| `W007` | An unknown top-level key in `manifest.yml` |
| `W008` | An unrecognised H3 in `2_interview.md` |

---

## 12. Required fixtures

`npm test` runs the parser and validator against committed fixtures. At minimum, one
valid subject and one deliberately broken fixture per error code above. A fixture proves
the error message is legible, not just that it fires.
