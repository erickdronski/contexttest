import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSections, splitSections, withoutSection } from '../src/lib/sections.mjs';

const RULES = [
  '# Repository rules',
  'Read this first.',
  '',
  '## Testing',
  '- Run npm test.',
  '### Fixtures',
  '- Keep fixtures small.',
  '```md',
  '## Not a heading inside a fence',
  '```',
  '## Style ##',
  '- Two spaces.',
  '# Appendix',
  'Kept in every arm.',
  '## Releases',
  '- Tag from main.',
  '',
].join('\n');

test('splits at one heading level, keeps the preamble, and nests deeper headings', () => {
  const split = splitSections(RULES, 2);
  assert.deepEqual(split.sections.map(({ index, title, line, lines }) => ({ index, title, line, lines })), [
    { index: 1, title: 'Testing', line: 4, lines: 7 },
    { index: 2, title: 'Style', line: 11, lines: 2 },
    { index: 3, title: 'Releases', line: 15, lines: 2 },
  ]);
  assert.equal(split.preamble.lines, 3);
  assert.deepEqual(split.headingCounts, { 1: 2, 2: 3, 3: 1 }, 'fenced headings are not counted');
});

test('removing a section removes exactly its bytes and nothing else', () => {
  const split = splitSections(RULES, 2);
  const withoutTesting = withoutSection(split, 1);
  assert.equal(withoutTesting, RULES.replace(/## Testing[\s\S]*?```\n(?=## Style)/, ''));
  assert.equal(Buffer.byteLength(RULES) - Buffer.byteLength(withoutTesting), split.sections[0].bytes);
  assert.ok(withoutSection(split, 3).endsWith('Kept in every arm.\n'), 'the final newline survives removing the last section');
  assert.ok(withoutSection(split, 2).includes('# Appendix'), 'a higher-level heading ends a section but is never removed with it');
  const crlf = splitSections(RULES.replaceAll('\n', '\r\n'), 2);
  assert.equal(crlf.sections.length, 3);
  assert.equal(withoutSection(crlf, 2), withoutSection(split, 2).replaceAll('\n', '\r\n'));
  assert.equal(withoutSection(splitSections('## Only\nbody\n', 2), 1), '');
});

test('selects sections by title or number and refuses ambiguity', () => {
  const { sections } = splitSections(RULES, 2);
  assert.deepEqual(selectSections(sections, 'style, 3').map((section) => section.index), [2, 3]);
  assert.equal(selectSections(sections, undefined).length, 3);
  assert.throws(() => selectSections(sections, 'Security'), /No level-2 section matches "Security"\. Sections: 1\. Testing; 2\. Style; 3\. Releases\./);
  assert.throws(() => selectSections(sections, ' , '), /at least one section/);
  const duplicate = splitSections('## Notes\na\n## Notes\nb\n', 2).sections;
  assert.throws(() => selectSections(duplicate, 'Notes'), /ambiguous \(sections 1, 2\); select it by number/);
  assert.deepEqual(selectSections(duplicate, '2').map((section) => section.index), [2]);
  assert.throws(() => splitSections(RULES, 7), /from 1 to 6/);
});
