function values(items, selector) { return items.map(selector).filter(Number.isFinite).sort((a, b) => a - b); }
export function median(items) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function mean(items) { return items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null; }
export function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return [0, 0];
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function summarizeTrials(trials) {
  const successes = trials.filter((trial) => trial.passed).length;
  const durations = values(trials, (trial) => trial.durationMs);
  const costs = values(trials, (trial) => trial.usage?.costUsd);
  const diffLines = values(trials, (trial) => trial.diff?.total);
  const files = values(trials, (trial) => trial.files?.length);
  const scores = values(trials, (trial) => trial.score);
  const inputTokens = values(trials, (trial) => trial.usage?.inputTokens);
  const outputTokens = values(trials, (trial) => trial.usage?.outputTokens);
  return {
    attempts: trials.length,
    successes,
    passRate: trials.length ? successes / trials.length : 0,
    passRateInterval: wilsonInterval(successes, trials.length),
    medianDurationMs: median(durations),
    medianCostUsd: median(costs),
    medianDiffLines: median(diffLines),
    medianChangedFiles: median(files),
    meanAssertionScore: mean(scores),
    medianInputTokens: median(inputTokens),
    medianOutputTokens: median(outputTokens),
  };
}

export function compareVariants(left, right) {
  const passDelta = right.passRate - left.passRate;
  const scoreDelta = (right.meanAssertionScore ?? 0) - (left.meanAssertionScore ?? 0);
  let winner = 'tie';
  let reason = 'The variants are effectively tied on the measured outcomes.';
  if (Math.abs(passDelta) >= 0.1) {
    winner = passDelta > 0 ? 'candidate' : 'baseline';
    reason = `${Math.abs(passDelta * 100).toFixed(0)} percentage-point difference in task success.`;
  } else if (Math.abs(scoreDelta) >= 0.05) {
    winner = scoreDelta > 0 ? 'candidate' : 'baseline';
    reason = `${Math.abs(scoreDelta * 100).toFixed(0)} percentage-point difference in assertion adherence.`;
  } else if (left.passRate === right.passRate && left.medianDurationMs && right.medianDurationMs) {
    const durationDelta = (right.medianDurationMs - left.medianDurationMs) / left.medianDurationMs;
    if (Math.abs(durationDelta) >= 0.15) {
      winner = durationDelta < 0 ? 'candidate' : 'baseline';
      reason = `${Math.abs(durationDelta * 100).toFixed(0)}% difference in median duration at equal success.`;
    }
  }
  const attempts = Math.min(left.attempts, right.attempts);
  const signal = attempts < 3 ? 'anecdotal' : attempts < 5 ? 'early' : attempts < 10 ? 'directional' : 'stronger';
  return { winner, reason, passRateDelta: passDelta, assertionScoreDelta: scoreDelta, signal, minimumAttempts: attempts };
}
