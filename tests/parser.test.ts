import { describe, expect, it } from 'vitest';

import { anchor, parseTopicHeadingText, topicIdFromAnchorFragment } from '../src/lib/contract/anchors.js';
import { parseLevelFile, slugifyHeading, splitSubsections } from '../src/lib/contract/levelfile.js';
import { parseOutline } from '../src/lib/contract/outline.js';
import { findWikilinks, findTopicReferences } from '../src/lib/contract/references.js';
import { findHeadings, plainProse, scanLines } from '../src/lib/contract/scan.js';
import { renderMarkdown } from '../src/lib/render.js';

/** Parser units. The gate is proven separately, against fixtures, in gate.test.ts. */

describe('anchors (§4)', () => {
  it.each([
    ['T7', 'Volatile Keyword', 't7-volatile-keyword'],
    ['T4.1', 'Fail Fast Iterators', 't4-1-fail-fast-iterators'],
    ['T12', 'Interface vs Abstract Class', 't12-interface-vs-abstract-class'],
    ['T3', 'B-Tree Index Structure', 't3-b-tree-index-structure'],
  ])('anchor(%s, %s) = %s', (id, name, expected) => {
    expect(anchor(id, name)).toBe(expected);
  });

  it('parses the topic heading grammar', () => {
    expect(parseTopicHeadingText('T7. Volatile Keyword')).toEqual({ id: 'T7', name: 'Volatile Keyword' });
    expect(parseTopicHeadingText('T4.1. Fail Fast Iterators')).toEqual({ id: 'T4.1', name: 'Fail Fast Iterators' });
    expect(parseTopicHeadingText('Table of Contents')).toBeNull();
    expect(parseTopicHeadingText('T4.1.2. Too Deep')).toBeNull();
  });

  it('resolves anchor fragments back to topic ids', () => {
    expect(topicIdFromAnchorFragment('#t7-volatile-keyword')).toBe('T7');
    expect(topicIdFromAnchorFragment('t4-1-fail-fast-iterators')).toBe('T4.1');
    expect(topicIdFromAnchorFragment('t12')).toBe('T12');
  });
});

describe('outline (§3)', () => {
  const source = `<!-- OUTLINE v1
T1. First Topic
T2. Second Topic
T2.1. Nested Topic
T3. Third Topic
-->

# Title`;

  it('builds a one-level tree in source order', () => {
    const outline = parseOutline(source, 'x.md');
    expect(outline?.diagnostics).toEqual([]);
    expect(outline?.version).toBe('v1');
    expect(outline?.nodes.map((n) => n.id)).toEqual(['T1', 'T2', 'T3']);
    expect(outline?.nodes[1]?.children.map((n) => n.id)).toEqual(['T2.1']);
    expect(outline?.flat.map((n) => n.id)).toEqual(['T1', 'T2', 'T2.1', 'T3']);
  });

  it('computes each node’s anchor from the contract algorithm', () => {
    const outline = parseOutline(source, 'x.md');
    expect(outline?.flat.map((n) => n.anchor)).toEqual([
      't1-first-topic',
      't2-second-topic',
      't2-1-nested-topic',
      't3-third-topic',
    ]);
  });

  it('rejects a nested topic with no parent (E018)', () => {
    const orphan = parseOutline('<!-- OUTLINE v1\nT1. First\nT3.1. Orphan\n-->', 'x.md');
    expect(orphan?.diagnostics.map((d) => d.code)).toEqual(['E018']);
    expect(orphan?.diagnostics[0]?.expected).toContain('T3');
  });

  it('returns null when there is no outline comment', () => {
    expect(parseOutline('# No outline here', 'x.md')).toBeNull();
  });
});

describe('scanning', () => {
  const source = ['# Title', '', '```bash', '## not a heading', '```', '', '## T1. Real Heading'].join('\n');

  it('ignores headings inside fenced code', () => {
    expect(findHeadings(scanLines(source)).map((h) => h.text)).toEqual(['Title', 'T1. Real Heading']);
  });

  it('drops code, links and headings from reference-detection prose', () => {
    const prose = plainProse('See `T9` and [T8](x.md) but not T4.\n\n```sql\nSELECT T7;\n```');
    expect(prose).toContain('T4');
    expect(prose).not.toContain('T9');
    expect(prose).not.toContain('T8');
    expect(prose).not.toContain('T7');
  });

  it('finds T-references and wikilinks only in real prose', () => {
    const markdown = 'Builds on T4 and T2.1, unlike `T9`.\n\nSee [[other-subject#t3]] and [[plain-subject]].';
    expect(findTopicReferences(markdown).sort()).toEqual(['T2.1', 'T4']);
    expect(findWikilinks(markdown)).toEqual([
      { raw: '[[other-subject#t3]]', slug: 'other-subject', fragment: 't3' },
      { raw: '[[plain-subject]]', slug: 'plain-subject', fragment: null },
    ]);
  });
});

describe('level file parsing (§§5–7, §9)', () => {
  const file = [
    '# Level Title',
    '',
    '[← Part 1](1_understand_part1.md) · [Part 3 →](1_understand_part3.md)',
    '',
    '## Table of Contents',
    '',
    '- [T1. First Topic](#t1-first-topic)',
    '',
    '## T1. First Topic',
    '',
    '<sub>Levels: [Foundation](0_foundation_part2.md#t1-first-topic) · Understand · [Interview](2_interview_part2.md#t1-first-topic) · [Production](3_production_part2.md#t1-first-topic)</sub>',
    '',
    'Body text that mentions ⚠️ verify inside a real sentence. Another sentence follows.',
    '',
    '### A Subsection',
    '',
    'More body.',
    '',
    '[← Part 1](1_understand_part1.md)',
    '',
    '<!-- CONTINUE: file=1_understand_part3.md next_topic=T2 -->',
  ].join('\n');

  const parsed = parseLevelFile(file, 'x/1_understand_part2.md', 1, 'part2');

  it('parses the title, ToC and topics', () => {
    expect(parsed.title).toBe('Level Title');
    expect(parsed.toc).toEqual([{ text: 'T1. First Topic', target: '#t1-first-topic', line: 7 }]);
    expect(parsed.topics.map((t) => t.id)).toEqual(['T1']);
  });

  it('strips the nav strip, the part links and the CONTINUE comment (§9)', () => {
    const body = parsed.topics[0]?.markdown ?? '';
    expect(body).not.toContain('<sub>Levels:');
    expect(body).not.toContain('_part1.md');
    expect(body).not.toContain('CONTINUE');
    expect(body).toContain('Body text that mentions');
  });

  it('collects H3 headings with contract-shaped anchors', () => {
    expect(parsed.topics[0]?.headings).toEqual([
      { depth: 3, text: 'A Subsection', anchor: 'a-subsection' },
    ]);
  });

  it('captures the verify marker with its whole sentence', () => {
    expect(parsed.topics[0]?.verifySentences).toEqual([
      'Body text that mentions ⚠️ verify inside a real sentence.',
    ]);
  });

  it('accepts a correct nav strip without complaint', () => {
    expect(parsed.diagnostics.filter((d) => d.code === 'E013')).toEqual([]);
  });

  it('splits level 2 subsections into named fields', () => {
    const subsections = splitSubsections('### Definition\n\nA thing.\n\n### Example\n\n```sql\nSELECT 1;\n```');
    expect(Object.keys(subsections)).toEqual(['Definition', 'Example']);
    expect(subsections['Example']).toContain('SELECT 1;');
  });

  it('slugifies H3 text the same way as topic anchors', () => {
    expect(slugifyHeading('Common Interview Questions')).toBe('common-interview-questions');
    expect(slugifyHeading('Why It Exists?')).toBe('why-it-exists');
  });
});

describe('render pipeline', () => {
  it('gives headings the contract’s anchors, not a generic slugifier’s', async () => {
    const html = await renderMarkdown('### Follow-up Questions\n\nText.');
    expect(html).toContain('id="follow-up-questions"');
  });

  it('renders tables, math and details', async () => {
    const html = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n$x^2$\n\n<details><summary>S</summary>D</details>');
    expect(html).toContain('<table>');
    expect(html).toContain('katex');
    expect(html).toContain('<details>');
  });

  it('hands mermaid to the client instead of to the highlighter', async () => {
    const html = await renderMarkdown('```mermaid\nflowchart TD\n  a --> b\n```');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('flowchart TD');
    expect(html).not.toContain('shiki');
  });

  it('highlights fenced code with a language', async () => {
    const html = await renderMarkdown('```sql\nSELECT 1;\n```');
    expect(html).toContain('shiki');
  });
});
