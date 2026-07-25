import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { topicIdFromAnchorFragment } from './anchors.js';
import { error } from './diagnostics.js';
import { loadNoteFile } from './note.js';
import { loadSubjectFolder } from './subject.js';
import type { WikilinkRef } from './references.js';
import { flattenOutline, type Diagnostic, type Subject } from './types.js';

/**
 * The whole of `content/`, parsed once. Cross-subject references (wikilinks, prereqs) can
 * only be resolved here, because they need every slug to be known first.
 */

export interface Library {
  subjects: Subject[];
  diagnostics: Diagnostic[];
}

export async function loadLibrary(contentDir: string, repoRoot: string): Promise<Library> {
  const subjects: Subject[] = [];
  const diagnostics: Diagnostic[] = [];
  const wikilinks: WikilinkRef[] = [];

  let categories: string[] = [];
  try {
    categories = (await readdir(contentDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return { subjects, diagnostics };
  }

  for (const category of categories) {
    const categoryDir = join(contentDir, category);
    const entries = (await readdir(categoryDir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(categoryDir, entry.name);

      if (entry.isDirectory()) {
        const result = await loadSubjectFolder(path, repoRoot);
        diagnostics.push(...result.diagnostics);
        wikilinks.push(...result.wikilinks);
        if (result.subject) subjects.push(result.subject);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.md')) {
        const result = await loadNoteFile(path, repoRoot);
        diagnostics.push(...result.diagnostics);
        wikilinks.push(...result.wikilinks);
        if (result.subject) subjects.push(result.subject);
      }
    }
  }

  diagnostics.push(...checkCrossReferences(subjects, wikilinks));
  return { subjects, diagnostics };
}

/** E015 — every `[[wikilink]]` and every `prereqs` entry must resolve. */
export function checkCrossReferences(
  subjects: readonly Subject[],
  wikilinks: readonly WikilinkRef[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const bySlug = new Map(subjects.map((s) => [s.slug, s]));

  for (const subject of subjects) {
    for (const prereq of subject.manifest.prereqs) {
      if (bySlug.has(prereq)) continue;
      out.push(
        error(
          'E015',
          subject.kind === 'note' ? subject.path : `${subject.path}/manifest.yml`,
          'prereqs entry does not resolve to a subject.',
          {
            expected: `one of: ${[...bySlug.keys()].join(', ') || '(no subjects)'}`,
            actual: prereq,
          },
        ),
      );
    }
  }

  for (const link of wikilinks) {
    const target = bySlug.get(link.slug);
    if (!target) {
      out.push(
        error('E015', link.file, 'Wikilink target subject does not exist.', {
          topicId: link.topicId,
          expected: `one of: ${[...bySlug.keys()].join(', ') || '(no subjects)'}`,
          actual: link.raw,
        }),
      );
      continue;
    }
    if (link.fragment === null) continue;

    const topics = flattenOutline(target.outline);
    const fragment = link.fragment.replace(/^#/, '').toLowerCase();
    const byAnchor = topics.find((t) => t.anchor === fragment);
    if (byAnchor) continue;
    const id = topicIdFromAnchorFragment(fragment);
    if (id && topics.some((t) => t.id === id)) continue;

    out.push(
      error('E015', link.file, 'Wikilink fragment does not resolve to a topic.', {
        topicId: link.topicId,
        expected: `a topic in ${target.slug}: ${topics.map((t) => t.id.toLowerCase()).join(', ') || '(none)'}`,
        actual: link.raw,
      }),
    );
  }

  return out;
}

/** True when `path` is a folder. Used by the validate script for single-folder runs. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
