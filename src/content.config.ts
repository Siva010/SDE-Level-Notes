import { defineCollection } from 'astro:content';
import { libraryLoader } from './lib/loader.js';

/**
 * One collection, one loader. Adding a subject never touches this file — that is the
 * invariant the whole project exists for (CLAUDE.md).
 */
export const collections = {
  library: defineCollection({ loader: libraryLoader() }),
};
