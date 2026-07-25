import { plainProse } from './scan.js';
import type { LevelId } from './types.js';

/** T-references and wikilinks — CONTENT-CONTRACT.md §7. Backticks and code opt out. */

const TREF_RE = /\bT\d+(?:\.\d+)?\b/g;
const WIKILINK_RE = /\[\[([^\]#|]+?)(?:#([^\]|]+))?\]\]/g;

export interface WikilinkRef {
  raw: string;
  slug: string;
  fragment: string | null;
  file: string;
  topicId: string;
  level: LevelId;
}

export function findTopicReferences(markdown: string): string[] {
  const prose = plainProse(markdown);
  return [...new Set([...prose.matchAll(TREF_RE)].map((m) => m[0]))];
}

export function findWikilinks(markdown: string): { raw: string; slug: string; fragment: string | null }[] {
  const prose = plainProse(markdown);
  const out: { raw: string; slug: string; fragment: string | null }[] = [];
  for (const match of prose.matchAll(WIKILINK_RE)) {
    const slug = match[1]?.trim();
    if (!slug) continue;
    out.push({ raw: match[0], slug, fragment: match[2]?.trim() ?? null });
  }
  return out;
}
