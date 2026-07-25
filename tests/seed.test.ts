import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatDiagnostics } from '../src/lib/contract/diagnostics.js';
import { loadLibrary } from '../src/lib/contract/library.js';
import { LEVEL_IDS, NOTE_TOPIC_ID, flattenOutline } from '../src/lib/contract/types.js';

/** The real `content/` folder — the shape everything else is built against. */

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentDir = resolve(repoRoot, 'content');

describe('content/', () => {
  it('validates with zero errors', async () => {
    const { diagnostics } = await loadLibrary(contentDir, repoRoot);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    expect(formatDiagnostics(errors)).toBe('');
  });

  it('parses the seed subject at all four levels, parts stitched', async () => {
    const { subjects } = await loadLibrary(contentDir, repoRoot);
    const subject = subjects.find((s) => s.slug === 'database-indexing');
    expect(subject).toBeDefined();
    if (!subject) return;

    const ids = flattenOutline(subject.outline).map((t) => t.id);
    expect(ids).toContain('T4.1');
    expect(ids.length).toBe(subject.manifest.topic_count);

    for (const level of LEVEL_IDS) {
      expect([...(subject.levels.get(level)?.topics.keys() ?? [])], `level ${level}`).toEqual(ids);
    }
  });

  it('extracts the level 2 subsection vocabulary', async () => {
    const { subjects } = await loadLibrary(contentDir, repoRoot);
    const subject = subjects.find((s) => s.slug === 'database-indexing');
    const topic = subject?.levels.get(2)?.topics.get('T4.1');
    expect(Object.keys(topic?.subsections ?? {})).toContain('Interview Explanation');
    expect(Object.keys(topic?.subsections ?? {})).toContain('Common Interview Questions');
  });

  it('collects verify markers with subject, topic, level and sentence', async () => {
    const { subjects } = await loadLibrary(contentDir, repoRoot);
    const markers = subjects.flatMap((s) => s.verifyMarkers);
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      expect(marker.subject).not.toBe('');
      expect(marker.topicId).not.toBe('');
      expect(marker.sentence).toContain('verify');
    }
  });

  it('loads the loose note as a single-level subject', async () => {
    const { subjects } = await loadLibrary(contentDir, repoRoot);
    const note = subjects.find((s) => s.kind === 'note');
    expect(note).toBeDefined();
    expect(note?.outline).toEqual([]);
    expect([...(note?.levels.keys() ?? [])]).toEqual([0]);
    expect(note?.levels.get(0)?.topics.has(NOTE_TOPIC_ID)).toBe(true);
  });
});
