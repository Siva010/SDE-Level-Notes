#!/usr/bin/env tsx
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatDiagnostics, sortDiagnostics } from '../src/lib/contract/diagnostics.js';
import { loadLibrary } from '../src/lib/contract/library.js';

/**
 * `npm run validate` — the CONTENT-CONTRACT gate over content/, pass/fail per check.
 * `npm run validate -- content/<category>/<slug>` scopes the report to one folder, but
 * still loads the whole library, because wikilinks and prereqs resolve across subjects.
 */

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentDir = resolve(repoRoot, 'content');

interface Check {
  name: string;
  codes: string[];
}

const CHECKS: Check[] = [
  { name: 'manifest schema and folder agreement', codes: ['E001', 'E002', 'E016', 'W007'] },
  { name: 'level files and part coverage', codes: ['E003', 'E004'] },
  { name: 'outline comment, ids, nesting', codes: ['E005', 'E006', 'E010', 'E018'] },
  { name: 'topic set and outline order', codes: ['E007', 'E009', 'W005'] },
  { name: 'headings and anchors', codes: ['E008', 'E011'] },
  { name: 'in-file table of contents', codes: ['E012'] },
  { name: 'cross-level nav strips', codes: ['E013'] },
  { name: 'T-references, wikilinks, prereqs', codes: ['E014', 'E015'] },
  { name: 'no frontmatter in level files', codes: ['E017'] },
  { name: 'level 2 subsection vocabulary', codes: ['W001', 'W008'] },
  { name: 'code fence languages', codes: ['W002'] },
  { name: 'mermaid blocks', codes: ['W003'] },
  { name: 'level 3 depth', codes: ['W004'] },
  { name: 'verify markers', codes: ['W006'] },
];

const PASS = '\u001B[32m✓\u001B[0m';
const FAIL = '\u001B[31m✗\u001B[0m';
const WARN = '\u001B[33m!\u001B[0m';

async function main(): Promise<number> {
  const scopeArg = process.argv[2];
  const scope = scopeArg ? relative(repoRoot, resolve(process.cwd(), scopeArg)).split('\\').join('/') : null;

  const { subjects, diagnostics } = await loadLibrary(contentDir, repoRoot);

  const scoped = scope ? diagnostics.filter((d) => d.file === scope || d.file.startsWith(`${scope}/`)) : diagnostics;
  const inScope = scope ? subjects.filter((s) => s.path === scope || s.path.startsWith(`${scope}/`)) : subjects;

  if (scope && inScope.length === 0 && scoped.length === 0) {
    console.error(`No content found at ${scope}`);
    return 1;
  }

  console.log(`\ncontent gate — ${scope ?? 'content/'}`);
  console.log(`${inScope.length} item(s) parsed\n`);

  const errors = scoped.filter((d) => d.severity === 'error');
  const warnings = scoped.filter((d) => d.severity === 'warning');

  for (const check of CHECKS) {
    const hits = scoped.filter((d) => check.codes.includes(d.code));
    const checkErrors = hits.filter((d) => d.severity === 'error');
    const mark = checkErrors.length > 0 ? FAIL : hits.length > 0 ? WARN : PASS;
    const detail =
      checkErrors.length > 0
        ? `${checkErrors.length} error(s)`
        : hits.length > 0
          ? `${hits.length} warning(s)`
          : '';
    console.log(`  ${mark} ${check.name.padEnd(38)} ${check.codes.join(' ').padEnd(22)} ${detail}`);
  }

  if (errors.length > 0) {
    console.log(`\n${'─'.repeat(72)}\nERRORS\n`);
    console.log(formatDiagnostics(sortDiagnostics(errors), true));
  }
  if (warnings.length > 0) {
    console.log(`\n${'─'.repeat(72)}\nWARNINGS\n`);
    console.log(formatDiagnostics(sortDiagnostics(warnings), true));
  }

  console.log(
    `\n${errors.length === 0 ? 'PASS' : 'FAIL'} — ${errors.length} error(s), ${warnings.length} warning(s)\n`,
  );

  return errors.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (cause: unknown) => {
    console.error(cause);
    process.exit(1);
  },
);
