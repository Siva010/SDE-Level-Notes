/**
 * Line scanning that knows about fenced code, so a `## ` inside a bash block is never
 * mistaken for a heading and a `T4` inside a Java snippet is never linkified.
 */

export interface ScannedLine {
  text: string;
  /** 1-based. */
  line: number;
  inFence: boolean;
  inHtmlComment: boolean;
  /** The fence's info string when this line opens a fence, else null. */
  fenceInfo: string | null;
  isFenceDelimiter: boolean;
}

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

export function scanLines(source: string): ScannedLine[] {
  const out: ScannedLine[] = [];
  let fence: { marker: string; length: number } | null = null;
  let inComment = false;

  for (const [index, text] of source.split('\n').entries()) {
    const line = index + 1;
    let isFenceDelimiter = false;
    let fenceInfo: string | null = null;

    const fenceMatch = FENCE_RE.exec(text);
    if (fenceMatch?.[2] && !inComment) {
      const marker = fenceMatch[2][0] ?? '`';
      const length = fenceMatch[2].length;
      const info = (fenceMatch[3] ?? '').trim();
      if (fence === null) {
        fence = { marker, length };
        isFenceDelimiter = true;
        fenceInfo = info;
      } else if (marker === fence.marker && length >= fence.length && info === '') {
        out.push({ text, line, inFence: true, inHtmlComment: false, fenceInfo: null, isFenceDelimiter: true });
        fence = null;
        continue;
      }
    }

    const openedComment = !inComment && !fence && text.includes('<!--') && !text.includes('-->');
    const wasInComment = inComment;
    if (openedComment) inComment = true;
    else if (inComment && text.includes('-->')) inComment = false;

    out.push({
      text,
      line,
      inFence: fence !== null,
      inHtmlComment: wasInComment || openedComment,
      fenceInfo,
      isFenceDelimiter,
    });
  }

  return out;
}

export interface HeadingLine {
  depth: number;
  text: string;
  line: number;
  /** Index into the scanned-line array. */
  index: number;
}

const ATX_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

export function findHeadings(lines: readonly ScannedLine[]): HeadingLine[] {
  const out: HeadingLine[] = [];
  for (const [index, scanned] of lines.entries()) {
    if (scanned.inFence || scanned.inHtmlComment) continue;
    const match = ATX_RE.exec(scanned.text);
    if (!match?.[1] || match[2] === undefined) continue;
    out.push({ depth: match[1].length, text: match[2].trim(), line: scanned.line, index });
  }
  return out;
}

/**
 * Body text with everything that opts out of reference detection removed: fenced blocks,
 * inline code spans, headings, HTML comments, HTML tags, and link text and targets.
 * CONTENT-CONTRACT.md §7.
 */
export function plainProse(markdown: string): string {
  const kept = scanLines(markdown)
    .filter((l) => !l.inFence && !l.isFenceDelimiter && !l.inHtmlComment)
    .map((l) => (ATX_RE.test(l.text) ? '' : l.text))
    .join('\n');

  return kept
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>\n]+>/g, ' ');
}

/**
 * Everything a reader actually reads, code included. This is what read time and the
 * level-depth comparison (W004) are measured over — a Level 3 body that is mostly SQL is
 * dense, not thin, and dropping fenced code from the count would misreport it.
 */
export function bodyText(markdown: string): string {
  return scanLines(markdown)
    .filter((l) => !l.isFenceDelimiter && !l.inHtmlComment)
    .map((l) => l.text.replace(ATX_RE, '$2'))
    .join('\n')
    .replace(/<[^>\n]+>/g, ' ');
}

/**
 * Prose for reading, not for reference detection: fenced code, headings and HTML are gone,
 * but inline code keeps its text, so a quoted sentence still makes sense to a human.
 */
export function readableProse(markdown: string): string {
  const kept = scanLines(markdown)
    .filter((l) => !l.inFence && !l.isFenceDelimiter && !l.inHtmlComment)
    .map((l) => (ATX_RE.test(l.text) ? '' : l.text))
    .join('\n');

  return kept
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/\*\*|__/g, '');
}

/**
 * Join wrapped lines back into paragraphs. Source markdown is hard-wrapped, so without this
 * every sentence looks like it ends at column 90.
 */
export function collapseSoftBreaks(text: string): string {
  return text.replace(/([^\n])\n(?!\n)/g, '$1 ');
}

/** The sentence containing `index`, for verify-marker context. */
export function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index);
  const after = text.slice(index);
  const start = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('! '),
    before.lastIndexOf('? '),
    before.lastIndexOf('\n'),
  );
  const endMatch = /[.!?](\s|$)|\n/.exec(after);
  const end = endMatch ? index + endMatch.index + 1 : text.length;
  return text
    .slice(start + 1, end)
    .replace(/\s+/g, ' ')
    .trim();
}
