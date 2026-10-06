import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderHtmlReport, renderReport, renderReportTerminal, renderTerminalReport, reportKind } from '../src/lib/reporter.mjs';

const summary = { attempts: 1, successes: 1, passRate: 1, passRateInterval: [0.2, 1], meanAssertionScore: 1, medianDurationMs: 1000, medianCostUsd: null, medianDiffLines: 2, medianChangedFiles: 1, medianInputTokens: 0, medianOutputTokens: 0 };
const trial = { task: 'escape <this>', passed: true, durationMs: 1000, files: ['a.mjs'], diff: { total: 2 }, assertions: [{ pass: true, message: 'works' }], stderr: '', stdout: '' };
const comparison = { winner: 'candidate', reason: 'better', signal: 'anecdotal', minimumAttempts: 1, pValue: 1 };
const report = { version: '0.1.0', project: 'project <unsafe>', runId: 'run', commit: 'abcdef123456', experiment: { configDigest: 'abcdef1234567890' }, comparison, taskResults: [{ name: 'one', variants: [{ summary }, { summary }], comparison }, { name: 'two <unsafe>', variants: [{ summary }, { summary }], comparison }], variants: [{ name: 'baseline', summary, trials: [trial] }, { name: 'candidate', summary, trials: [trial] }] };

test('HTML report is standalone and escapes data', () => {
  const html = renderHtmlReport(report);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /project &lt;unsafe&gt;/);
  assert.equal(html.includes('https://'), false);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /Inspect diagnostics/);
  assert.match(html, /95% confidence interval/);
  assert.match(html, /Task breakdown/);
  assert.match(html, /two &lt;unsafe&gt;/);
  assert.match(html, /two-sided exact test/);
  assert.match(html, /<caption class="sr-only">/);
});

test('terminal report presents verdict and metrics', () => {
  const output = renderTerminalReport(report, { color: false });
  assert.match(output, /CANDIDATE/);
  assert.match(output, /Task success/);
  assert.match(output, /exact p=/);
});

test('HTML report supports task-specific refs without one shared commit', () => {
  const html = renderHtmlReport({ ...report, commit: null });
  assert.match(html, /multiple-refs/);
});

test('reports written by 0.2.0 still render, with their single agent on both arms', async () => {
  const legacy = JSON.parse(await readFile(new URL('./fixtures/report-v0.2.0.json', import.meta.url), 'utf8'));
  assert.equal(legacy.kind, undefined);
  assert.equal(reportKind(legacy), 'experiment');
  const html = renderReport(legacy);
  assert.match(html, /<tr><th>Agent<\/th><td class="">mock<\/td><td class="">mock<\/td><\/tr>/);
  assert.equal(html.includes('class="treatment"'), false, 'no treatment claim for a report that never recorded one');
  assert.match(renderReportTerminal(legacy, { color: false }), /VERDICT  WITH-INSTRUCTIONS/);
});

test('refuses unknown report kinds and newer schema versions with a clear message', () => {
  assert.throws(() => reportKind({ schemaVersion: 1, kind: 'leaderboard' }), /Unknown report kind "leaderboard"/);
  assert.throws(() => reportKind({ schemaVersion: 2, kind: 'ablation' }), /uses schemaVersion 2; ContextTest .* reads up to 1/);
  assert.throws(() => reportKind({ project: 'x' }), /not a ContextTest report/);
  assert.throws(() => renderReport(null), /not a ContextTest report/);
});
