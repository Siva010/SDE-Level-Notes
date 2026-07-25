#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, slugify, today } from './args.js';

/**
 * `npm run new:subject "Consistent Hashing" --category distributed-systems`
 *
 * Writes the folder and everything about `manifest.yml` that can be inferred, then prints
 * the generator prompt with `subject:` filled in. The site emits the prompt that produces
 * its own next input — that loop is the point (BRIEF.md §10).
 */

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function main(): Promise<number> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const title = positional[0];
  const category = flags['category'];

  if (!title || !category) {
    console.error('usage: npm run new:subject "Subject Name" --category <kebab-case-category>');
    return 1;
  }

  const slug = slugify(title);
  const categorySlug = slugify(category);
  const dir = join(repoRoot, 'content', categorySlug, slug);
  const manifestPath = join(dir, 'manifest.yml');

  if (existsSync(manifestPath)) {
    console.error(`${manifestPath} already exists — refusing to overwrite it.`);
    return 1;
  }

  await mkdir(dir, { recursive: true });
  await writeFile(
    manifestPath,
    `subject:            ${title}
slug:               ${slug}
category:           ${categorySlug}
summary:            TODO one sentence, shown on cards and hover previews
tags:               [${categorySlug}]
difficulty:         intermediate
language_or_format: TODO
version_target:     TODO
audience:           strong mid-level engineer
goal:               interview prep and on-the-job fluency
topic_count:        0
outline_version:    v1
prereqs:            []
generated:          ${today()}
`,
    'utf8',
  );

  const prompt = await readFile(join(repoRoot, 'prompts', 'four-level-generator.md'), 'utf8');
  const filled = prompt.replace('<INSERT SUBJECT HERE>', title);

  console.log(`\nCreated ${join('content', categorySlug, slug, 'manifest.yml')}`);
  console.log(
    'The generator fills in summary, tags, difficulty, language_or_format, version_target,\n' +
      'topic_count and parts — overwrite the manifest with the one it emits.\n' +
      'Until the level files land, `npm run build` fails on this folder. That is the gate working.\n',
  );
  console.log(`${'─'.repeat(72)}\n`);
  console.log(filled);
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`Paste the block above into a fresh chat. Then: npm run validate content/${categorySlug}/${slug}\n`);

  return 0;
}

main().then(
  (code) => process.exit(code),
  (cause: unknown) => {
    console.error(cause);
    process.exit(1);
  },
);
