import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  markdown: {
    // Content is parsed and rendered by src/lib/render.ts, not by Astro's pipeline.
    syntaxHighlight: false,
  },
});
