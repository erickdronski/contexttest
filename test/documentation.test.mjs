import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtmlReport, renderReport } from '../src/lib/reporter.mjs';

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
    ...(await markdownFiles(path.join(repository, 'examples'))).filter((file) => path.basename(file) === 'README.md'),
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

test('committed ablation report finds the one section that matters and regenerates byte for byte', async () => {
  const output = path.join(repository, 'examples/ablation/output');
  const json = await readFile(path.join(output, 'report.json'), 'utf8');
  const report = JSON.parse(json);
  const html = await readFile(path.join(output, 'report.html'), 'utf8');
  assert.equal(report.kind, 'ablation');
  assert.equal(report.agent.provider, 'mock');
  assert.deepEqual(report.arms.map((arm) => [arm.name, arm.trials.length]), [['full', 3], ['without-1', 3], ['without-2', 3], ['without-3', 3]]);
  assert.deepEqual(report.effects.map((effect) => [effect.section.title, effect.reading]), [['Formatting', 'no clear effect'], ['Public API', 'helps'], ['Pull requests', 'no clear effect']]);
  assert.equal(report.effects[1].deltas.passRate, 1);
  assert.equal(report.effects[1].signal, 'early');
  assert.ok(report.effects.every((effect) => effect.deltas.medianDurationMs === 0), 'normalized timing shows no invented duration effect');
  assert.equal(report.experiment.plannedTrials, 12);
  assert.equal(json.includes('.contexttest/worktrees'), false);
  assert.equal(json.includes('/Users/'), false);
  assert.equal(html, renderReport(report));
});

test('committed aggregate pools two calculator runs into convincing evidence without hiding either run', async () => {
  const report = JSON.parse(await readFile(path.join(repository, 'examples/aggregate/output/report.json'), 'utf8'));
  assert.equal(report.kind, 'aggregate');
  assert.deepEqual(report.sources.map((source) => [source.runId, source.report, source.comparison.signal]), [
    ['calculator-demo-run-1', 'examples/aggregate/runs/first/report.json', 'early'],
    ['calculator-demo-run-2', 'examples/aggregate/runs/second/report.json', 'early'],
  ]);
  assert.equal(report.comparison.paired.pairs, 6);
  assert.equal(report.comparison.signal, 'convincing');
  assert.equal(report.heterogeneity.disagreement, false);
  assert.deepEqual(report.warnings, []);
  for (const source of report.sources) {
    const original = JSON.parse(await readFile(path.join(repository, source.report), 'utf8'));
    assert.equal(original.runId, source.runId, 'each source report is committed beside the aggregate');
  }
});

test('every committed example report is portable and its HTML regenerates byte for byte', async () => {
  const reports = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.name === 'report.json') reports.push(target);
    }
  };
  await walk(path.join(repository, 'examples'));
  assert.equal(reports.length, 5);
  for (const file of reports) {
    const json = await readFile(file, 'utf8');
    assert.equal(json.includes('/Users/') || json.includes('.contexttest/worktrees'), false, `${file} is not portable`);
    assert.equal(await readFile(path.join(path.dirname(file), 'report.html'), 'utf8'), renderReport(JSON.parse(json)), `${file} does not regenerate`);
  }
});
