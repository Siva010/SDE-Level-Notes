# CLAUDE.md

A static study site that renders AI-generated technical notes at four depths. Content is
authored elsewhere (in chat, using `prompts/four-level-generator.md`) and dropped into
`content/` as folders of markdown. This repo renders it. It does not author it.

## Read before working

| File | What it governs | When to read |
|---|---|---|
| `PHASES.md` | what to build now, and what not to build yet | every session, first |
| `CONTENT-CONTRACT.md` | input format, parsing, validation — normative | any parser, schema, or validation work |
| `BRIEF.md` | product intent, reading experience, study layer | any UI or feature work |
| `DESIGN.md` | tokens, type, motion, the approved visual plan | any styling work |
| `AUTHORING.md` | how a human adds content | when changing scaffolding scripts |

**Precedence when they disagree:** `CONTENT-CONTRACT.md` → `PHASES.md` → `BRIEF.md` →
`DESIGN.md`. The contract wins because both halves of the project are built against it.

## The one invariant

**Adding a subject is dropping one unmodified generator-output folder into `content/`.**

Nothing may require a second edit anywhere — no registry, no route file, no config entry,
no import, no frontmatter added by hand. If a feature you are about to build would break
this, stop and redesign it. This is the reason the project exists; it is not negotiable
for convenience.

Corollary: **`content/` is read-only to you.** Do not edit, reformat, or "fix" a generated
file to make the parser's job easier — fix the parser. The two exceptions are the seed
subject you create in Phase 1 and files written by `npm run new:*`.

## Commands

```bash
npm run dev          # dev server
npm run build        # static build; runs validate first and fails the build on errors
npm run validate     # run the CONTENT-CONTRACT gate over content/, print pass/fail per check
npm run validate -- content/distributed-systems/consistent-hashing   # one folder
npm run new:subject "Consistent Hashing" --category distributed-systems
npm run new:note "Some Idea" --category misc
npm test             # parser + validator unit tests against fixtures
```

## Conventions

- TypeScript, `strict: true`. No `any` in the parser.
- Astro content collections with a **custom folder loader** — the unit is a directory with
  `manifest.yml`, not a file with frontmatter.
- **Parse once, at build time**, into the typed structures in `CONTENT-CONTRACT.md` §10.
  Never parse or regex markdown inside a component.
- Islands only for genuinely interactive study components. Reading pages ship no JS beyond
  the depth control, scroll-spy, and theme.
- No CSS framework. Hand-written CSS with the tokens in `DESIGN.md`.
- All reader state (`localStorage`) is keyed `subject/topic-id/level`. Never by file path,
  file offset, heading text, or array index — content gets regenerated and those all move.

## Always an error

- Editing anything under `content/` outside the two exceptions above.
- Introducing a file that must be updated when a subject is added.
- Rendering a subject that failed validation, or silently skipping a broken one.
- Storing reader progress in a content file.
- A validation failure that doesn't name the file, the topic ID, and expected vs actual.

## Session protocol

1. Read `PHASES.md`, find the current phase, work only that phase.
2. Before claiming done: `npm run validate && npm run build && npm test` all pass, and the
   phase's acceptance tests in `PHASES.md` are demonstrated, not asserted.
3. Deliberately break something the phase claims to catch, confirm the error is clear,
   revert.
4. Update the phase checklist in `PHASES.md` and stop. Do not start the next phase.
