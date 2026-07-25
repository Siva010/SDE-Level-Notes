#!/usr/bin/env tsx
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regenerates `tests/fixtures/`. The output is committed and the tests read it from disk —
 * this script exists so the *difference* between a valid subject and each broken one is
 * declared in one readable table (CONTENT-CONTRACT.md §12) instead of being buried across
 * twenty near-identical folders.
 *
 *   npm run fixtures
 *
 * Layout: `tests/fixtures/<valid|broken/NAME>/fixtures/<slug>/`. The `fixtures/` level is the
 * category directory, so each fixture root can be loaded as if it were `content/`.
 */

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturesDir = join(repoRoot, 'tests', 'fixtures');

type Files = Record<string, string>;

const LABELS = ['Foundation', 'Understand', 'Interview', 'Production'];
const BASES = ['0_foundation', '1_understand', '2_interview', '3_production'];

const L2_SUBSECTIONS = [
  'Definition',
  'Why It Exists',
  'Interview Explanation',
  'Example',
  'Common Interview Questions',
  'Follow-up Questions',
  'Common Mistakes',
  'Important Facts to Remember',
];

interface Topic {
  id: string;
  name: string;
  anchor: string;
}

const TOPICS: Topic[] = [
  { id: 'T1', name: 'Alpha Concept', anchor: 't1-alpha-concept' },
  { id: 'T2', name: 'Beta Concept', anchor: 't2-beta-concept' },
  { id: 'T2.1', name: 'Beta Detail', anchor: 't2-1-beta-detail' },
];

const SPLIT_TOPICS: Topic[] = [
  { id: 'T1', name: 'Alpha Concept', anchor: 't1-alpha-concept' },
  { id: 'T2', name: 'Beta Concept', anchor: 't2-beta-concept' },
  { id: 'T3', name: 'Gamma Concept', anchor: 't3-gamma-concept' },
  { id: 'T4', name: 'Delta Concept', anchor: 't4-delta-concept' },
];

function outlineComment(topics: readonly Topic[]): string {
  return ['<!-- OUTLINE v1', ...topics.map((t) => `${t.id}. ${t.name}`), '-->'].join('\n');
}

function toc(topics: readonly Topic[]): string {
  return ['## Table of Contents', '', ...topics.map((t) => `- [${t.id}. ${t.name}](#${t.anchor})`)].join('\n');
}

function navStrip(level: number, topic: Topic, suffix: string | null): string {
  const entries = LABELS.map((label, index) => {
    if (index === level) return label;
    return `[${label}](${BASES[index]}${suffix ? `_${suffix}` : ''}.md#${topic.anchor})`;
  });
  return `<sub>Levels: ${entries.join(' · ')}</sub>`;
}

function topicSection(level: number, topic: Topic, suffix: string | null): string {
  const lines = [`## ${topic.id}. ${topic.name}`, '', navStrip(level, topic, suffix), ''];
  if (level === 2) {
    for (const subsection of L2_SUBSECTIONS) {
      lines.push(`### ${subsection}`, '', `${subsection} of ${topic.name} at the interview level.`, '');
    }
  } else {
    lines.push(`${LABELS[level]}-level body for ${topic.name}. It says something true.`, '');
  }
  return lines.join('\n');
}

interface LevelFileOptions {
  outline?: string;
  suffix?: string | null;
  title?: string;
  partLink?: string;
}

function levelFile(level: number, topics: readonly Topic[], options: LevelFileOptions = {}): string {
  const suffix = options.suffix ?? null;
  const chunks: string[] = [];
  if (options.outline) chunks.push(options.outline, '');
  chunks.push(`# ${options.title ?? `Fixture Subject — ${LABELS[level]}`}`, '');
  if (options.partLink) chunks.push(options.partLink, '');
  chunks.push(toc(topics), '');
  for (const topic of topics) chunks.push(topicSection(level, topic, suffix));
  if (options.partLink) chunks.push(options.partLink, '');
  return `${chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function manifest(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    subject: 'Fixture Subject',
    slug: 'valid-subject',
    category: 'fixtures',
    summary: 'A minimal valid subject, so the gate can be proven to fire only when it should.',
    tags: '[fixtures, testing]',
    difficulty: 'intermediate',
    language_or_format: 'prose',
    version_target: 'v1',
    audience: 'the test suite',
    goal: 'validation coverage',
    topic_count: '3',
    outline_version: 'v1',
    prereqs: '[]',
    generated: '2026-07-25',
    ...overrides,
  };
  return `${Object.entries(base)
    .map(([key, value]) => `${key}:${' '.repeat(Math.max(1, 20 - key.length))}${value}`)
    .join('\n')}\n`;
}

function validSubject(): Files {
  return {
    'manifest.yml': manifest(),
    '0_foundation.md': levelFile(0, TOPICS, { outline: outlineComment(TOPICS) }),
    '1_understand.md': levelFile(1, TOPICS),
    '2_interview.md': levelFile(2, TOPICS),
    '3_production.md': levelFile(3, TOPICS),
  };
}

function validSplit(): Files {
  const files: Files = {
    'manifest.yml': manifest({
      slug: 'valid-split',
      topic_count: '4',
      parts: '\n  - { range: T1-T2, suffix: part1 }\n  - { range: T3-T4, suffix: part2 }',
    }),
  };

  for (const [level, base] of BASES.entries()) {
    for (const [index, suffix] of ['part1', 'part2'].entries()) {
      const topics = index === 0 ? SPLIT_TOPICS.slice(0, 2) : SPLIT_TOPICS.slice(2);
      const other = index === 0 ? 'part2' : 'part1';
      files[`${base}_${suffix}.md`] = levelFile(level, topics, {
        ...(level === 0 && index === 0 ? { outline: outlineComment(SPLIT_TOPICS) } : {}),
        suffix,
        title: `Fixture Split — ${LABELS[level]} (${suffix})`,
        partLink: `[${index === 0 ? 'Part 2 T3-T4 →' : '← Part 1 T1-T2'}](${base}_${other}.md)`,
      });
    }
  }

  return files;
}

type Mutation = (files: Files) => Files;

const edit =
  (file: string, find: RegExp | string, replace: string): Mutation =>
  (files) => {
    const source = files[file];
    if (source === undefined) throw new Error(`fixture has no ${file}`);
    const next = source.replace(find, replace);
    if (next === source) throw new Error(`mutation did not apply to ${file}: ${String(find)}`);
    return { ...files, [file]: next };
  };

const append =
  (file: string, text: string): Mutation =>
  (files) => ({ ...files, [file]: `${files[file] ?? ''}${text}` });

const prepend =
  (file: string, text: string): Mutation =>
  (files) => ({ ...files, [file]: `${text}${files[file] ?? ''}` });

const drop =
  (file: string): Mutation =>
  (files) => {
    const { [file]: _gone, ...rest } = files;
    return rest;
  };

const compose =
  (...mutations: Mutation[]): Mutation =>
  (files) =>
    mutations.reduce((acc, mutate) => mutate(acc), files);

interface BrokenFixture {
  name: string;
  code: string;
  base: 'valid-subject' | 'valid-split';
  what: string;
  mutate: Mutation;
}

const BROKEN: BrokenFixture[] = [
  {
    name: 'E001-missing-manifest-key',
    code: 'E001',
    base: 'valid-subject',
    what: '`summary` is missing from manifest.yml',
    mutate: edit('manifest.yml', /^summary:.*\n/m, ''),
  },
  {
    name: 'E002-slug-mismatch',
    code: 'E002',
    base: 'valid-subject',
    what: 'manifest.slug disagrees with the folder name',
    mutate: edit('manifest.yml', /^slug:\s+valid-subject$/m, 'slug:               some-other-slug'),
  },
  {
    name: 'E003-missing-part-file',
    code: 'E003',
    base: 'valid-split',
    what: '1_understand_part2.md was never saved',
    mutate: drop('1_understand_part2.md'),
  },
  {
    name: 'E004-parts-gap',
    code: 'E004',
    base: 'valid-split',
    what: 'the parts ranges leave T3 uncovered',
    mutate: edit('manifest.yml', 'range: T3-T4', 'range: T4-T4'),
  },
  {
    name: 'E005-missing-outline',
    code: 'E005',
    base: 'valid-subject',
    what: 'the outline comment is gone',
    mutate: edit('0_foundation.md', /<!-- OUTLINE[\s\S]*?-->\n\n/, ''),
  },
  {
    name: 'E006-unsafe-topic-name',
    code: 'E006',
    base: 'valid-subject',
    what: 'an outline topic name contains parentheses',
    mutate: edit('0_foundation.md', 'T1. Alpha Concept\nT2.', 'T1. Alpha (Concept)\nT2.'),
  },
  {
    name: 'E007-out-of-outline-order',
    code: 'E007',
    base: 'valid-subject',
    what: 'Level 1 emits T2 before T1',
    mutate: (files) => {
      const source = files['1_understand.md'] ?? '';
      const first = source.indexOf('## T1. ');
      const second = source.indexOf('## T2. Beta Concept');
      return {
        ...files,
        '1_understand.md': source.slice(0, first) + source.slice(second) + source.slice(first, second),
      };
    },
  },
  {
    name: 'E008-heading-drift',
    code: 'E008',
    base: 'valid-subject',
    what: 'Level 2 renamed a heading the other levels still use',
    mutate: compose(
      edit('2_interview.md', '## T2. Beta Concept', '## T2. Beta Concepts'),
      edit('2_interview.md', '- [T2. Beta Concept](', '- [T2. Beta Concepts]('),
    ),
  },
  {
    name: 'E009-topic-absent-from-level-0',
    code: 'E009',
    base: 'valid-subject',
    what: 'Level 3 carries a topic Level 0 never named',
    mutate: append(
      '3_production.md',
      [
        '',
        '## T9. Ghost Concept',
        '',
        '<sub>Levels: [Foundation](0_foundation.md#t9-ghost-concept) · [Understand](1_understand.md#t9-ghost-concept) · [Interview](2_interview.md#t9-ghost-concept) · Production</sub>',
        '',
        'A topic that exists only at this level.',
        '',
      ].join('\n'),
    ),
  },
  {
    name: 'E010-duplicate-topic-id',
    code: 'E010',
    base: 'valid-subject',
    what: 'the outline declares T2 twice',
    mutate: edit('0_foundation.md', 'T2.1. Beta Detail', 'T2. Beta Detail'),
  },
  {
    name: 'E011-stray-h2',
    code: 'E011',
    base: 'valid-subject',
    what: 'Level 1 has an H2 that is neither a topic nor the ToC',
    mutate: edit(
      '1_understand.md',
      '## T2. Beta Concept',
      '## Some Other Section\n\nStray prose.\n\n## T2. Beta Concept',
    ),
  },
  {
    name: 'E012-toc-mismatch',
    code: 'E012',
    base: 'valid-subject',
    what: 'the in-file ToC names a topic differently from the outline',
    mutate: edit('0_foundation.md', '- [T2. Beta Concept](#t2-beta-concept)', '- [T2. Beta Concepts](#t2-beta-concept)'),
  },
  {
    name: 'E013-nav-anchor-drift',
    code: 'E013',
    base: 'valid-subject',
    what: 'a nav strip anchor does not match its own heading',
    mutate: edit('1_understand.md', '[Interview](2_interview.md#t1-alpha-concept)', '[Interview](2_interview.md#t1-alpha)'),
  },
  {
    name: 'E014-unknown-t-reference',
    code: 'E014',
    base: 'valid-subject',
    what: 'prose references T7, which is not in the outline',
    mutate: edit('1_understand.md', 'Understand-level body for Alpha Concept. It says something true.', 'Understand-level body for Alpha Concept, building on T7.'),
  },
  {
    name: 'E015-broken-wikilink',
    code: 'E015',
    base: 'valid-subject',
    what: 'a wikilink points at a subject that does not exist',
    mutate: edit('1_understand.md', 'Understand-level body for Alpha Concept. It says something true.', 'Understand-level body for Alpha Concept, see [[no-such-subject]].'),
  },
  {
    name: 'E015-broken-prereq',
    code: 'E015',
    base: 'valid-subject',
    what: 'a prereqs entry points at a subject that does not exist',
    mutate: edit('manifest.yml', /^prereqs:\s+\[\]$/m, 'prereqs:            [no-such-subject]'),
  },
  {
    name: 'E016-topic-count-mismatch',
    code: 'E016',
    base: 'valid-subject',
    what: 'topic_count disagrees with the parsed outline',
    mutate: edit('manifest.yml', /^topic_count:\s+3$/m, 'topic_count:        99'),
  },
  {
    name: 'E017-frontmatter-in-level-file',
    code: 'E017',
    base: 'valid-subject',
    what: 'frontmatter was added to a level file',
    mutate: prepend('1_understand.md', '---\ntitle: Understand\n---\n\n'),
  },
  {
    name: 'E018-over-nested-topic',
    code: 'E018',
    base: 'valid-subject',
    what: 'the outline nests two levels deep',
    mutate: edit('0_foundation.md', 'T2.1. Beta Detail', 'T2.1.1. Beta Detail'),
  },
  {
    name: 'W-warnings-only',
    code: 'W001',
    base: 'valid-subject',
    what: 'warnings only: unknown manifest key, missing L2 subsection, unknown L2 H3, untagged fence, unparseable mermaid, topic missing from L1',
    mutate: compose(
      edit('manifest.yml', /^generated:(\s+)(\S+)$/m, 'generated:$1$2\nmood:               experimental'),
      edit('2_interview.md', /### Common Mistakes\n\nCommon Mistakes of Beta Concept at the interview level\.\n\n/, ''),
      edit(
        '2_interview.md',
        'Definition of Beta Detail at the interview level.',
        'Definition of Beta Detail at the interview level.\n\n### Vibes\n\nAn H3 outside the closed vocabulary.',
      ),
      edit(
        '3_production.md',
        'Production-level body for Alpha Concept. It says something true.',
        'Production-level body for Alpha Concept.\n\n```\nfenced block with no language tag\n```\n\n```mermaid\nthis is not a diagram type\n```',
      ),
      (files) => {
        const source = files['1_understand.md'] ?? '';
        return { ...files, '1_understand.md': `${source.slice(0, source.indexOf('## T2.1. Beta Detail')).trimEnd()}\n` };
      },
    ),
  },
];

async function writeFixture(dir: string, files: Files): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents, 'utf8');
  }
}

async function main(): Promise<void> {
  await rm(fixturesDir, { recursive: true, force: true });

  const bases: Record<string, Files> = {
    'valid-subject': validSubject(),
    'valid-split': validSplit(),
  };

  for (const [slug, files] of Object.entries(bases)) {
    await writeFixture(join(fixturesDir, 'valid', 'fixtures', slug), files);
  }

  const rows: string[] = [];
  for (const fixture of BROKEN) {
    const base = bases[fixture.base];
    if (!base) throw new Error(`unknown base ${fixture.base}`);
    const files = fixture.mutate({ ...base });
    await writeFixture(join(fixturesDir, 'broken', fixture.name, 'fixtures', fixture.base), files);
    rows.push(`| \`${fixture.name}\` | ${fixture.code} | ${fixture.base} | ${fixture.what} |`);
  }

  const readme = [
    '# Fixtures',
    '',
    'Generated by `npm run fixtures`, committed on purpose: the tests read these folders from',
    'disk, so a fixture proves the message a human would actually see — not just that a code',
    'fired (CONTENT-CONTRACT.md §12).',
    '',
    'Each broken fixture is one of the two valid subjects with exactly one defect applied.',
    '',
    '| Fixture | Code | Base | Defect |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');

  await writeFile(join(fixturesDir, 'README.md'), readme, 'utf8');
  console.log(`wrote ${Object.keys(bases).length} valid and ${BROKEN.length} broken fixtures`);
}

main().catch((cause: unknown) => {
  console.error(cause);
  process.exit(1);
});
