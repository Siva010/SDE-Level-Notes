#!/usr/bin/env tsx
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flag, parseArgs, slugify } from './args.js';

/** `npm run new:note "Some Idea" --category misc` — the loose single-file path (§1 shape B). */

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const title = args.positional[0];
  const category = flag(args, 'category', 1);

  if (!title || !category) {
    console.error('usage: npm run new:note "Note Title" --category <kebab-case-category>');
    return 1;
  }

  const slug = slugify(title);
  const categorySlug = slugify(category);
  const dir = join(repoRoot, 'content', categorySlug);
  const path = join(dir, `${slug}.md`);

  if (existsSync(path)) {
    console.error(`${path} already exists — refusing to overwrite it.`);
    return 1;
  }

  await mkdir(dir, { recursive: true });
  await writeFile(
    path,
    `---
title: ${title}
summary: One sentence, shown on cards and hover previews.
tags: [${categorySlug}]
difficulty: intermediate
prereqs: []
---

# ${title}

Write the note. Loose-note syntax — flashcards, cloze, quiz blocks, callouts, wikilinks —
is listed in AUTHORING.md §B.
`,
    'utf8',
  );

  console.log(`\nCreated content/${categorySlug}/${slug}.md`);
  console.log(`Then: npm run validate content/${categorySlug}/${slug}.md\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (cause: unknown) => {
    console.error(cause);
    process.exit(1);
  },
);
