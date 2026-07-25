import {
  ANCHOR_SAFE_NAME_RE,
  OVER_NESTED_ID_RE,
  TOPIC_HEADING_RE,
  anchor,
  parentTopicId,
} from './anchors.js';
import { error } from './diagnostics.js';
import type { Diagnostic, TopicNode } from './types.js';

/**
 * The outline comment — CONTENT-CONTRACT.md §3. Single source of truth for which topics
 * exist and in what order. Nothing is ever inferred from a level file that contradicts it.
 */

export const OUTLINE_COMMENT_RE = /<!--\s*OUTLINE\s+(v\d+)\s*\n([\s\S]*?)-->/;

export interface OutlineParse {
  version: string;
  nodes: TopicNode[];
  /** Flat, in source order — convenient for the many "same set, same order" checks. */
  flat: TopicNode[];
  diagnostics: Diagnostic[];
}

/** Does this file contain an outline comment at all? Used for the "exactly once" check. */
export function hasOutlineComment(source: string): boolean {
  return OUTLINE_COMMENT_RE.test(source);
}

export function stripOutlineComment(source: string): string {
  return source.replace(OUTLINE_COMMENT_RE, '').replace(/^\n+/, '');
}

export function parseOutline(source: string, file: string): OutlineParse | null {
  const match = OUTLINE_COMMENT_RE.exec(source);
  if (!match?.[1] || match[2] === undefined) return null;

  const version = match[1];
  const diagnostics: Diagnostic[] = [];
  const commentStartLine = source.slice(0, match.index).split('\n').length;

  const nodes: TopicNode[] = [];
  const flat: TopicNode[] = [];
  const seenIds = new Map<string, number>();
  const seenAnchors = new Map<string, string>();

  const lines = match[2].split('\n');
  for (const [offset, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '') continue;
    const lineNo = commentStartLine + 1 + offset;

    const parsed = TOPIC_HEADING_RE.exec(line);
    if (!parsed?.[1] || parsed[2] === undefined) {
      const overNested = /^(T\d+(?:\.\d+){2,})\.\s+/.exec(line);
      if (overNested?.[1] && OVER_NESTED_ID_RE.test(overNested[1])) {
        diagnostics.push(
          error('E018', file, 'Outline nesting is one level deep only.', {
            topicId: overNested[1],
            line: lineNo,
            expected: 'an id of the form `Tn` or `Tn.m`',
            actual: overNested[1],
          }),
        );
        continue;
      }
      diagnostics.push(
        error('E005', file, 'Outline line does not match the outline grammar.', {
          line: lineNo,
          expected: '`Tn. Topic Name` or `Tn.m. Subtopic Name`',
          actual: line,
        }),
      );
      continue;
    }

    const id = parsed[1];
    const name = parsed[2].trim();

    if (!ANCHOR_SAFE_NAME_RE.test(name)) {
      const offending = [...name].filter((c) => !ANCHOR_SAFE_NAME_RE.test(c));
      diagnostics.push(
        error('E006', file, 'Topic name contains a character that is not anchor-safe.', {
          topicId: id,
          line: lineNo,
          expected: 'letters, digits, spaces and hyphens only',
          actual: `${JSON.stringify(name)} contains ${JSON.stringify(offending.join(''))}`,
        }),
      );
      continue;
    }

    const previousLine = seenIds.get(id);
    if (previousLine !== undefined) {
      diagnostics.push(
        error('E010', file, 'Duplicate topic ID in the outline.', {
          topicId: id,
          line: lineNo,
          expected: `${id} declared once`,
          actual: `also declared on line ${previousLine}`,
        }),
      );
      continue;
    }
    seenIds.set(id, lineNo);

    const topicAnchor = anchor(id, name);
    const anchorOwner = seenAnchors.get(topicAnchor);
    if (anchorOwner !== undefined) {
      diagnostics.push(
        error('E010', file, 'Two topics resolve to the same anchor.', {
          topicId: id,
          line: lineNo,
          expected: 'one topic per anchor',
          actual: `${id} and ${anchorOwner} both resolve to #${topicAnchor}`,
        }),
      );
      continue;
    }
    seenAnchors.set(topicAnchor, id);

    const node: TopicNode = { id, name, anchor: topicAnchor, children: [] };
    const parentId = parentTopicId(id);

    if (parentId === null) {
      nodes.push(node);
      flat.push(node);
      continue;
    }

    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) {
      diagnostics.push(
        error('E018', file, 'Nested topic has no preceding parent topic.', {
          topicId: id,
          line: lineNo,
          expected: `${parentId} declared before ${id}`,
          actual: `${parentId} is not in the outline above this line`,
        }),
      );
      continue;
    }
    if (nodes[nodes.length - 1] !== parent) {
      diagnostics.push(
        error('E018', file, 'Nested topic is not directly under its parent.', {
          topicId: id,
          line: lineNo,
          expected: `${id} directly after ${parentId} or a sibling ${parentId}.k`,
          actual: `it follows ${nodes[nodes.length - 1]?.id ?? '(nothing)'}`,
        }),
      );
      continue;
    }
    parent.children.push(node);
    flat.push(node);
  }

  if (flat.length === 0 && diagnostics.length === 0) {
    diagnostics.push(
      error('E005', file, 'Outline comment contains no topics.', {
        expected: 'at least one `Tn. Topic Name` line',
        actual: 'empty outline',
      }),
    );
  }

  return { version, nodes, flat, diagnostics };
}
