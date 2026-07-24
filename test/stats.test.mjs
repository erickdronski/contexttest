import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVariants, exactPairedPValue, median, pairTrials, summarizeTrials, wilsonInterval } from '../src/lib/stats.mjs';

test('median handles odd and even samples', () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 4, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('Wilson interval contains the observed pass rate', () => {
  const [lower, upper] = wilsonInterval(7, 10);
  assert.ok(lower < 0.7);
  assert.ok(upper > 0.7);
});

test('summarizes trial outcomes', () => {
  const summary = summarizeTrials([
    { passed: true, durationMs: 100, score: 1, diff: { total: 5 }, files: ['a'], usage: { inputTokens: 20, outputTokens: 5, costUsd: 0.1 } },
    { passed: false, durationMs: 300, score: 0.5, diff: { total: 15 }, files: ['a', 'b'], usage: { inputTokens: 40, outputTokens: 10, costUsd: 0.3 } },
  ]);
  assert.equal(summary.passRate, 0.5);
  assert.equal(summary.medianDurationMs, 200);
  assert.equal(summary.meanAssertionScore, 0.75);
});

test('candidate wins on a material pass-rate improvement', () => {
  const baseline = { attempts: 5, passRate: 0.2, meanAssertionScore: 0.5, medianDurationMs: 100 };
  const candidate = { attempts: 5, passRate: 0.8, meanAssertionScore: 0.9, medianDurationMs: 120 };
  const comparison = compareVariants(baseline, candidate);
  assert.equal(comparison.winner, 'candidate');
  assert.equal(comparison.signal, 'directional');
});

test('duration breaks an otherwise equal tie only when material', () => {
  const baseline = { attempts: 10, passRate: 1, meanAssertionScore: 1, medianDurationMs: 100 };
  const candidate = { attempts: 10, passRate: 1, meanAssertionScore: 1, medianDurationMs: 70 };
  assert.equal(compareVariants(baseline, candidate).winner, 'candidate');
});

test('computes a two-sided exact paired p-value', () => {
  assert.equal(exactPairedPValue(0, 6), 0.031250000000000014);
  assert.equal(exactPairedPValue(3, 3), 1);
  assert.equal(exactPairedPValue(0, 0), 1);
});

test('pairs outcomes by task and attempt instead of treating runs as independent', () => {
  const trials = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    trials.push({ task: 'task', attempt, variant: 'without', passed: false });
    trials.push({ task: 'task', attempt, variant: 'with', passed: true });
  }
  const paired = pairTrials(trials, 'without', 'with');
  assert.deepEqual({ pairs: paired.pairs, leftWins: paired.leftWins, rightWins: paired.rightWins, bothPass: paired.bothPass, bothFail: paired.bothFail }, { pairs: 6, leftWins: 0, rightWins: 6, bothPass: 0, bothFail: 0 });
  const comparison = compareVariants(
    { attempts: 6, passRate: 0, meanAssertionScore: 0, medianDurationMs: 100 },
    { attempts: 6, passRate: 1, meanAssertionScore: 1, medianDurationMs: 100 },
    paired,
  );
  assert.equal(comparison.statisticallySignificant, true);
  assert.equal(comparison.signal, 'convincing');
});
