# Authoring

Two ways in. Most content takes the first.

---

## A. Add a subject — four levels, generated in chat

1. `npm run new:subject "Consistent Hashing" --category distributed-systems`

   Creates `content/distributed-systems/consistent-hashing/` with a partial `manifest.yml`,
   and prints the generator prompt with `subject:` already filled in.

2. Paste that prompt into a fresh chat. Let it run; when it stops at a topic boundary with
   a `<!-- CONTINUE: … -->` marker, reply `continue`.

3. Save each artifact into the folder under its exact given name. Nothing else — no
   renaming, no tidying, no adding frontmatter.

4. `npm run validate content/distributed-systems/consistent-hashing`

5. Green? `npm run dev` and it's live everywhere: library, search, wikilink graph, prereq
   graph, flashcard pool. Zero other edits.

### Never hand-edit a generated file

Not to fix a typo, not to reformat a callout, not to add frontmatter. The files are
machine input with several redundant consistency signals in them — the in-file ToC, the
`<sub>Levels:</sub>` nav strips, the outline comment — and the validator uses those
signals to catch generation errors. Editing one file breaks the agreement between them and
the validator will, correctly, refuse the subject.

If something is wrong, regenerate that level and re-drop it. If it's wrong repeatedly, the
generator prompt needs fixing, not the output.

### Validation failed?

Look up the code in `CONTENT-CONTRACT.md` §11. The common ones:

| Code | Usually means |
|---|---|
| `E007` / `E008` | the run drifted — a later level renamed or reordered a topic. Regenerate that level. |
| `E003` / `E004` | a part file wasn't saved, or `parts` in the manifest doesn't match what was actually written |
| `E005` | the outline comment landed in the wrong file, or got emitted twice across a continuation |
| `E017` | frontmatter got added to a level file. Remove it; metadata lives in `manifest.yml`. |
| `W005` | the run stopped early — topics exist at level 0 but not deeper |

`⚠️ verify` markers are not failures. They are the generator flagging a fact it wasn't sure
about. They collect on `/verify` for you to check against real docs. Trust the marked ones
less and the unmarked ones more — that is the point of them.

---

## B. Add a loose note — one file, hand-written

`npm run new:note "Some Idea" --category misc` → `content/misc/some-idea.md`

```yaml
---
title: Some Idea
summary: One sentence, shown on cards and hover previews.
tags: [thinking, tools]
difficulty: intermediate
prereqs: []
---
```

No levels, no outline, no depth control. For things that don't need four zoom levels.

### Syntax available in loose notes

Everything below works. Generated subjects use only the subset noted in
`CONTENT-CONTRACT.md` §7.

**Flashcard** — one line, hidden in reading view:

```
Consistent hashing solves what problem :: Remapping keys when the node count changes
```

**Cloze** — blanked in recall mode, click to reveal:

```
A virtual node count of {{100–200 per physical node}} keeps the load variance acceptable.
```

**Quiz** — answerable in place, with the explanation shown after:

````
```quiz
question: What happens to keys when one node joins a consistent hash ring?
options:
  - Every key remaps
  - Only keys between the new node and its predecessor remap
  - Keys remap only if the hash function changes
answer: 1
why: The new node takes ownership of the arc ending at its position, so only that arc moves.
```
````

**Callouts** — both forms render identically:

```
> [!note] Plain note.
> [!warning] Something that will bite.
> [!insight] The thing worth remembering.

> 💡 **Tip:** …
> ⚠️ **Warning:** …
> 🎯 **Interview Note:** …
> ✅ **Best Practice:** …
```

**Wikilinks** — hover shows a preview card:

```
[[consistent-hashing]]              → the subject
[[consistent-hashing#t7]]           → one topic inside it
```

**Also:** mermaid blocks, KaTeX (`$x^2$` and `$$…$$`), footnotes, task lists, tables,
`<details><summary>`, heading permalinks, fenced code with a copy button.

---

## What the site extracts on its own

You never write flashcard syntax in a generated subject. Cards are built from structure:

- Level 0 bodies → basic cards
- Level 2 `Common Interview Questions` and `Follow-up Questions` → Q/A cards
- Level 2 `Important Facts to Remember` → cloze cards
- Level 2 `Comparisons` tables → cloze over cells
- Level 1 and Level 3 `<details>` exercises → predict-output and debugging cards

Which is why `include_exercises: true` is the default in the generator prompt. Turning it
off costs you two card types.

---

## Progress lives in the browser

Read state, mastery, highlights, notes, and card scheduling are all in `localStorage`,
keyed by `subject/topic-id/level`. Nothing is written back into a content file, so
regenerating a subject keeps everything that still matches. Export and import from the
settings panel; do it before clearing browser data.
