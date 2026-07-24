import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtmlReport } from '../src/lib/reporter.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(target);
    return entry.name.endsWith('.md') ? [target] : [];
  }));
  return files.flat();
}

test('public documentation has no broken relative Markdown links', async () => {
  const files = [
    path.join(repository, 'README.md'),
    ...(await markdownFiles(path.join(repository, 'docs'))),
    path.join(repository, 'examples/calculator/README.md'),
  ];
  const failures = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].trim().replace(/^<|>$/g, '').split(/\s+['"]/)[0];
      if (!href || href.startsWith('#') || /^[a-z][a-z+.-]*:/i.test(href)) continue;
      const target = path.resolve(path.dirname(file), decodeURIComponent(href.split('#')[0]));
      try { await access(target); }
      catch { failures.push(`${path.relative(repository, file)} -> ${href}`); }
    }
  }
  assert.deepEqual(failures, []);
});

test('committed demonstration report is portable and regenerates byte for byte', async () => {
  const output = path.join(repository, 'examples/calculator/output');
  const json = await readFile(path.join(output, 'report.json'), 'utf8');
  const report = JSON.parse(json);
  const html = await readFile(path.join(output, 'report.html'), 'utf8');
  assert.equal(report.agent.provider, 'mock');
  assert.equal(report.comparison.winner, 'candidate');
  assert.equal(report.comparison.paired.pairs, 3);
  assert.equal(report.variants[0].summary.passRate, 0);
  assert.equal(report.variants[1].summary.passRate, 1);
  assert.equal(json.includes('.contexttest/worktrees'), false);
  assert.equal(json.includes('/Users/'), false);
  assert.equal(html, renderHtmlReport(report));
});
