import rehypeShiki from '@shikijs/rehype';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';
import type { Element, Root } from 'hast';

import { slugifyHeading } from './contract/levelfile.js';

/**
 * Markdown → HTML, once, at build time. Never call this from a component.
 *
 * Heading ids come from the contract's anchor algorithm, not from a generic slugifier,
 * because the generator writes anchors into links before the site exists (§4).
 */

/** Assign heading ids with the contract's slug rules, deduped within one topic body. */
function rehypeContractSlugs() {
  return (tree: Root): void => {
    const used = new Map<string, number>();
    visit(tree, 'element', (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      if (typeof node.properties['id'] === 'string') return;
      const base = slugifyHeading(toString(node));
      if (base === '') return;
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      node.properties['id'] = seen === 0 ? base : `${base}-${seen + 1}`;
    });
  };
}

/**
 * Mermaid blocks are handed to the client as `<pre class="mermaid">`, never to Shiki.
 * Keeping the source in the DOM is also the W003 fallback: a diagram that fails to parse
 * shows its source rather than blanking the page.
 */
function rehypeMermaid() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'pre') return;
      const [child] = node.children;
      if (!child || child.type !== 'element' || child.tagName !== 'code') return;
      const className = child.properties['className'];
      const classes = Array.isArray(className) ? className.map(String) : [];
      if (!classes.includes('language-mermaid')) return;
      node.properties['className'] = ['mermaid'];
      node.children = [{ type: 'text', value: toString(child) }];
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeMermaid)
  .use(rehypeContractSlugs)
  .use(rehypeKatex)
  .use(rehypeShiki, {
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    fallbackLanguage: 'text',
  })
  .use(rehypeStringify, { allowDangerousHtml: true });

export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}
