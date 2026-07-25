import { readFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { topLevelNumber } from './anchors.js';
import { error, warning } from './diagnostics.js';
import { checkManifestAgainstOutline, parseManifest } from './manifest.js';
import { countWords, parseLevelFile, readTimeMin, type ParsedLevelFile, type ParsedTopic } from './levelfile.js';
import { parseOutline } from './outline.js';
import { findTopicReferences, findWikilinks, type WikilinkRef } from './references.js';
import {
  LEVEL_BASE,
  LEVEL_IDS,
  type Diagnostic,
  type Level,
  type LevelId,
  type LoadResult,
  type Subject,
  type TopicBody,
  type TopicNode,
  type VerifyMarker,
  flattenOutline,
} from './types.js';

const execFileAsync = promisify(execFile);

/** Level 2's required H3 vocabulary — §7. */
export const REQUIRED_L2_SUBSECTIONS = [
  'Definition',
  'Why It Exists',
  'Interview Explanation',
  'Example',
  'Common Interview Questions',
  'Follow-up Questions',
  'Common Mistakes',
  'Important Facts to Remember',
] as const;

export const CONDITIONAL_L2_SUBSECTIONS = [
  'Syntax',
  'Edge Cases',
  'Comparisons',
  'Complexity',
  'Frequently Confused With',
  // The level 2 exercise from the generator prompt §6, emitted when include_exercises: true.
  'Mock Follow-up',
] as const;

const KNOWN_L2_SUBSECTIONS = new Set<string>([
  ...REQUIRED_L2_SUBSECTIONS,
  ...CONDITIONAL_L2_SUBSECTIONS,
]);

const LEVEL_FILE_NAME_RE = /^([0-3]_[a-z]+?)(?:_([a-z0-9]+))?\.md$/;

interface ExpectedFile {
  level: LevelId;
  suffix: string | null;
  name: string;
}

/**
 * A subject load, plus the wikilinks it contains. Wikilinks can only be resolved once the
 * whole library is known, so they travel out of here unresolved — see `library.ts`.
 */
export interface SubjectLoad extends LoadResult {
  wikilinks: WikilinkRef[];
}

export async function loadSubjectFolder(dir: string, repoRoot: string): Promise<SubjectLoad> {
  const rel = (p: string) => relative(repoRoot, p).split('\\').join('/');
  const folderRel = rel(dir);
  const diagnostics: Diagnostic[] = [];
  const wikilinks: WikilinkRef[] = [];

  const slug = basename(dir);
  const category = basename(dirname(dir));

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return {
      subject: null,
      wikilinks,
      diagnostics: [
        error('E001', folderRel, 'Subject folder could not be read.', {
          expected: 'a readable folder containing manifest.yml',
          actual: 'unreadable',
        }),
      ],
    };
  }

  const manifestPath = join(dir, 'manifest.yml');
  if (!entries.includes('manifest.yml')) {
    return {
      subject: null,
      wikilinks,
      diagnostics: [
        error('E001', `${folderRel}/manifest.yml`, 'manifest.yml is missing.', {
          expected: 'manifest.yml in the subject folder',
          actual: `files present: ${entries.join(', ') || '(none)'}`,
        }),
      ],
    };
  }

  const manifestRel = rel(manifestPath);
  const { manifest, diagnostics: manifestDiagnostics } = parseManifest(
    await readFile(manifestPath, 'utf8'),
    manifestRel,
    { slug, category },
  );
  diagnostics.push(...manifestDiagnostics);
  if (!manifest) return { subject: null, diagnostics, wikilinks };

  // --- which files should exist, per manifest ---------------------------------------
  const expected: ExpectedFile[] = [];
  for (const level of LEVEL_IDS) {
    if (manifest.parts) {
      for (const part of manifest.parts) {
        expected.push({ level, suffix: part.suffix, name: `${LEVEL_BASE[level]}_${part.suffix}.md` });
      }
    } else {
      expected.push({ level, suffix: null, name: `${LEVEL_BASE[level]}.md` });
    }
  }

  const present = new Set(entries.filter((e) => e.endsWith('.md')));
  const expectedNames = new Set(expected.map((e) => e.name));

  for (const name of present) {
    if (!expectedNames.has(name) && LEVEL_FILE_NAME_RE.test(name)) {
      diagnostics.push(
        error('E003', rel(join(dir, name)), 'Level file is not one the manifest implies.', {
          expected: manifest.parts
            ? `one of: ${[...expectedNames].join(', ')}`
            : 'an unsplit subject has exactly the four level files',
          actual: name,
        }),
      );
    }
  }

  const filesByLevel = new Map<LevelId, ExpectedFile[]>();
  for (const level of LEVEL_IDS) {
    const forLevel = expected.filter((e) => e.level === level);
    const existing = forLevel.filter((e) => present.has(e.name));
    if (existing.length === 0) {
      if (level === 0) {
        diagnostics.push(
          error('E003', folderRel, 'Level 0 is missing — a subject must have a foundation level.', {
            expected: forLevel.map((e) => e.name).join(', '),
            actual: 'none of them exist',
          }),
        );
      }
      continue; // levels 1–3 may be absent entirely
    }
    for (const file of forLevel) {
      if (!present.has(file.name)) {
        diagnostics.push(
          error('E003', rel(join(dir, file.name)), 'Level file implied by the manifest is missing.', {
            expected: `${file.name} (parts: ${manifest.parts?.map((p) => p.range).join(', ') ?? 'unsplit'})`,
            actual: `present for this level: ${existing.map((e) => e.name).join(', ')}`,
          }),
        );
      }
    }
    filesByLevel.set(level, existing);
  }

  const level0Files = filesByLevel.get(0);
  if (!level0Files || level0Files.length === 0) return { subject: null, diagnostics, wikilinks };

  // --- parse every present file -----------------------------------------------------
  const parsed = new Map<LevelId, ParsedLevelFile[]>();
  for (const [level, files] of filesByLevel) {
    const out: ParsedLevelFile[] = [];
    for (const file of files) {
      const path = join(dir, file.name);
      const source = await readFile(path, 'utf8');
      const parsedFile = parseLevelFile(source, rel(path), level, file.suffix);
      diagnostics.push(...parsedFile.diagnostics);
      out.push(parsedFile);
    }
    parsed.set(level, out);
  }

  // --- the outline: exactly once, in level 0, in the first part ---------------------
  const carriers = [...parsed.values()].flat().filter((f) => f.hasOutlineComment);
  const expectedCarrier = level0Files[0]?.name ?? `${LEVEL_BASE[0]}.md`;

  if (carriers.length === 0) {
    diagnostics.push(
      error('E005', rel(join(dir, expectedCarrier)), 'Outline comment is missing.', {
        expected: `an \`<!-- OUTLINE v1 … -->\` comment in ${expectedCarrier}`,
        actual: 'no file in this subject contains one',
      }),
    );
    return { subject: null, diagnostics, wikilinks };
  }
  if (carriers.length > 1) {
    diagnostics.push(
      error('E005', rel(join(dir, expectedCarrier)), 'Outline comment appears in more than one file.', {
        expected: `only ${expectedCarrier} carries the outline`,
        actual: carriers.map((c) => basename(c.file)).join(', '),
      }),
    );
  }
  const carrier = carriers[0];
  if (carrier && basename(carrier.file) !== expectedCarrier) {
    diagnostics.push(
      error('E005', carrier.file, 'Outline comment is in the wrong file.', {
        expected: expectedCarrier,
        actual: basename(carrier.file),
      }),
    );
  }
  if (!carrier) return { subject: null, diagnostics, wikilinks };

  const carrierSource = await readFile(join(dir, basename(carrier.file)), 'utf8');
  const outline = parseOutline(carrierSource, carrier.file);
  if (!outline) {
    diagnostics.push(
      error('E005', carrier.file, 'Outline comment is malformed.', {
        expected: '`<!-- OUTLINE v1` … `-->`',
        actual: 'the comment could not be parsed',
      }),
    );
    return { subject: null, diagnostics, wikilinks };
  }
  diagnostics.push(...outline.diagnostics);
  if (outline.flat.length === 0) return { subject: null, diagnostics, wikilinks };

  diagnostics.push(...checkManifestAgainstOutline(manifest, outline, manifestRel));

  const outlineIds = outline.flat.map((n) => n.id);
  const outlineById = new Map(outline.flat.map((n) => [n.id, n]));

  // --- per-file in-file ToC (§6) ----------------------------------------------------
  for (const file of [...parsed.values()].flat()) {
    diagnostics.push(...checkFileToc(file, outline.flat, manifest.parts));
  }

  // --- stitch parts and check each level against the outline (§5, §11) --------------
  const levels = new Map<LevelId, Level>();
  const stitchedTopics = new Map<LevelId, ParsedTopic[]>();

  for (const level of LEVEL_IDS) {
    const files = parsed.get(level);
    if (!files || files.length === 0) continue;

    const ordered = manifest.parts
      ? manifest.parts
          .map((part) => files.find((f) => f.suffix === part.suffix))
          .filter((f): f is ParsedLevelFile => f !== undefined)
      : files;

    const topics: ParsedTopic[] = [];
    const seen = new Map<string, string>();
    for (const file of ordered) {
      for (const topic of file.topics) {
        const owner = seen.get(topic.id);
        if (owner !== undefined) {
          diagnostics.push(
            error('E010', file.file, 'Topic ID appears twice in this level.', {
              topicId: topic.id,
              line: topic.line,
              expected: `${topic.id} in exactly one file`,
              actual: `also in ${basename(owner)}`,
            }),
          );
          continue;
        }
        seen.set(topic.id, file.file);
        topics.push(topic);
      }
    }
    stitchedTopics.set(level, topics);
    diagnostics.push(...checkLevelAgainstOutline(level, topics, outlineIds, outlineById, ordered));
  }

  // --- heading text byte-identical across levels (§11 E008) -------------------------
  const level0Topics = stitchedTopics.get(0) ?? [];
  const headingByTopic = new Map(level0Topics.map((t) => [t.id, t]));
  for (const level of LEVEL_IDS) {
    if (level === 0) continue;
    for (const topic of stitchedTopics.get(level) ?? []) {
      const reference = headingByTopic.get(topic.id);
      if (!reference) continue;
      if (reference.headingText !== topic.headingText) {
        diagnostics.push(
          error('E008', fileOf(parsed, level, topic), 'Heading text differs from Level 0.', {
            topicId: topic.id,
            line: topic.line,
            expected: `## ${reference.headingText}`,
            actual: `## ${topic.headingText}`,
          }),
        );
      }
    }
  }

  // --- level 2 subsection vocabulary, level 3 depth, verify markers -----------------
  const verifyMarkers: VerifyMarker[] = [];

  for (const level of LEVEL_IDS) {
    const topics = stitchedTopics.get(level);
    if (!topics) continue;
    const bodies = new Map<string, TopicBody>();

    for (const topic of topics) {
      const file = fileOf(parsed, level, topic);
      const markers: VerifyMarker[] = topic.verifySentences.map((sentence) => ({
        subject: manifest.slug,
        topicId: topic.id,
        level,
        sentence,
      }));
      verifyMarkers.push(...markers);
      for (const marker of markers) {
        diagnostics.push(
          warning('W006', file, 'Generator flagged this fact for verification.', {
            topicId: topic.id,
            expected: 'a checked fact, or the marker removed once confirmed',
            actual: marker.sentence,
          }),
        );
      }

      for (const ref of findTopicReferences(topic.markdown)) {
        if (outlineById.has(ref)) continue;
        diagnostics.push(
          error('E014', file, 'T-reference points at a topic that is not in the outline.', {
            topicId: topic.id,
            line: topic.line,
            expected: `one of: ${outlineIds.join(', ')}`,
            actual: ref,
          }),
        );
      }

      for (const link of findWikilinks(topic.markdown)) {
        wikilinks.push({ ...link, file, topicId: topic.id, level });
      }

      if (level === 2 && topic.subsections) {
        const names = Object.keys(topic.subsections);
        for (const required of REQUIRED_L2_SUBSECTIONS) {
          if (!names.includes(required)) {
            diagnostics.push(
              warning('W001', file, 'Required Level 2 subsection is missing.', {
                topicId: topic.id,
                line: topic.line,
                expected: `### ${required}`,
                actual: names.length > 0 ? names.map((n) => `### ${n}`).join(', ') : '(no subsections)',
              }),
            );
          }
        }
        for (const name of names) {
          if (!KNOWN_L2_SUBSECTIONS.has(name)) {
            diagnostics.push(
              warning('W008', file, 'Unrecognised H3 in 2_interview — rendered as a plain subsection.', {
                topicId: topic.id,
                expected: `one of: ${[...KNOWN_L2_SUBSECTIONS].join(', ')}`,
                actual: `### ${name}`,
              }),
            );
          }
        }
      }

      bodies.set(topic.id, {
        topicId: topic.id,
        html: '',
        markdown: topic.markdown,
        wordCount: topic.wordCount,
        readTimeMin: readTimeMin(topic.wordCount),
        headings: topic.headings,
        ...(topic.subsections ? { subsections: topic.subsections } : {}),
        verifyMarkers: markers,
      });
    }

    const totalWords = [...bodies.values()].reduce((sum, b) => sum + b.wordCount, 0);
    levels.set(level, { id: level, topics: bodies, readTimeMin: readTimeMin(totalWords) });
  }

  const level1 = levels.get(1);
  const level3 = levels.get(3);
  if (level1 && level3) {
    for (const [topicId, body3] of level3.topics) {
      const body1 = level1.topics.get(topicId);
      if (body1 && body3.wordCount < body1.wordCount) {
        diagnostics.push(
          warning('W004', folderRel, 'Level 3 body is shorter than Level 1 — the run may have run out of steam.', {
            topicId,
            expected: `more than ${body1.wordCount} words (Level 1)`,
            actual: `${body3.wordCount} words (Level 3)`,
          }),
        );
      }
    }
  }

  const subject: Subject = {
    kind: 'subject',
    slug: manifest.slug || slug,
    category: manifest.category || category,
    manifest,
    outline: outline.nodes,
    levels,
    verifyMarkers,
    path: folderRel,
    updated: await lastUpdated(dir, repoRoot),
  };

  return { subject, diagnostics, wikilinks };
}

function fileOf(
  parsed: Map<LevelId, ParsedLevelFile[]>,
  level: LevelId,
  topic: ParsedTopic,
): string {
  const files = parsed.get(level) ?? [];
  return files.find((f) => f.topics.some((t) => t === topic))?.file ?? files[0]?.file ?? '';
}

/** E012 — the in-file ToC must match the outline over this file's own topic range. */
function checkFileToc(
  file: ParsedLevelFile,
  flat: readonly TopicNode[],
  parts: readonly { range: string; from: number; to: number; suffix: string }[] | undefined,
): Diagnostic[] {
  if (!file.tocPresent) {
    return [
      error('E012', file.file, 'File has no `## Table of Contents`.', {
        expected: 'a `## Table of Contents` listing this file’s topics in outline order',
        actual: 'no Table of Contents heading',
      }),
    ];
  }

  const part = parts?.find((p) => p.suffix === file.suffix);
  const expectedTopics = part
    ? flat.filter((n) => {
        const num = topLevelNumber(n.id);
        return num >= part.from && num <= part.to;
      })
    : [...flat];

  const out: Diagnostic[] = [];
  const max = Math.max(expectedTopics.length, file.toc.length);
  for (let i = 0; i < max; i += 1) {
    const want = expectedTopics[i];
    const got = file.toc[i];
    if (want && !got) {
      out.push(
        error('E012', file.file, 'In-file Table of Contents is missing an entry.', {
          topicId: want.id,
          expected: `- [${want.id}. ${want.name}](#${want.anchor})`,
          actual: '(no entry)',
        }),
      );
      continue;
    }
    if (!want && got) {
      out.push(
        error('E012', file.file, 'In-file Table of Contents has an entry outside this file’s range.', {
          line: got.line,
          expected: part ? `only topics in ${part.range}` : 'only topics in the outline',
          actual: `[${got.text}](${got.target})`,
        }),
      );
      continue;
    }
    if (!want || !got) continue;

    const wantText = `${want.id}. ${want.name}`;
    const wantTarget = `#${want.anchor}`;
    if (got.text !== wantText || got.target !== wantTarget) {
      out.push(
        error('E012', file.file, 'In-file Table of Contents disagrees with the outline.', {
          topicId: want.id,
          line: got.line,
          expected: `- [${wantText}](${wantTarget})`,
          actual: `- [${got.text}](${got.target})`,
        }),
      );
    }
  }

  return out;
}

/**
 * E007 / E009 / W005 — a level's topic set against the outline.
 *
 * Level 0 defines the corpus, so anything missing there is an error. In levels 1–3 a
 * missing topic is an incomplete run (W005), an unknown topic is E009, and wrong order is
 * always E007.
 */
function checkLevelAgainstOutline(
  level: LevelId,
  topics: readonly ParsedTopic[],
  outlineIds: readonly string[],
  outlineById: ReadonlyMap<string, TopicNode>,
  files: readonly ParsedLevelFile[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const fileOfTopic = (topic: ParsedTopic) =>
    files.find((f) => f.topics.includes(topic))?.file ?? files[0]?.file ?? '';
  const anyFile = files[0]?.file ?? '';

  const present = new Set<string>();
  for (const topic of topics) {
    if (!outlineById.has(topic.id)) {
      out.push(
        error(
          level === 0 ? 'E007' : 'E009',
          fileOfTopic(topic),
          level === 0
            ? 'Topic heading is not in the outline.'
            : 'Topic appears in this level but not in 0_foundation.md.',
          {
            topicId: topic.id,
            line: topic.line,
            expected: `one of: ${outlineIds.join(', ')}`,
            actual: `## ${topic.headingText}`,
          },
        ),
      );
      continue;
    }
    present.add(topic.id);
  }

  for (const id of outlineIds) {
    if (present.has(id)) continue;
    const node = outlineById.get(id);
    if (level === 0) {
      out.push(
        error('E007', anyFile, 'Outline topic is missing from Level 0.', {
          topicId: id,
          expected: `## ${id}. ${node?.name ?? ''}`,
          actual: 'no heading for this topic in this level',
        }),
      );
    } else {
      out.push(
        warning('W005', anyFile, 'Topic is in Level 0 but missing from this level.', {
          topicId: id,
          expected: `## ${id}. ${node?.name ?? ''}`,
          actual: 'no heading for this topic in this level',
        }),
      );
    }
  }

  const seenOrder = topics.filter((t) => outlineById.has(t.id)).map((t) => t.id);
  const expectedOrder = outlineIds.filter((id) => present.has(id));
  for (const [index, id] of seenOrder.entries()) {
    const want = expectedOrder[index];
    if (want !== undefined && want !== id) {
      const topic = topics.find((t) => t.id === id);
      out.push(
        error('E007', topic ? fileOfTopic(topic) : anyFile, 'Topics are not in outline order.', {
          topicId: id,
          ...(topic ? { line: topic.line } : {}),
          expected: `${want} at position ${index + 1}`,
          actual: `${id} at position ${index + 1}`,
        }),
      );
      break;
    }
  }

  return out;
}

/** `updated` is derived, never declared — git commit date, falling back to file mtime. */
export async function lastUpdated(path: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%cI', '--', path], { cwd });
    const iso = stdout.trim();
    if (iso) return iso.slice(0, 10);
  } catch {
    // not a git checkout, or the file is untracked — fall through to mtime
  }
  try {
    const stats = await stat(path);
    return stats.mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export { flattenOutline, countWords };
