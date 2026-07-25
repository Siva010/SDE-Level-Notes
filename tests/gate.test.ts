import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatDiagnostic } from '../src/lib/contract/diagnostics.js';
import { loadLibrary } from '../src/lib/contract/library.js';
import type { Diagnostic } from '../src/lib/contract/types.js';

/**
 * The validation gate, proven against committed fixtures — CONTENT-CONTRACT.md §12.
 *
 * Every case asserts three things: the right code fires, the message names the file (and the
 * topic where one is implicated), and expected-vs-actual is filled in. A code that fires with
 * an unreadable message is a failure here, which is the point of fixtures over unit stubs.
 */

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturesRoot = join(repoRoot, 'tests', 'fixtures');

async function load(dir: string): Promise<Diagnostic[]> {
  const { diagnostics } = await loadLibrary(dir, repoRoot);
  return diagnostics;
}

const errorsOf = (diagnostics: readonly Diagnostic[]) => diagnostics.filter((d) => d.severity === 'error');
const codes = (diagnostics: readonly Diagnostic[]) => [...new Set(diagnostics.map((d) => d.code))];

interface Case {
  fixture: string;
  code: string;
  /** The code names a specific topic, so the diagnostic must carry its id. */
  topicScoped?: boolean;
  /** A substring the message or expected/actual must contain, proving it is specific. */
  mentions?: string;
}

const CASES: Case[] = [
  { fixture: 'E001-missing-manifest-key', code: 'E001', mentions: 'summary' },
  { fixture: 'E002-slug-mismatch', code: 'E002', mentions: 'some-other-slug' },
  { fixture: 'E003-missing-part-file', code: 'E003', mentions: '1_understand_part2.md' },
  { fixture: 'E004-parts-gap', code: 'E004', mentions: 'T3' },
  { fixture: 'E005-missing-outline', code: 'E005', mentions: 'OUTLINE' },
  { fixture: 'E006-unsafe-topic-name', code: 'E006', topicScoped: true, mentions: '(' },
  { fixture: 'E007-out-of-outline-order', code: 'E007', topicScoped: true, mentions: 'T2' },
  { fixture: 'E008-heading-drift', code: 'E008', topicScoped: true, mentions: 'Beta Concepts' },
  { fixture: 'E009-topic-absent-from-level-0', code: 'E009', topicScoped: true, mentions: 'T9' },
  { fixture: 'E010-duplicate-topic-id', code: 'E010', topicScoped: true, mentions: 'T2' },
  { fixture: 'E011-stray-h2', code: 'E011', mentions: 'Some Other Section' },
  { fixture: 'E012-toc-mismatch', code: 'E012', topicScoped: true, mentions: 'Beta Concepts' },
  { fixture: 'E013-nav-anchor-drift', code: 'E013', topicScoped: true, mentions: 't1-alpha' },
  { fixture: 'E014-unknown-t-reference', code: 'E014', topicScoped: true, mentions: 'T7' },
  { fixture: 'E015-broken-wikilink', code: 'E015', mentions: 'no-such-subject' },
  { fixture: 'E015-broken-prereq', code: 'E015', mentions: 'no-such-subject' },
  { fixture: 'E016-topic-count-mismatch', code: 'E016', mentions: '99' },
  { fixture: 'E017-frontmatter-in-level-file', code: 'E017', mentions: '1_understand.md' },
  { fixture: 'E018-over-nested-topic', code: 'E018', topicScoped: true, mentions: 'T2.1.1' },
];

describe('valid fixtures', () => {
  it('load with no errors at all', async () => {
    const diagnostics = await load(join(fixturesRoot, 'valid'));
    expect(formatAll(errorsOf(diagnostics))).toBe('');
  });

  it('stitch a split subject into one continuous level, in parts order', async () => {
    const { subjects } = await loadLibrary(join(fixturesRoot, 'valid'), repoRoot);
    const split = subjects.find((s) => s.slug === 'valid-split');
    expect(split).toBeDefined();
    for (const level of [0, 1, 2, 3] as const) {
      expect([...(split?.levels.get(level)?.topics.keys() ?? [])]).toEqual(['T1', 'T2', 'T3', 'T4']);
    }
  });

  it('leave no part navigation in the stitched bodies', async () => {
    const { subjects } = await loadLibrary(join(fixturesRoot, 'valid'), repoRoot);
    const split = subjects.find((s) => s.slug === 'valid-split');
    for (const level of split?.levels.values() ?? []) {
      for (const body of level.topics.values()) {
        expect(body.markdown).not.toMatch(/_part\d\.md/);
        expect(body.markdown).not.toMatch(/<sub>Levels:/);
        expect(body.markdown).not.toMatch(/Table of Contents/);
      }
    }
  });
});

describe.each(CASES)('$fixture', ({ fixture, code, topicScoped, mentions }) => {
  it(`reports ${code} with a legible message`, async () => {
    const diagnostics = await load(join(fixturesRoot, 'broken', fixture));
    const hits = diagnostics.filter((d) => d.code === code);

    expect(hits.length, `expected ${code}, got: ${codes(diagnostics).join(', ') || 'nothing'}`).toBeGreaterThan(0);

    const legible = hits.filter((d) => {
      if (d.file === '') return false;
      if (topicScoped && !d.topicId) return false;
      if (d.expected === undefined || d.actual === undefined) return false;
      if (mentions === undefined) return true;
      return `${d.message} ${d.expected} ${d.actual} ${d.file}`.includes(mentions);
    });

    expect(
      legible.length,
      `no ${code} diagnostic was legible enough. Got:\n${formatAll(hits)}`,
    ).toBeGreaterThan(0);
  });
});

describe('warnings fixture', () => {
  it('reports every warning and fails nothing', async () => {
    const diagnostics = await load(join(fixturesRoot, 'broken', 'W-warnings-only'));
    expect(formatAll(errorsOf(diagnostics))).toBe('');
    for (const code of ['W001', 'W002', 'W003', 'W005', 'W007', 'W008']) {
      expect(codes(diagnostics), `missing ${code}`).toContain(code);
    }
  });
});

describe('fixture coverage', () => {
  it('has a fixture for every error code in the contract', async () => {
    const covered = new Set(CASES.map((c) => c.code));
    const expected = Array.from({ length: 18 }, (_, i) => `E${String(i + 1).padStart(3, '0')}`);
    expect([...expected].filter((code) => !covered.has(code))).toEqual([]);
  });

  it('has no fixture folder that the test table forgot', async () => {
    const folders = (await readdir(join(fixturesRoot, 'broken'), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.startsWith('W-'));
    expect(folders.filter((name) => !CASES.some((c) => c.fixture === name))).toEqual([]);
  });
});

function formatAll(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => formatDiagnostic(d)).join('\n\n');
}
