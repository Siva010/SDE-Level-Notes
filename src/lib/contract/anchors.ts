/**
 * The anchor algorithm — CONTENT-CONTRACT.md §4.
 *
 *   anchor(id, name) = lower(id.replace('.', '-')) + '-' + lower(name).replace(/\s+/g, '-')
 *
 * The generator writes these anchors into links before the site exists, so this is the
 * definition every slugifier on the site must be overridden to match. Do not "improve" it.
 */

export const TOPIC_HEADING_RE = /^(T\d+(?:\.\d+)?)\.\s+(.+)$/;

/** Topic names are anchor-safe by contract — §3. */
export const ANCHOR_SAFE_NAME_RE = /^[A-Za-z0-9 -]+$/;

/** Deeper than one level of nesting, e.g. `T4.1.2` — §11 E018. */
export const OVER_NESTED_ID_RE = /^T\d+(?:\.\d+){2,}$/;

export function anchor(id: string, name: string): string {
  return `${id.replaceAll('.', '-').toLowerCase()}-${name.toLowerCase().replace(/\s+/g, '-')}`;
}

export interface ParsedTopicHeading {
  id: string;
  name: string;
}

/** Parse `T7. Volatile Keyword` (heading text with the `## ` already removed). */
export function parseTopicHeadingText(text: string): ParsedTopicHeading | null {
  const match = TOPIC_HEADING_RE.exec(text.trim());
  if (!match) return null;
  const [, id, name] = match;
  if (id === undefined || name === undefined) return null;
  return { id, name: name.trim() };
}

/** `T4.1` → parent `T4`; `T4` → null. */
export function parentTopicId(id: string): string | null {
  const dot = id.indexOf('.');
  return dot === -1 ? null : id.slice(0, dot);
}

/** The leading number of a top-level or nested id: `T12.3` → 12. */
export function topLevelNumber(id: string): number {
  const match = /^T(\d+)/.exec(id);
  return match?.[1] === undefined ? Number.NaN : Number(match[1]);
}

/**
 * Anchor fragment → topic id. `t4-1-fail-fast-iterators` → `T4.1`, `#t7` → `T7`.
 * Used to resolve wikilink fragments and to check nav strips.
 */
export function topicIdFromAnchorFragment(fragment: string): string | null {
  const cleaned = fragment.replace(/^#/, '').toLowerCase();
  const match = /^t(\d+)(?:-(\d+))?(?:-|$)/.exec(cleaned);
  if (!match?.[1]) return null;
  return match[2] ? `T${match[1]}.${match[2]}` : `T${match[1]}`;
}
