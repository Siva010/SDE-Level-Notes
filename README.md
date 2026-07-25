# SDE Level Notes

A static study site that renders AI-generated technical notes at **four depths over one topic
outline**: same topics, same order, increasing depth.

| Level | Reader finishes thinking |
|---|---|
| `0_foundation.md` | "I know what every concept is." |
| `1_understand.md` | "I understand how this works." |
| `2_interview.md` | "I can answer questions on this and defend the answer." |
| `3_production.md` | "I know how professionals actually use this." |

Content is authored elsewhere — in chat, with `prompts/four-level-generator.md` — and dropped
into `content/` unmodified. This repo renders it and refuses to render it when it is wrong.

## The invariant

**Adding a subject is dropping one unmodified generator-output folder into `content/`.** No
registry, no route file, no config entry, no import, no hand-added frontmatter. If a feature
would break that, it gets redesigned.

## Commands

```bash
npm run dev          # dev server
npm run build        # static build; runs validate first and fails the build on errors
npm run validate     # the CONTENT-CONTRACT gate over content/, pass/fail per check
npm run validate -- content/data/database-indexing    # scope the report to one folder
npm run new:subject "Consistent Hashing" --category distributed-systems
npm run new:note "Some Idea" --category misc
npm test             # parser and validator against committed fixtures
npm run typecheck    # tsc --noEmit
npm run fixtures     # regenerate tests/fixtures from their declared defects
```

## Layout

```
content/                  the corpus — read-only to the build, one folder per subject
prompts/                  the generator prompt that produces content/
src/lib/contract/         parsing and validation, one module per part of the contract
src/lib/render.ts         markdown → HTML, once, at build time
src/lib/loader.ts         the Astro content-layer loader; the unit is a folder
scripts/                  validate, scaffolding, fixture generation
tests/                    parser units, the gate against fixtures, the real corpus
```

## Documents

| File | What it governs |
|---|---|
| `CONTENT-CONTRACT.md` | input format, parsing, validation — normative |
| `PHASES.md` | what to build now, and what not to build yet |
| `BRIEF.md` | product intent, reading experience, study layer |
| `DESIGN.md` | tokens, type, motion |
| `AUTHORING.md` | how to add content |
| `CLAUDE.md` | working agreement for changes to this repo |

Precedence when they disagree: `CONTENT-CONTRACT.md` → `PHASES.md` → `BRIEF.md` → `DESIGN.md`.

## Status

Phase 1 — pipeline and gate. The parser, the validation gate and the content loader are done;
`/` is a deliberately unstyled list proving the pipeline. Typography, the depth control, search
and the study layer are Phases 2–5, tracked in `PHASES.md`.
