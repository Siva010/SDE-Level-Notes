import { readFile } from 'node:fs/promises';
import { basename, dirname, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { error, warning } from './diagnostics.js';
import { countWords, readTimeMin, slugifyHeading } from './levelfile.js';
import { findWikilinks, type WikilinkRef } from './references.js';
import {
  bodyText,
  collapseSoftBreaks,
  findHeadings,
  readableProse,
  scanLines,
  sentenceAround,
} from './scan.js';
import { lastUpdated, type SubjectLoad } from './subject.js';
import {
  NOTE_TOPIC_ID,
  type Difficulty,
  type Diagnostic,
  type Level,
  type Manifest,
  type Subject,
  type TopicBody,
  type TopicHeading,
  type VerifyMarker,
} from './types.js';

/** Shape B — a loose note: one file, ordinary frontmatter, one level, no outline. §1. */

const FRONTMATTER_RE = /^\uFEFF?---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
const DIFFICULTIES: readonly Difficulty[] = ['intro', 'intermediate', 'advanced'];

export async function loadNoteFile(path: string, repoRoot: string): Promise<SubjectLoad> {
  const file = relative(repoRoot, path).split('\\').join('/');
  const diagnostics: Diagnostic[] = [];
  const slug = basename(path, '.md');
  const category = basename(dirname(path));

  const source = await readFile(path, 'utf8');
  const match = FRONTMATTER_RE.exec(source);
  if (!match?.[1]) {
    return {
      subject: null,
      wikilinks: [],
      diagnostics: [
        error('E001', file, 'Loose note has no YAML frontmatter.', {
          expected: 'a `---` block with title, summary, tags, difficulty',
          actual: source.split('\n')[0] ?? '(empty file)',
        }),
      ],
    };
  }

  let raw: unknown;
  try {
    raw = parseYaml(match[1]);
  } catch (cause) {
    return {
      subject: null,
      wikilinks: [],
      diagnostics: [
        error('E001', file, 'Loose note frontmatter is not parseable YAML.', {
          expected: 'a YAML mapping',
          actual: cause instanceof Error ? (cause.message.split('\n')[0] ?? 'parse error') : 'parse error',
        }),
      ],
    };
  }

  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (key: string): string => (typeof data[key] === 'string' ? (data[key] as string) : '');

  for (const key of ['title', 'summary', 'tags', 'difficulty']) {
    if (!(key in data)) {
      diagnostics.push(
        error('E001', file, `Loose note frontmatter is missing \`${key}\`.`, {
          expected: `\`${key}\` present`,
          actual: `keys present: ${Object.keys(data).join(', ') || '(none)'}`,
        }),
      );
    }
  }

  const difficultyRaw = str('difficulty');
  const difficulty: Difficulty = (DIFFICULTIES as readonly string[]).includes(difficultyRaw)
    ? (difficultyRaw as Difficulty)
    : 'intermediate';
  if (difficultyRaw !== '' && !(DIFFICULTIES as readonly string[]).includes(difficultyRaw)) {
    diagnostics.push(
      error('E001', file, 'Loose note `difficulty` is not one of the allowed values.', {
        expected: DIFFICULTIES.join(' | '),
        actual: JSON.stringify(difficultyRaw),
      }),
    );
  }

  const tags = Array.isArray(data['tags']) ? data['tags'].filter((t): t is string => typeof t === 'string') : [];
  const prereqs = Array.isArray(data['prereqs'])
    ? data['prereqs'].filter((t): t is string => typeof t === 'string')
    : [];

  const body = source.slice(match[0].length).replace(/^\n+/, '');
  const prose = readableProse(body);
  const wordCount = countWords(bodyText(body));

  const paragraphs = collapseSoftBreaks(prose);
  const verifyMarkers: VerifyMarker[] = [...paragraphs.matchAll(/⚠️\s*verify/g)].map((m) => ({
    subject: slug,
    topicId: NOTE_TOPIC_ID,
    level: 0,
    sentence: sentenceAround(paragraphs, m.index),
  }));

  for (const marker of verifyMarkers) {
    diagnostics.push(
      warning('W006', file, 'Note flags this fact for verification.', {
        expected: 'a checked fact, or the marker removed once confirmed',
        actual: marker.sentence,
      }),
    );
  }

  const headings: TopicHeading[] = findHeadings(scanLines(body))
    .filter((h) => h.depth === 3)
    .map((h) => ({ depth: 3, text: h.text, anchor: slugifyHeading(h.text) }));

  const topic: TopicBody = {
    topicId: NOTE_TOPIC_ID,
    html: '',
    markdown: body,
    wordCount,
    readTimeMin: readTimeMin(wordCount),
    headings,
    verifyMarkers,
  };

  const level: Level = {
    id: 0,
    topics: new Map([[NOTE_TOPIC_ID, topic]]),
    readTimeMin: readTimeMin(wordCount),
  };

  const manifest: Manifest = {
    subject: str('title') || slug,
    slug,
    category,
    summary: str('summary'),
    tags,
    difficulty,
    language_or_format: '',
    version_target: '',
    audience: '',
    goal: '',
    topic_count: 0,
    outline_version: '',
    prereqs,
    generated: '',
  };

  const subject: Subject = {
    kind: 'note',
    slug,
    category,
    manifest,
    outline: [],
    levels: new Map([[0, level]]),
    verifyMarkers,
    path: file,
    updated: await lastUpdated(path, repoRoot),
  };

  const wikilinks: WikilinkRef[] = findWikilinks(body).map((link) => ({
    ...link,
    file,
    topicId: NOTE_TOPIC_ID,
    level: 0,
  }));

  return { subject, diagnostics, wikilinks };
}
