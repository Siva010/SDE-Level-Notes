# Brief: a four-level study library that grows one subject at a time

Build me a static reading site that turns a folder of generated markdown into a study library I actually want to open. Minimal in appearance, dense in capability.

The content is not hand-written. It comes from a generator prompt (`prompts/four-level-generator.md`, checked into this repo) that emits, for one technical subject, **four markdown files over an identical topic outline** — same topics, same order, increasing depth:

| File | Reader finishes thinking |
|---|---|
| `0_foundation.md` | "I know what every concept is." |
| `1_understand.md` | "I understand how this works." |
| `2_interview.md` | "I can answer questions on this and defend the answer." |
| `3_production.md` | "I know how professionals actually use this." |

The site's whole reason to exist is the **fourth dimension that a plain folder of markdown can't give me: changing depth on a topic without losing my place.** Everything below serves that.

---

## 1. The non-negotiable constraint

**Adding a subject = dropping one folder of unmodified generator output into `content/`.**

No registry to update, no route to create, no config to edit, no import to add, and — critically — **no hand-editing of the generated files**. No adding frontmatter, no rewriting links, no reformatting callouts. The generator's output is the input format. If a feature you build would require me to touch a generated file or a second file elsewhere, redesign that feature.

Everything the site needs beyond the raw prose is either declared once in `manifest.yml` (which the generator writes) or derived at build time from the files themselves.

## 2. Content model

### Shape A — a subject (the primary shape)

```
content/<category>/<subject-slug>/
  manifest.yml
  0_foundation.md
  1_understand.md
  2_interview.md
  3_production.md
```

Long subjects are split by contiguous topic range, identically across levels:

```
  0_foundation_part1.md   (T1–T9)
  0_foundation_part2.md   (T10–T18)
  1_understand_part1.md   (T1–T9)
  ...
```

Parts are an artifact of the generator's output limits, not a reading unit. **The site stitches them back into one continuous level.** A reader must never see the seam: no part navigation in the UI, prev/next crosses part boundaries invisibly, and the level reads as one document.

### `manifest.yml` — the only declared metadata

```yaml
subject:            Java Collections Framework
slug:               java-collections-framework
category:           languages-and-runtimes
summary:            One sentence on what this unlocks, shown on cards and hover previews.
tags:               [collections, data-structures, jvm]
difficulty:         intermediate        # intro | intermediate | advanced
language_or_format: Java 21
version_target:     Java 21 (LTS)
audience:           strong mid-level engineer
goal:               interview prep and on-the-job fluency
topic_count:        24
outline_version:    v1
prereqs:            [java-generics]     # subject slugs — render as links, fail build if broken
generated:          2026-07-25
parts:                                  # omit entirely if unsplit
  - { range: T1-T9,   suffix: part1 }
  - { range: T10-T24, suffix: part2 }
```

Validate with a schema. Fail loud with the folder name and the missing field — never silently render a broken subject.

### Derived, never declared

Anything the files already contain must be read from the files. Declaring it twice creates drift.

| Thing | Source of truth |
|---|---|
| Topic IDs, names, order | the `<!-- OUTLINE v1 … -->` comment in `0_foundation.md` |
| Topics present per level | the `## T7. Name` headings in each file |
| Which levels exist | files on disk |
| Read time, word count | computed per topic and per level |
| `updated` | git commit date, falling back to file mtime |
| Per-topic prerequisites | outline order — topics are dependency-ordered, so "assumes T1–T6" is free |

### Reader state is never in a file

The original version of this brief had `status: draft | active | mastered` in frontmatter. That was wrong: it is reader state, and editing a generated file to record that I read it violates §1. **All progress, mastery, highlights, and card scheduling live in `localStorage` only.** Files are immutable input.

### Shape B — a loose note

A bare `content/<category>/<slug>.md` with normal frontmatter (`title`, `summary`, `tags`, `difficulty`) is a subject with exactly one level. Same reading page, level control hidden. Keep this path working — not every thought needs four zoom levels.

## 3. Parse contract

The generator's output has structure the site must exploit rather than fight. Handle each of these deliberately.

**The outline comment.** `0_foundation.md` opens with:

```
<!-- OUTLINE v1
T1. Topic Name
T2. Topic Name
T3.1. Subtopic Name
-->
```

This is the backbone. Parse it into the topic tree, use it to order everything, and check all four levels against it. Never render it.

**Topic headings.** `## T7. Volatile Keyword`, byte-identical across all four levels. Anchor is deterministic: lowercase, drop the period, spaces to hyphens → `#t7-volatile-keyword`. Your heading-permalink slugifier must produce exactly this, because the generator hard-codes these anchors.

**Nested topics.** `T4.1` is an H2 in the source, same as `T4`, but renders as a child of `T4` in the ToC and topic list. Anchor `#t4-1-name`.

**The in-file ToC.** Each file opens with a `## Table of Contents` H2. Strip it — the site builds its own — but validate it against the outline first. A mismatch is a build error.

**The cross-level nav strip.** The first line under every topic heading is a `<sub>Levels: … </sub>` line linking to the other three files. Strip it entirely; the level control replaces it. Then use it as a checksum: it declares which level the file thinks it is and which anchor it expects. Disagreement with the filename or heading is a build error.

**Level 2 subsections.** Every topic in `2_interview.md` uses a fixed H3 vocabulary: `Definition`, `Why It Exists`, `Interview Explanation`, `Syntax`, `Example`, `Common Interview Questions`, `Follow-up Questions`, `Edge Cases`, `Common Mistakes`, `Comparisons`, `Complexity`, `Frequently Confused With`, `Important Facts to Remember`. This is structured data wearing markdown. Parse it — the study layer in §6 depends on it. Unrecognised H3s in that file are a warning, not an error.

**Callouts.** The generator emits emoji-prefixed blockquotes, not `[!note]` syntax. Map them:

| Source | Renders as |
|---|---|
| `> 💡 **Tip:**` | tip |
| `> ⚠️ **Warning:**` | warning |
| `> 🎯 **Interview Note:**` | interview trap — the most distinctive callout on the site, give it its own treatment |
| `> ✅ **Best Practice:**` | best practice |
| `> [!note]` `> [!warning]` `> [!insight]` | same components, for hand-written notes |

**`⚠️ verify` markers.** The generator marks any fact it isn't confident about with `⚠️ verify`. This is the single most useful affordance in LLM-generated study material — treat it as first-class. Render as a distinct inline chip, count per subject, and collect every instance on a `/verify` page with topic, level, and surrounding sentence. Not an error; a queue.

**`T`-number cross-references.** Level 1 references sibling topics by number ("as in T4"). Linkify `T<digits>(.<digits>)?` to that subject's topic **at the current level**, but only when it matches a real outline ID and is not inside code, a fence, or a heading. Wrapping in backticks opts out.

**Wikilinks.** `[[subject-slug]]` and `[[subject-slug#t7]]` link across subjects, with a hover preview card showing the manifest summary and, for topic links, the Level 0 body — the two-to-eight-line definition is exactly the right size for a hover card.

**Also support:** mermaid, KaTeX (`$…$` / `$$…$$`), footnotes, task lists, tables, `<details>` blocks, and syntax-highlighted code with a copy button.

## 4. Build-time validation gate

The generator prompt ends with a verification checklist that an LLM promises to have followed. **Make it a compiler.** This is the highest-value thing in this build and it comes before any polish.

Errors — fail the build, name the file, topic ID, and expected vs actual:

- A level file is missing, or a declared part file is absent.
- Part ranges have a gap, an overlap, or don't cover the outline exactly.
- Any level's heading set differs from the outline — missing topic, extra topic, wrong order, or heading text not byte-identical across levels.
- A topic appears in a later level that isn't in `0_foundation.md`.
- Duplicate or non-deterministic anchors.
- A `T`-reference, wikilink, or `prereqs` entry points at something that doesn't exist.
- The in-file ToC or a nav strip contradicts the outline.
- `manifest.category` disagrees with the folder path.

Warnings — surface in a build report and on `/verify`, don't fail:

- A required Level 2 subsection is missing for a topic.
- A code fence has no language tag.
- A mermaid block fails to parse (render the source in a fallback rather than blanking the page).
- A topic's Level 3 body is shorter than its Level 1 body — usually means the generator ran out of steam near the end of a part.
- Any `⚠️ verify` marker.

Run this as `npm run validate` too, so I can check a generator run before committing it.

## 5. Reading experience

A single measured column, roughly 62–70 characters, centered, with real vertical rhythm on a defined baseline scale. A deliberate type pairing and a type scale you actually define. Light and dark both first-class; neither pure white nor pure black. Images, diagrams, and comparison tables break the measure slightly wider; nothing else does. No layout shift on load. Motion 150–250ms, respecting `prefers-reduced-motion`. Responsive to 375px. Visible keyboard focus everywhere.

**The depth control is the core interaction.** Get it right before anything else:

- Canonical route is topic-centric: `/<subject>/<topic-anchor>`, with level as state. `/<subject>/<level>` reads a whole level straight through.
- Switching level swaps the body **in place, holding the topic and the scroll position within it.** Never a page-top jump. This is the entire premise of the site.
- Keys `0` `1` `2` `3` jump to a level; `[` and `]` step depth. These get the best keys on the keyboard.
- The control shows which levels have been read for this topic, so depth doubles as progress.
- Levels a subject doesn't have are visibly absent, not disabled-looking.

Then:

- Sticky table of contents from `h2`/`h3` with scroll-spy, quiet — no border, no box, just type. In Level 2 it shows the fixed subsection vocabulary, which makes it a predictable rail rather than a random list.
- A hairline reading-progress indicator.
- Meta line under the title: read time *for the current level*, difficulty, last updated, verify-marker count if any.
- Prev/next topic footer in outline order, staying at the current level.
- Comparison tables at 375px: horizontal scroll with a sticky first column, never a squashed reflow.
- Level 3's "current vs deprecated approach" pairs get a visual treatment that makes the deprecated side unmistakable at a glance.

## 6. Study layer

Reading view stays clean. Study tools live behind a toggle so the page never looks like a dashboard.

**Cards are harvested from structure, not from special syntax.** The generated files contain no `::` or `{{cloze}}` markers, and I'm not adding any. Build the deck from what's already there — run the generator with `include_exercises: true` and this gets richer still:

| Source in the files | Becomes |
|---|---|
| Level 0 topic body | basic card: topic name → what it is |
| Level 2 `Common Interview Questions` | Q/A card — the highest-value source in the corpus |
| Level 2 `Follow-up Questions` | Q/A card, tagged harder |
| Level 2 `Important Facts to Remember` bullets | cloze cards, one blank per bullet |
| Level 2 `Comparisons` table rows | cloze cards over cells |
| Level 1 exercise `<details>` blocks | predict-the-output card |
| Level 3 debugging scenarios | symptom → cause/fix card |
| `::` and `{{curly}}` in loose notes | as before, for hand-written content |

Every card carries its subject, topic ID, and level, so I can review "T9 through T14 at interview level" or "everything due in this subject".

- **Highlight** — select text, press `h`, persists per topic *and level*. Optional note. Collected on a per-topic sidebar and a global `/highlights` page.
- **Recall mode** — blanks harvested cloze spans and collapses `<details>` in place; click to reveal one, `r` for all.
- **Review** — SM-2 spaced repetition (again / hard / good / easy → interval + ease factor). Due cards surface on the dashboard.
- **Quiz** — inline ` ```quiz ` blocks answerable in place with immediate feedback and the `why:` explanation, for hand-written notes.
- **Progress is two-dimensional.** A topic isn't read or unread; it's been reached to some depth. Track the deepest level read per topic. Subject completion is a depth profile, not a percentage — though give me one number too.
- **Dashboard at `/`** — what's due, which subjects are shallow, what's new since last visit, recently highlighted, verify markers outstanding. Not a wall of stat cards.
- **Data portability** — everything in `localStorage`, with export/import as a single JSON file, stated plainly in a settings panel. Export must survive content changes: key state by `subject/topic-id/level`, not by file offset. No backend, no accounts, no database.

## 7. Navigation and search

- **Index unit is (subject, topic, level); result unit is (subject, topic).** Searching "volatile" returns one result with chips showing which levels matched — never the same topic four times. Expand to pick a level. Getting this collapse right is what stops search from feeling like a duplicate mess.
- `⌘K` palette: fuzzy across subject titles, summaries, topic names, headings, and body text, plus commands (toggle theme, start review, random topic, jump to level). A trailing digit filters level — `volatile 2` goes straight to the interview treatment.
- Library page: subjects grouped by category, expandable to their topic outline, filterable by category / tag / difficulty / depth-read. Dense list default, card grid optional.
- Keyboard-first: `/` search, `j`/`k` move, `0`–`3` and `[`/`]` depth, `t` theme, `h` highlight, `?` overlay. Show the overlay.

## 8. Design direction

Minimalist here means *precise*, not *empty*. The restraint has to be earned by typography, spacing, and detail — strip decoration and put nothing rigorous in its place and it just reads as unfinished.

Before writing any code, produce a compact token plan: 4–6 named hex values, typefaces for display / body / mono, a layout concept, and one signature element the site is remembered by. Then review that plan and revise anything that reads like the default you'd generate for any documentation site.

Spend boldness in exactly one place. The depth control is the obvious candidate — it's the one thing here no other reading site has — but argue for your choice rather than defaulting to it. Everything around the signature element stays quiet.

Specifically avoid, because they are AI-design tells rather than choices:

- cream `#F4F1EA` background + high-contrast serif + terracotta accent
- near-black + one acid-green or vermilion accent
- broadsheet pastiche: hairline rules, zero radius, dense newspaper columns
- purple/blue gradients, glassmorphism, generic component-library defaults
- the depth control as a row of generic pill tabs, a segmented iOS toggle, or a four-bar signal-strength icon

## 9. Tech

Astro with content collections and MDX, islands only for the interactive study components, Pagefind or minisearch for search, KaTeX and Shiki for rendering. Next.js App Router only if you can justify it in one line. Static output, deployable to Vercel / Netlify / GitHub Pages. TypeScript. No CSS framework unless you can show it isn't fighting the type system you designed.

Content collections need a custom loader: the unit is a folder, not a file, and the schema is `manifest.yml` rather than frontmatter. Parsing (outline, headings, subsections, callouts, verify markers, part stitching) happens once at build time into a typed structure the pages consume — never re-parse markdown in a component.

## 10. Growth protocol

I append subjects forever, so ship the workflow too:

- `npm run new:subject "Consistent Hashing" --category distributed-systems` — writes `manifest.yml` with everything it can infer, and prints the four-level generator prompt with `subject:` already filled in, ready to paste. The site emits the prompt that produces its own next input; that loop is the point.
- `npm run validate [folder]` — runs §4 against a generator run before I commit it. Clear pass/fail per check.
- `npm run new:note "Title" --category x` — the loose single-file path.
- `prompts/four-level-generator.md` — the generator prompt, checked in, kept as the source of truth for the input format. If you change what the site parses, change this file in the same commit.
- `AUTHORING.md` — one page covering the loose-note syntax and, for generated subjects, exactly which structures the site extracts and why editing them by hand breaks things.
- Seed `content/` with **one real subject at all four levels, part-split, with at least one nested `T4.1` topic, one mermaid diagram, one comparison table, one `⚠️ verify` marker, and exercises enabled** — plus one loose note. Real generator output, not lorem ipsum. The rendering has to be proven against the actual shape of the thing.

## 11. Build order

Ship each phase working before starting the next.

1. Folder-based content collection, `manifest.yml` schema, outline parsing, part stitching, and the §4 validation gate. Nothing renders until this is solid.
2. Reading page with final typography, the depth control, ToC, prev/next.
3. Library index, command palette, search with level-collapsed results, keyboard map.
4. Study layer: highlights → recall → card harvesting + SRS → quiz.
5. Dashboard, depth-aware progress, `/verify`, `/highlights`, export/import, polish.

## 12. Done means

Run the generator on a new subject, drop the folder into `content/`, start the dev server, and with **zero edits to any file** it appears in the library, the search index, the wikilink graph, the prereq graph, and the flashcard pool — all four levels wired, anchors resolving, parts seamless, validation green.

Then: reading a topic at Level 1, pressing `2`, and landing on the interview treatment of the same topic at the same scroll position is something I'd choose over having four markdown files open in four tabs. Lighthouse accessibility is 100. Nothing on screen exists that isn't doing a job.

Start with the token plan and a one-paragraph summary of your approach. Wait for my go-ahead before building.
