import { parse as parseYaml } from 'yaml';
import { error, warning } from './diagnostics.js';
import { topLevelNumber } from './anchors.js';
import type { Diagnostic, Difficulty, Manifest, PartSpec, TopicNode } from './types.js';

/** `manifest.yml` — CONTENT-CONTRACT.md §2. */

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_RE = /^T(\d+)\s*-\s*T(\d+)$/;
const DIFFICULTIES: readonly Difficulty[] = ['intro', 'intermediate', 'advanced'];

const REQUIRED_KEYS = [
  'subject',
  'slug',
  'category',
  'summary',
  'tags',
  'difficulty',
  'language_or_format',
  'version_target',
  'audience',
  'goal',
  'topic_count',
  'outline_version',
  'prereqs',
  'generated',
] as const;

const KNOWN_KEYS = new Set<string>([...REQUIRED_KEYS, 'parts']);

export interface ManifestParse {
  manifest: Manifest | null;
  diagnostics: Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return `a ${typeof value}`;
}

/**
 * Structural parse and schema check. Cross-checks that need the outline (`topic_count`,
 * `outline_version`, part coverage) live in `checkManifestAgainstOutline`.
 */
export function parseManifest(
  source: string,
  file: string,
  folder: { slug: string; category: string },
): ManifestParse {
  const diagnostics: Diagnostic[] = [];

  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (cause) {
    return {
      manifest: null,
      diagnostics: [
        error('E001', file, 'manifest.yml is not parseable YAML.', {
          expected: 'a YAML mapping of the keys in CONTENT-CONTRACT.md §2',
          actual: cause instanceof Error ? cause.message.split('\n')[0] ?? 'parse error' : 'parse error',
        }),
      ],
    };
  }

  if (!isRecord(raw)) {
    return {
      manifest: null,
      diagnostics: [
        error('E001', file, 'manifest.yml is not a YAML mapping.', {
          expected: 'a mapping of keys to values',
          actual: typeName(raw),
        }),
      ],
    };
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in raw)) {
      diagnostics.push(
        error('E001', file, `Required manifest key \`${key}\` is missing.`, {
          expected: `\`${key}\` present`,
          actual: `keys present: ${Object.keys(raw).join(', ') || '(none)'}`,
        }),
      );
    }
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      diagnostics.push(
        warning('W007', file, `Unknown top-level key \`${key}\` in manifest.yml.`, {
          expected: `one of: ${[...KNOWN_KEYS].join(', ')}`,
          actual: key,
        }),
      );
    }
  }

  const str = (key: string): string => {
    const value = raw[key];
    if (typeof value === 'string') return value;
    if (value !== undefined) {
      diagnostics.push(
        error('E001', file, `Manifest key \`${key}\` must be a string.`, {
          expected: 'a string',
          actual: typeName(value),
        }),
      );
    }
    return '';
  };

  const subject = str('subject');
  if ('subject' in raw && subject.trim() === '') {
    diagnostics.push(
      error('E001', file, 'Manifest key `subject` must be non-empty.', {
        expected: 'a non-empty string',
        actual: JSON.stringify(subject),
      }),
    );
  }

  const slug = str('slug');
  const category = str('category');

  for (const [key, value] of [
    ['slug', slug],
    ['category', category],
  ] as const) {
    if (value !== '' && !KEBAB_RE.test(value)) {
      diagnostics.push(
        error('E001', file, `Manifest key \`${key}\` must be kebab-case.`, {
          expected: 'lowercase words joined by single hyphens',
          actual: JSON.stringify(value),
        }),
      );
    }
  }

  if (slug !== '' && slug !== folder.slug) {
    diagnostics.push(
      error('E002', file, 'manifest.slug disagrees with the folder name.', {
        expected: folder.slug,
        actual: slug,
      }),
    );
  }
  if (category !== '' && category !== folder.category) {
    diagnostics.push(
      error('E002', file, 'manifest.category disagrees with the parent folder name.', {
        expected: folder.category,
        actual: category,
      }),
    );
  }

  const summary = str('summary');
  if (summary.length > 200) {
    diagnostics.push(
      error('E001', file, 'Manifest key `summary` is too long.', {
        expected: '≤ 200 characters',
        actual: `${summary.length} characters`,
      }),
    );
  }

  const tags = parseStringList(raw['tags'], 'tags', file, diagnostics);
  if ('tags' in raw && (tags.length < 1 || tags.length > 8)) {
    diagnostics.push(
      error('E001', file, 'Manifest key `tags` must have 1–8 entries.', {
        expected: '1–8 kebab-case tags',
        actual: `${tags.length} entries`,
      }),
    );
  }
  for (const tag of tags) {
    if (!KEBAB_RE.test(tag)) {
      diagnostics.push(
        error('E001', file, 'Manifest tags must be kebab-case.', {
          expected: 'lowercase words joined by single hyphens',
          actual: JSON.stringify(tag),
        }),
      );
    }
  }

  const difficultyRaw = raw['difficulty'];
  let difficulty: Difficulty = 'intermediate';
  if (typeof difficultyRaw === 'string' && (DIFFICULTIES as readonly string[]).includes(difficultyRaw)) {
    difficulty = difficultyRaw as Difficulty;
  } else if ('difficulty' in raw) {
    diagnostics.push(
      error('E001', file, 'Manifest key `difficulty` is not one of the allowed values.', {
        expected: DIFFICULTIES.join(' | '),
        actual: JSON.stringify(difficultyRaw),
      }),
    );
  }

  const topicCountRaw = raw['topic_count'];
  let topicCount = 0;
  if (typeof topicCountRaw === 'number' && Number.isInteger(topicCountRaw)) {
    topicCount = topicCountRaw;
  } else if ('topic_count' in raw) {
    diagnostics.push(
      error('E001', file, 'Manifest key `topic_count` must be an integer.', {
        expected: 'an integer',
        actual: JSON.stringify(topicCountRaw),
      }),
    );
  }

  const generatedRaw = raw['generated'];
  const generated =
    generatedRaw instanceof Date
      ? (generatedRaw.toISOString().slice(0, 10) as string)
      : typeof generatedRaw === 'string'
        ? generatedRaw
        : '';
  if ('generated' in raw && !ISO_DATE_RE.test(generated)) {
    diagnostics.push(
      error('E001', file, 'Manifest key `generated` must be an ISO date.', {
        expected: 'YYYY-MM-DD',
        actual: JSON.stringify(generatedRaw),
      }),
    );
  }

  const prereqs = parseStringList(raw['prereqs'], 'prereqs', file, diagnostics);
  const parts = 'parts' in raw ? parseParts(raw['parts'], file, diagnostics) : undefined;

  const manifest: Manifest = {
    subject,
    slug,
    category,
    summary,
    tags,
    difficulty,
    language_or_format: str('language_or_format'),
    version_target: str('version_target'),
    audience: str('audience'),
    goal: str('goal'),
    topic_count: topicCount,
    outline_version: str('outline_version'),
    prereqs,
    generated,
    ...(parts ? { parts } : {}),
  };

  return { manifest, diagnostics };
}

function parseStringList(
  value: unknown,
  key: string,
  file: string,
  diagnostics: Diagnostic[],
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(
      error('E001', file, `Manifest key \`${key}\` must be a list.`, {
        expected: 'a list of strings',
        actual: typeName(value),
      }),
    );
    return [];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      diagnostics.push(
        error('E001', file, `Manifest key \`${key}\` must contain only strings.`, {
          expected: 'a string',
          actual: typeName(entry),
        }),
      );
      continue;
    }
    out.push(entry);
  }
  return out;
}

function parseParts(value: unknown, file: string, diagnostics: Diagnostic[]): PartSpec[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(
      error('E001', file, 'Manifest key `parts` must be a list.', {
        expected: 'a list of `{ range, suffix }` entries, or the key omitted entirely',
        actual: typeName(value),
      }),
    );
    return undefined;
  }
  if (value.length === 0) {
    diagnostics.push(
      error('E001', file, 'Manifest key `parts` is empty.', {
        expected: 'omit `parts` entirely when the subject is unsplit',
        actual: 'an empty list',
      }),
    );
    return undefined;
  }

  const parts: PartSpec[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || typeof entry['range'] !== 'string' || typeof entry['suffix'] !== 'string') {
      diagnostics.push(
        error('E001', file, `Manifest \`parts[${index}]\` is malformed.`, {
          expected: '{ range: "T1-T9", suffix: "part1" }',
          actual: JSON.stringify(entry),
        }),
      );
      continue;
    }
    const range = entry['range'];
    const suffix = entry['suffix'];
    const match = RANGE_RE.exec(range.trim());
    if (!match?.[1] || !match[2]) {
      diagnostics.push(
        error('E004', file, `Manifest \`parts[${index}].range\` is not a topic range.`, {
          expected: '`T<n>-T<m>` using top-level topic IDs',
          actual: JSON.stringify(range),
        }),
      );
      continue;
    }
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (from > to) {
      diagnostics.push(
        error('E004', file, `Manifest \`parts[${index}].range\` is descending.`, {
          expected: 'an ascending, inclusive range',
          actual: range,
        }),
      );
      continue;
    }
    parts.push({ range: range.trim(), from, to, suffix });
  }

  return parts.length > 0 ? parts : undefined;
}

/** The checks that need the parsed outline — §2 `topic_count`, `outline_version`, `parts` coverage. */
export function checkManifestAgainstOutline(
  manifest: Manifest,
  outline: { version: string; flat: TopicNode[]; nodes: TopicNode[] },
  file: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (manifest.topic_count !== outline.flat.length) {
    diagnostics.push(
      error('E016', file, 'manifest.topic_count disagrees with the parsed outline.', {
        expected: `${outline.flat.length} (topics in the outline comment, nested included)`,
        actual: String(manifest.topic_count),
      }),
    );
  }

  if (manifest.outline_version !== outline.version) {
    diagnostics.push(
      error('E016', file, 'manifest.outline_version disagrees with the outline comment.', {
        expected: outline.version,
        actual: manifest.outline_version || '(empty)',
      }),
    );
  }

  const parts = manifest.parts;
  if (!parts) return diagnostics;

  const topLevel = outline.nodes.map((n) => topLevelNumber(n.id));
  const first = topLevel[0] ?? 0;
  const last = topLevel[topLevel.length - 1] ?? 0;

  let cursor = first;
  for (const [index, part] of parts.entries()) {
    if (part.from !== cursor) {
      diagnostics.push(
        error(
          'E004',
          file,
          index === 0
            ? 'The first `parts` range does not start at the first outline topic.'
            : `\`parts[${index}]\` ${part.from > cursor ? 'leaves a gap after' : 'overlaps'} the previous range.`,
          {
            expected: `a range starting at T${cursor}`,
            actual: `${part.range} starts at T${part.from}`,
          },
        ),
      );
    }
    cursor = part.to + 1;
  }

  if (cursor - 1 !== last) {
    diagnostics.push(
      error('E004', file, '`parts` ranges do not cover the outline exactly.', {
        expected: `the last range to end at T${last}`,
        actual: `the last range ends at T${cursor - 1}`,
      }),
    );
  }

  const covered = new Set<number>();
  for (const part of parts) {
    for (let n = part.from; n <= part.to; n += 1) covered.add(n);
  }
  for (const node of outline.nodes) {
    const n = topLevelNumber(node.id);
    if (!covered.has(n)) {
      diagnostics.push(
        error('E004', file, 'An outline topic is not covered by any `parts` range.', {
          topicId: node.id,
          expected: `${node.id} inside one of: ${parts.map((p) => p.range).join(', ')}`,
          actual: 'not covered',
        }),
      );
    }
  }

  const suffixes = new Set<string>();
  for (const part of parts) {
    if (suffixes.has(part.suffix)) {
      diagnostics.push(
        error('E004', file, 'Two `parts` entries share a suffix.', {
          expected: 'a distinct suffix per part',
          actual: part.suffix,
        }),
      );
    }
    suffixes.add(part.suffix);
  }

  return diagnostics;
}
