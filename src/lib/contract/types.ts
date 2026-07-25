/**
 * The typed shape of parsed content. Normative source: CONTENT-CONTRACT.md §10.
 *
 * Everything here is produced once, at build time. No component re-parses markdown.
 */

export type LevelId = 0 | 1 | 2 | 3;

export const LEVEL_IDS: readonly LevelId[] = [0, 1, 2, 3];

/** Fixed level base names — CONTENT-CONTRACT.md §1. */
export const LEVEL_BASE: Record<LevelId, string> = {
  0: '0_foundation',
  1: '1_understand',
  2: '2_interview',
  3: '3_production',
};

/** The plain-text level names used by the `<sub>Levels: …</sub>` nav strip — §6. */
export const LEVEL_LABEL: Record<LevelId, string> = {
  0: 'Foundation',
  1: 'Understand',
  2: 'Interview',
  3: 'Production',
};

export const LEVEL_BY_BASE: ReadonlyMap<string, LevelId> = new Map(
  LEVEL_IDS.map((id) => [LEVEL_BASE[id], id]),
);

export const LEVEL_BY_LABEL: ReadonlyMap<string, LevelId> = new Map(
  LEVEL_IDS.map((id) => [LEVEL_LABEL[id], id]),
);

export type Difficulty = 'intro' | 'intermediate' | 'advanced';

export interface PartSpec {
  /** As written in the manifest, e.g. `T1-T9`. */
  range: string;
  /** Inclusive, top-level topic numbers only. */
  from: number;
  to: number;
  /** File suffix, e.g. `part1`. */
  suffix: string;
}

export interface Manifest {
  subject: string;
  slug: string;
  category: string;
  summary: string;
  tags: string[];
  difficulty: Difficulty;
  language_or_format: string;
  version_target: string;
  audience: string;
  goal: string;
  topic_count: number;
  outline_version: string;
  prereqs: string[];
  generated: string;
  parts?: PartSpec[];
}

export interface TopicNode {
  /** `T7` or `T4.1`. */
  id: string;
  name: string;
  anchor: string;
  children: TopicNode[];
}

export interface VerifyMarker {
  subject: string;
  topicId: string;
  level: LevelId;
  /** The sentence containing the `⚠️ verify` marker, marker included. */
  sentence: string;
}

export interface TopicHeading {
  depth: 3;
  text: string;
  anchor: string;
}

export interface TopicBody {
  topicId: string;
  /** Rendered HTML. Empty until the render pass runs. */
  html: string;
  /** Source markdown, already stripped per §9. */
  markdown: string;
  wordCount: number;
  readTimeMin: number;
  headings: TopicHeading[];
  /** Level 2 only — the closed H3 vocabulary of §7, as raw markdown per subsection. */
  subsections?: Record<string, string>;
  verifyMarkers: VerifyMarker[];
}

export interface Level {
  id: LevelId;
  /** Keyed by topic id, in outline order. */
  topics: Map<string, TopicBody>;
  readTimeMin: number;
}

export type SubjectKind = 'subject' | 'note';

/** The single synthetic topic id a loose note's body lives under — CONTENT-CONTRACT.md §1. */
export const NOTE_TOPIC_ID = '__note__';

export interface Subject {
  kind: SubjectKind;
  slug: string;
  category: string;
  manifest: Manifest;
  outline: TopicNode[];
  levels: Map<LevelId, Level>;
  verifyMarkers: VerifyMarker[];
  /** Repo-relative path of the folder (subject) or file (note). */
  path: string;
  /** ISO date: git commit date, falling back to file mtime. */
  updated: string;
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  /** Stable, greppable — `E001`…`E018`, `W001`…`W008`. CONTENT-CONTRACT.md §11. */
  code: string;
  severity: Severity;
  /** Repo-relative path of the offending file, or the folder when no single file owns it. */
  file: string;
  topicId?: string;
  line?: number;
  message: string;
  expected?: string;
  actual?: string;
}

export interface LoadResult {
  /** Null when the content could not be parsed far enough to produce a subject. */
  subject: Subject | null;
  diagnostics: Diagnostic[];
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}

export function flattenOutline(nodes: readonly TopicNode[]): TopicNode[] {
  const out: TopicNode[] = [];
  for (const node of nodes) {
    out.push(node);
    out.push(...flattenOutline(node.children));
  }
  return out;
}
