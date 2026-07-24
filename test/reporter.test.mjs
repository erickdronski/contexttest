import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHtmlReport, renderTerminalReport } from '../src/lib/reporter.mjs';

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
