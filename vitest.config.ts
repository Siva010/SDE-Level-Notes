import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Shiki loads its grammars and themes on first render; that one call can take seconds.
    testTimeout: 30_000,
  },
});
