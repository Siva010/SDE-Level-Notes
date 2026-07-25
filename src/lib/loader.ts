import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Loader } from 'astro/loaders';

import { formatDiagnostics, sortDiagnostics } from './contract/diagnostics.js';
import { loadLibrary } from './contract/library.js';
import { hasErrors, type Subject } from './contract/types.js';
import { renderMarkdown } from './render.js';
import { toStored } from './serialize.js';

/**
 * The custom folder loader — the unit of content is a directory with `manifest.yml`, not a
 * file with frontmatter. Adding a subject is dropping a folder into `content/`; nothing
 * here or anywhere else needs a second edit.
 *
 * A subject that fails validation is never rendered and never silently skipped: the load
 * throws, which fails the build.
 */
export function libraryLoader(options: { contentDir?: string } = {}): Loader {
  return {
    name: 'four-level-library',
    async load({ store, logger, watcher, config }) {
      const repoRoot = fileURLToPath(config.root);
      const contentDir = options.contentDir ?? join(repoRoot, 'content');

      const { subjects, diagnostics } = await loadLibrary(contentDir, repoRoot);
      const sorted = sortDiagnostics(diagnostics);

      for (const diagnostic of sorted) {
        if (diagnostic.severity === 'warning') logger.warn(`\n${formatDiagnostics([diagnostic])}\n`);
      }

      if (hasErrors(sorted)) {
        const errors = sorted.filter((d) => d.severity === 'error');
        throw new Error(
          `content validation failed — ${errors.length} error${errors.length === 1 ? '' : 's'}.\n\n` +
            `${formatDiagnostics(errors)}\n\n` +
            'Run `npm run validate` for the full report. Nothing is rendered until this is green.',
        );
      }

      store.clear();
      for (const subject of subjects) {
        await renderSubject(subject);
        store.set({ id: `${subject.category}/${subject.slug}`, data: toStored(subject) as never });
      }

      logger.info(
        `${subjects.length} subject${subjects.length === 1 ? '' : 's'} loaded, ` +
          `${sorted.filter((d) => d.severity === 'warning').length} warning(s)`,
      );

      watcher?.add(contentDir);
    },
  };
}

/** Fill in every `TopicBody.html`. Parse once, here — never in a component. */
async function renderSubject(subject: Subject): Promise<void> {
  for (const level of subject.levels.values()) {
    for (const body of level.topics.values()) {
      body.html = await renderMarkdown(body.markdown);
    }
  }
}
