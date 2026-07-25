# Build phases

One phase per Claude Code session. Ship each working before starting the next. Update the
checkboxes as you go; the first unchecked phase is the current one.

Acceptance means **demonstrated** — commands run, output shown, breakage deliberately
induced and the error confirmed legible. Not asserted in prose.

---

## Phase 1 — Pipeline and gate

- [ ] Not started

Nothing renders until parsing and validation are solid. This is the phase everything else
rests on, and the one most likely to be rushed.

**Build**

- Astro project, TypeScript strict, static output.
- Custom content loader: the unit is a folder with `manifest.yml`, not a file with
  frontmatter. Loose single-file notes supported by the same loader.
- Manifest schema validation per `CONTENT-CONTRACT.md` §2.
- Outline parsing, topic/heading parsing, the anchor algorithm (§4) wired into the
  markdown pipeline so heading permalinks match generated anchors exactly.
- Part stitching (§5) and the strip list (§6, §9).
- The full validation gate (§11) as `npm run validate`, run automatically before `build`.
- Parser unit tests against fixtures (§12).
- **Seed subject**: run the generator on a real subject and commit the output. It must be
  part-split, contain a nested `T4.1`, a mermaid diagram, a comparison table, at least one
  `⚠️ verify` marker, and exercises. Plus one loose note.
- A deliberately ugly `/` route listing subjects and topics as plain text.

**Accept when**

```
npm run validate           # green on seed content
npm test                   # fixtures pass
npm run build              # succeeds
```

and each of these, done live, produces a clear message naming file, topic, expected, actual:

- Rename a heading in `2_interview.md` only → `E008`.
- Delete `1_understand_part2.md` → `E003`.
- Change one `parts` range to leave a gap → `E004`.
- Add `---\ntitle: x\n---` to a level file → `E017`.
- Point a `prereqs` entry at a nonexistent slug → `E015`.

**Do not build yet:** styling, the depth control, search, highlights, cards, dashboard.

---

## Phase 2 — Reading page

- [ ] Not started

**Build**

- Routes: `/<subject>/<topic-anchor>` (canonical, level as state) and `/<subject>/<level>`
  (read a level straight through).
- **The depth control.** Switching level swaps the body in place, holding the topic and
  scroll position within it. Keys `0`–`3` jump, `[` / `]` step. Absent levels are visibly
  absent, not disabled-looking. This is the site's reason to exist — build it first in
  this phase and get it right before decorating anything.
- Final typography from `DESIGN.md`: measure, type scale, baseline rhythm, light and dark.
- Sticky ToC from h2/h3 with scroll-spy. Quiet — no border, no box.
- Hairline reading progress. Meta line: read time for the current level, difficulty, last
  updated, verify count.
- Prev/next topic in outline order, staying at the current level.
- Callout components, mermaid, KaTeX, Shiki, copy buttons, `<details>`.
- Comparison tables at 375px: horizontal scroll, sticky first column.
- Level 3 current-vs-deprecated pairs visually unmistakable.
- Wikilink hover previews, T-reference links.

**Accept when**

Reading a topic at Level 1, pressing `2`, and landing on the interview treatment of the
same topic at the same scroll position feels better than four tabs. No layout shift.
Lighthouse accessibility 100 on a topic page. Works at 375px.

**Do not build yet:** search, palette, study tools, dashboard.

---

## Phase 3 — Navigation and search

- [ ] Not started

**Build**

- Search index unit is `(subject, topic, level)`; **result unit is `(subject, topic)`**,
  with chips showing which levels matched. Never the same topic four times.
- `⌘K` palette: subjects, summaries, topic names, headings, body text, plus commands
  (theme, review, random topic, jump to level). A trailing digit filters level —
  `volatile 2` goes straight to the interview treatment.
- Library page: subjects grouped by category, expandable to their outline, filterable by
  category / tag / difficulty / depth-read. Dense list default, card grid optional.
- Keyboard map complete, `?` overlay showing it.

**Accept when** searching a term that appears at all four depths returns one row, and
expanding it picks a depth. Every route reachable from the keyboard alone.

---

## Phase 4 — Study layer

- [ ] Not started

Build in this order; each works before the next.

1. **Highlights** — select, `h`, persists per topic *and* level, optional note. Per-topic
   sidebar and `/highlights`.
2. **Recall mode** — blanks harvested cloze spans and collapses `<details>` in place;
   click reveals one, `r` reveals all.
3. **Card harvesting** per `CONTENT-CONTRACT.md` §8, then SM-2 review
   (again / hard / good / easy → interval + ease factor). Filterable by subject, topic
   range, and level.
4. **Quiz** — inline ` ```quiz ` blocks answerable in place with the `why:` explanation.

**Accept when** regenerating a subject with one topic renamed preserves scheduling for
every surviving card and orphans only the affected ones. Test this explicitly.

---

## Phase 5 — Dashboard and polish

- [ ] Not started

**Build**

- `/` — what's due, which subjects are shallow, what's new since last visit, recently
  highlighted, verify markers outstanding. Not a wall of stat cards.
- Two-dimensional progress: deepest level read per topic; a subject reads as a depth
  profile, plus one headline number.
- `/verify` queue with subject, topic, level, sentence, and a link into the page.
- Export/import all `localStorage` as one JSON file, explained plainly in settings.
- Motion pass: 150–250ms, `prefers-reduced-motion` honoured.
- Accessibility pass: 100 across all route types.

**Accept when** the §12 statement in `BRIEF.md` is true end to end: generate a new subject
in chat, drop the folder in, start the dev server, and it appears everywhere with zero
edits to any file.
