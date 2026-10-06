import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTreatmentDelivery, compareVariants, exactPairedPValue, holmAdjust, median, pairTrials, signalFor, summarizeTrials, totalInputTokens, wilsonInterval } from '../src/lib/stats.mjs';

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

test('evidence labels follow sample size, then the exact paired p-value', () => {
  assert.equal(signalFor(2, 0.001), 'anecdotal');
  assert.equal(signalFor(4, 0.001), 'early');
  assert.equal(signalFor(6, 0.2), 'directional');
  assert.equal(signalFor(6, 0.03), 'convincing');
  assert.equal(signalFor(8, 0.008), 'strong');
});

const side = (name, bytes, usages, provider = 'claude') => ({ name, bytes, provider, agent: 'shared', trials: usages.map((usage) => ({ usage })) });

test('flags the measured Claude Code pattern where AGENTS.md was never read', () => {
  // A real canary: ~500 bytes of instructions, three turns per run, and only
  // 25 more input tokens in total for the arm that supposedly carried them.
  const check = assessTreatmentDelivery({
    left: side('without', 0, [{ inputTokens: 12, cachedInputTokens: 51165, requests: 3 }]),
    right: side('with', 500, [{ inputTokens: 37, cachedInputTokens: 51165, requests: 3 }]),
  });
  assert.equal(check.status, 'doubtful');
  assert.equal(check.basis, 'request');
  assert.equal(check.expectedTokens, 125);
  assert.equal(check.observedTokens, 8.3);
  assert.equal(check.ratio, 0.067);
  assert.match(check.reason, /with sent only 8 more input tokens per request than without, but its instructions should add about 125/);
  assert.equal(totalInputTokens({ inputTokens: 12, cachedInputTokens: 51165 }, 'claude'), 51177);
  assert.equal(totalInputTokens({ inputTokens: 900, cachedInputTokens: 600 }, 'codex'), 900);
});

test('accepts usage that grows with the treatment and stays silent when it cannot tell', () => {
  const delivered = assessTreatmentDelivery({
    left: side('without', 0, [{ totalInputTokens: 51177, requests: 3 }, { totalInputTokens: 51180, requests: 3 }]),
    right: side('with', 500, [{ totalInputTokens: 51552, requests: 3 }, { totalInputTokens: 51560, requests: 3 }]),
  });
  assert.equal(delivered.status, 'consistent');
  const noisy = assessTreatmentDelivery({
    left: side('without', 0, [{ totalInputTokens: 30000, requests: 1 }, { totalInputTokens: 42000, requests: 1 }, { totalInputTokens: 51000, requests: 1 }]),
    right: side('with', 500, [{ totalInputTokens: 31000, requests: 1 }, { totalInputTokens: 42010, requests: 1 }, { totalInputTokens: 50000, requests: 1 }]),
  });
  assert.equal(noisy.status, 'unknown');
  assert.match(noisy.reason, /varies by about ±\d+ tokens between trials/);
  const codex = assessTreatmentDelivery({
    left: side('without', 0, [{ inputTokens: 20000 }], 'codex'),
    right: side('with', 2000, [{ inputTokens: 20020 }], 'codex'),
  });
  assert.equal(codex.basis, 'trial');
  assert.equal(codex.status, 'doubtful');
  assert.equal(assessTreatmentDelivery({ left: side('a', 0, [{}]), right: side('b', 500, [{}]) }).reason, 'The agent did not report token usage.');
  assert.match(assessTreatmentDelivery({ left: side('a', 100, [{ totalInputTokens: 1 }]), right: side('b', 140, [{ totalInputTokens: 1 }]) }).reason, /differ by 40 bytes/);
  assert.match(assessTreatmentDelivery({ left: { ...side('a', 0, []), agent: 'codex' }, right: side('b', 500, []) }).reason, /different agents/);
});

test('doubtful delivery downgrades even a strong-looking result', () => {
  const left = { attempts: 8, passRate: 0, meanAssertionScore: 0, medianDurationMs: 100 };
  const right = { attempts: 8, passRate: 1, meanAssertionScore: 1, medianDurationMs: 100 };
  const paired = { pairs: 8, leftWins: 0, rightWins: 8, bothPass: 0, bothFail: 0, discordant: 8, pValue: exactPairedPValue(0, 8) };
  assert.equal(compareVariants(left, right, paired).signal, 'strong');
  const doubtful = compareVariants(left, right, paired, { status: 'doubtful', reason: 'not read' });
  assert.equal(doubtful.signal, 'doubtful');
  assert.equal(doubtful.treatmentDelivery, 'doubtful');
  assert.equal(doubtful.statisticallySignificant, true, 'the arithmetic is unchanged; only the label is withheld');
  assert.equal(compareVariants(left, right, paired, { status: 'unknown', reason: 'no usage' }).signal, 'strong');
});

test('Holm adjustment controls chance findings across several sections', () => {
  assert.deepEqual(holmAdjust([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06]);
  assert.deepEqual(holmAdjust([0.25, 1, 1]), [0.75, 1, 1]);
  assert.deepEqual(holmAdjust([]), []);
});

test('comparisons record whether success, adherence, or duration decided them', () => {
  const base = { attempts: 6, passRate: 1, meanAssertionScore: 1, medianDurationMs: 100 };
  assert.equal(compareVariants(base, { ...base, passRate: 0.5 }).basis, 'success');
  assert.equal(compareVariants(base, { ...base, meanAssertionScore: 0.9 }).basis, 'adherence');
  assert.equal(compareVariants(base, { ...base, medianDurationMs: 50 }).basis, 'duration');
  assert.equal(compareVariants(base, base).basis, null);
});
