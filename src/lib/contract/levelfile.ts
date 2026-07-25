import { anchor, parseTopicHeadingText } from './anchors.js';
import { error, warning } from './diagnostics.js';
import { OUTLINE_COMMENT_RE } from './outline.js';
import {
  bodyText,
  collapseSoftBreaks,
  findHeadings,
  readableProse,
  scanLines,
  sentenceAround,
} from './scan.js';
import {
  LEVEL_BASE,
  LEVEL_BY_LABEL,
  LEVEL_IDS,
  LEVEL_LABEL,
  type Diagnostic,
  type LevelId,
  type TopicHeading,
} from './types.js';

/** One `<level>[_<suffix>].md` file, parsed. CONTENT-CONTRACT.md §§4–7, §9. */

export const TOC_HEADING = 'Table of Contents';
export const WORDS_PER_MINUTE = 210;

const CONTINUE_COMMENT_RE = /<!--\s*CONTINUE:[\s\S]*?-->/g;
const NAV_STRIP_RE = /^<sub>\s*Levels:\s*(.*?)\s*<\/sub>\s*$/;
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const PART_FILE_RE = /^([0-3]_[a-z]+)_([a-z0-9]+)\.md$/;
const LEVEL_FILE_RE = /^([0-3]_[a-z]+?)(?:_([a-z0-9]+))?\.md$/;

export interface TocEntry {
  text: string;
  target: string;
  line: number;
}

export interface ParsedTopic {
  id: string;
  name: string;
  anchor: string;
  /** The full heading text, e.g. `T7. Volatile Keyword` — compared byte-for-byte across levels. */
  headingText: string;
  line: number;
  /** Body markdown, stripped per §9. */
  markdown: string;
  headings: TopicHeading[];
  subsections?: Record<string, string>;
  verifySentences: string[];
  wordCount: number;
}

export interface ParsedLevelFile {
  file: string;
  level: LevelId;
  suffix: string | null;
  title: string | null;
  tocPresent: boolean;
  toc: TocEntry[];
  topics: ParsedTopic[];
  hasOutlineComment: boolean;
  diagnostics: Diagnostic[];
}

/** Slug for an H3, using the same rules as the topic anchor algorithm so ids never drift. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function readTimeMin(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

export function countWords(markdown: string): number {
  const prose = markdown.replace(/\s+/g, ' ').trim();
  return prose === '' ? 0 : prose.split(' ').length;
}

/** True when a line is nothing but links to part files plus separators — §5. */
function isPartNavLine(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || !trimmed.includes('](')) return false;
  let sawPartLink = false;
  const remainder = trimmed.replace(LINK_RE, (whole, _text: string, target: string) => {
    const file = target.split('#')[0] ?? '';
    if (PART_FILE_RE.test(file)) {
      sawPartLink = true;
      return '';
    }
    return whole;
  });
  if (!sawPartLink) return false;
  return /^[\s·|—–\-*_<>←→‹›]*$/.test(remainder.replace(/<\/?[a-z]+>/gi, ''));
}

export function parseLevelFile(
  source: string,
  file: string,
  level: LevelId,
  suffix: string | null,
): ParsedLevelFile {
  const diagnostics: Diagnostic[] = [];
  const basename = file.split('/').pop() ?? file;

  if (/^﻿?---\s*\n/.test(source) && /\n---\s*(\n|$)/.test(source)) {
    diagnostics.push(
      error('E017', file, 'YAML frontmatter found at the top of a level file.', {
        expected: 'the file to start with its H1 — metadata lives only in manifest.yml',
        actual: source.split('\n').slice(0, 3).join(' / '),
      }),
    );
  }

  const hasOutline = OUTLINE_COMMENT_RE.test(source);
  const body = source
    .replace(OUTLINE_COMMENT_RE, (match) => '\n'.repeat(match.split('\n').length - 1))
    .replace(CONTINUE_COMMENT_RE, '');

  const lines = scanLines(body);
  const headings = findHeadings(lines);

  let title: string | null = null;
  const h1 = headings.find((h) => h.depth === 1);
  if (h1) title = h1.text;

  const h2s = headings.filter((h) => h.depth === 2);
  const topics: ParsedTopic[] = [];
  const toc: TocEntry[] = [];
  let tocPresent = false;

  for (const [index, heading] of h2s.entries()) {
    const next = h2s[index + 1];
    const sectionLines = lines.slice(heading.index + 1, next ? next.index : lines.length);

    if (heading.text === TOC_HEADING) {
      tocPresent = true;
      for (const scanned of sectionLines) {
        if (scanned.inFence || scanned.inHtmlComment) continue;
        for (const match of scanned.text.matchAll(LINK_RE)) {
          const [, text, target] = match;
          if (text === undefined || target === undefined) continue;
          toc.push({ text: text.trim(), target: target.trim(), line: scanned.line });
        }
      }
      continue;
    }

    const parsed = parseTopicHeadingText(heading.text);
    if (!parsed) {
      diagnostics.push(
        error('E011', file, 'H2 is neither `Table of Contents` nor a valid topic heading.', {
          line: heading.line,
          expected: '`## Tn. Topic Name` or `## Table of Contents`',
          actual: `## ${heading.text}`,
        }),
      );
      continue;
    }

    const topicAnchor = anchor(parsed.id, parsed.name);
    const kept: string[] = [];
    let navStrip: { text: string; line: number } | null = null;

    for (const scanned of sectionLines) {
      if (!scanned.inFence && navStrip === null && NAV_STRIP_RE.test(scanned.text.trim())) {
        navStrip = { text: scanned.text.trim(), line: scanned.line };
        continue;
      }
      if (!scanned.inFence && isPartNavLine(scanned.text)) continue;
      kept.push(scanned.text);
    }

    if (navStrip === null) {
      diagnostics.push(
        error('E013', file, 'Topic has no cross-level nav strip.', {
          topicId: parsed.id,
          line: heading.line,
          expected: `\`<sub>Levels: …</sub>\` as the first line under the heading`,
          actual: 'no nav strip found in this topic',
        }),
      );
    } else {
      diagnostics.push(
        ...checkNavStrip(navStrip.text, navStrip.line, file, basename, level, parsed.id, topicAnchor),
      );
    }

    const markdown = kept.join('\n').replace(/^\n+/, '').replace(/\n{3,}$/, '\n').trimEnd();
    const topicHeadings = findHeadings(scanLines(markdown))
      .filter((h) => h.depth === 3)
      .map<TopicHeading>((h) => ({ depth: 3, text: h.text, anchor: slugifyHeading(h.text) }));

    const prose = readableProse(markdown);
    const paragraphs = collapseSoftBreaks(prose);
    const verifySentences: string[] = [];
    for (const match of paragraphs.matchAll(/⚠️\s*verify/g)) {
      verifySentences.push(sentenceAround(paragraphs, match.index));
    }

    topics.push({
      id: parsed.id,
      name: parsed.name,
      anchor: topicAnchor,
      headingText: heading.text,
      line: heading.line,
      markdown,
      headings: topicHeadings,
      ...(level === 2 ? { subsections: splitSubsections(markdown) } : {}),
      verifySentences,
      wordCount: countWords(bodyText(markdown)),
    });
  }

  diagnostics.push(...checkFenceLanguages(lines, file));

  return {
    file,
    level,
    suffix,
    title,
    tocPresent,
    toc,
    topics,
    hasOutlineComment: hasOutline,
    diagnostics,
  };
}

/**
 * Diagram types mermaid recognises on the first line of a block. A full mermaid parse needs
 * a DOM, so this is the build-time sanity check; the renderer keeps the source visible when
 * a diagram fails for any other reason (§11 W003).
 */
const MERMAID_HEADERS =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|sankey-beta|xychart-beta|block-beta|C4Context|requirementDiagram|packet-beta|architecture-beta)\b/;

/** W002 — a fence with no language tag. W003 — a mermaid block that cannot be a diagram. */
function checkFenceLanguages(lines: ReturnType<typeof scanLines>, file: string): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const [index, scanned] of lines.entries()) {
    if (!scanned.isFenceDelimiter || scanned.fenceInfo === null) continue;

    if (scanned.fenceInfo === '') {
      out.push(
        warning('W002', file, 'Code fence has no language tag.', {
          line: scanned.line,
          expected: 'an info string such as ```java',
          actual: '```',
        }),
      );
      continue;
    }

    if (scanned.fenceInfo.split(/\s+/)[0] !== 'mermaid') continue;

    const close = lines.findIndex((l, i) => i > index && l.isFenceDelimiter && l.fenceInfo === null);
    const body = lines.slice(index + 1, close === -1 ? lines.length : close);
    const first = body.map((l) => l.text.trim()).find((t) => t !== '' && !t.startsWith('%%'));
    if (first === undefined || !MERMAID_HEADERS.test(first)) {
      out.push(
        warning('W003', file, 'Mermaid block does not start with a diagram type — rendering its source instead.', {
          line: scanned.line,
          expected: 'a first line such as `flowchart TD` or `sequenceDiagram`',
          actual: first ?? '(empty block)',
        }),
      );
    }
  }

  return out;
}

/**
 * The nav strip is a free checksum — §6. It declares which level file this is (the one
 * plain-text label) and what this topic's anchor should be (every link's fragment).
 */
function checkNavStrip(
  strip: string,
  line: number,
  file: string,
  basename: string,
  level: LevelId,
  topicId: string,
  expectedAnchor: string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const match = NAV_STRIP_RE.exec(strip);
  const inner = match?.[1] ?? '';

  const declaredPlain: string[] = [];
  const linked: { label: string; target: string }[] = [];

  for (const chunk of inner.split('·')) {
    const text = chunk.trim();
    if (text === '') continue;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(text);
    if (link?.[1] && link[2]) {
      linked.push({ label: link[1].trim(), target: link[2].trim() });
    } else {
      declaredPlain.push(text.replace(/\*\*/g, '').trim());
    }
  }

  if (declaredPlain.length !== 1 || LEVEL_BY_LABEL.get(declaredPlain[0] ?? '') !== level) {
    out.push(
      error('E013', file, 'Nav strip does not declare this file’s own level as plain text.', {
        topicId,
        line,
        expected: `exactly one plain-text level name, and it should be \`${LEVEL_LABEL[level]}\``,
        actual: declaredPlain.length === 0 ? '(every level is a link)' : declaredPlain.join(', '),
      }),
    );
  }

  for (const entry of linked) {
    const [targetFile = '', fragment = ''] = entry.target.split('#');
    const targetLevel = LEVEL_BY_LABEL.get(entry.label);

    if (targetLevel === undefined) {
      out.push(
        error('E013', file, 'Nav strip uses a level name that is not one of the four levels.', {
          topicId,
          line,
          expected: LEVEL_IDS.map((id) => LEVEL_LABEL[id]).join(' | '),
          actual: entry.label,
        }),
      );
      continue;
    }

    const fileMatch = LEVEL_FILE_RE.exec(targetFile);
    if (!fileMatch?.[1] || fileMatch[1] !== LEVEL_BASE[targetLevel]) {
      out.push(
        error('E013', file, 'Nav strip link points at the wrong level file.', {
          topicId,
          line,
          expected: `a file named ${LEVEL_BASE[targetLevel]}[_<suffix>].md for “${entry.label}”`,
          actual: targetFile || '(no file)',
        }),
      );
    }

    if (fragment !== expectedAnchor) {
      out.push(
        error('E013', file, 'Nav strip anchor disagrees with the topic heading.', {
          topicId,
          line,
          expected: `#${expectedAnchor}`,
          actual: fragment ? `#${fragment}` : '(no anchor)',
        }),
      );
    }
  }

  const ownFile = LEVEL_FILE_RE.exec(basename);
  if (ownFile?.[1] && ownFile[1] !== LEVEL_BASE[level]) {
    out.push(
      error('E013', file, 'Level file name does not match its level.', {
        topicId,
        line,
        expected: LEVEL_BASE[level],
        actual: ownFile[1],
      }),
    );
  }

  return out;
}

/** Level 2's closed H3 vocabulary — §7. Values are raw markdown. */
export function splitSubsections(markdown: string): Record<string, string> {
  const lines = scanLines(markdown);
  const h3s = findHeadings(lines).filter((h) => h.depth === 3);
  const out: Record<string, string> = {};

  for (const [index, heading] of h3s.entries()) {
    const next = h3s[index + 1];
    const slice = lines.slice(heading.index + 1, next ? next.index : lines.length);
    out[heading.text] = slice
      .map((l) => l.text)
      .join('\n')
      .trim();
  }

  return out;
}
