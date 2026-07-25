import type { Diagnostic, Severity } from './types.js';

/**
 * A validation failure that doesn't name the file, the topic ID, and expected vs actual is
 * always an error (CLAUDE.md). `expected`/`actual` are optional only for the codes where
 * there is genuinely nothing to compare — a missing file, a stray marker.
 */
export function diag(
  code: string,
  severity: Severity,
  file: string,
  message: string,
  extra: Partial<Pick<Diagnostic, 'topicId' | 'line' | 'expected' | 'actual'>> = {},
): Diagnostic {
  return { code, severity, file, message, ...extra };
}

export function error(
  code: string,
  file: string,
  message: string,
  extra: Partial<Pick<Diagnostic, 'topicId' | 'line' | 'expected' | 'actual'>> = {},
): Diagnostic {
  return diag(code, 'error', file, message, extra);
}

export function warning(
  code: string,
  file: string,
  message: string,
  extra: Partial<Pick<Diagnostic, 'topicId' | 'line' | 'expected' | 'actual'>> = {},
): Diagnostic {
  return diag(code, 'warning', file, message, extra);
}

const RESET = '[0m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';

function paint(text: string, colour: string, colours: boolean): string {
  return colours ? `${colour}${text}${RESET}` : text;
}

/** One diagnostic as a multi-line block: code, location, message, expected vs actual. */
export function formatDiagnostic(d: Diagnostic, colours = false): string {
  const colour = d.severity === 'error' ? RED : YELLOW;
  const where = [d.file, d.line !== undefined ? `:${d.line}` : '', d.topicId ? `  ${d.topicId}` : '']
    .join('')
    .trim();
  const lines = [`${paint(d.code, colour, colours)}  ${where}`, `      ${d.message}`];
  if (d.expected !== undefined) lines.push(`      ${paint('expected:', DIM, colours)} ${d.expected}`);
  if (d.actual !== undefined) lines.push(`      ${paint('actual:  ', DIM, colours)} ${d.actual}`);
  return lines.join('\n');
}

export function formatDiagnostics(diagnostics: readonly Diagnostic[], colours = false): string {
  return diagnostics.map((d) => formatDiagnostic(d, colours)).join('\n\n');
}

/**
 * Root causes before their consequences. A bad `parts` range makes every in-file ToC look
 * wrong, so printing twenty E012s above the one E004 that caused them would send a reader
 * to fix the wrong files. Codes not listed here sort after the ones that are.
 */
const CAUSE_ORDER = ['E001', 'E002', 'E003', 'E004', 'E005', 'E016', 'E006', 'E018', 'E010', 'E017'];

function rank(code: string): number {
  const index = CAUSE_ORDER.indexOf(code);
  return index === -1 ? CAUSE_ORDER.length : index;
}

/** Errors first, root causes first within those, then by file and line. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (rank(a.code) !== rank(b.code)) return rank(a.code) - rank(b.code);
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}
