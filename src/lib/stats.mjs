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

function logCombination(total, selected) {
  const count = Math.min(selected, total - selected);
  let value = 0;
  for (let index = 1; index <= count; index += 1) value += Math.log(total - count + index) - Math.log(index);
  return value;
}

export function exactPairedPValue(leftWins, rightWins) {
  const discordant = leftWins + rightWins;
  if (!discordant) return 1;
  const tail = Math.min(leftWins, rightWins);
  let cumulative = 0;
  for (let successes = 0; successes <= tail; successes += 1) cumulative += Math.exp(logCombination(discordant, successes) - discordant * Math.log(2));
  return Math.min(1, 2 * cumulative);
}

export function pairTrials(trials, leftName, rightName) {
  const pairs = new Map();
  for (const trial of trials) {
    const key = `${trial.task}\u0000${trial.attempt}`;
    const pair = pairs.get(key) ?? { task: trial.task, attempt: trial.attempt };
    if (trial.variant === leftName) pair.left = trial;
    if (trial.variant === rightName) pair.right = trial;
    pairs.set(key, pair);
  }
  const complete = [...pairs.values()].filter((pair) => pair.left && pair.right);
  const leftWins = complete.filter((pair) => pair.left.passed && !pair.right.passed).length;
  const rightWins = complete.filter((pair) => !pair.left.passed && pair.right.passed).length;
  const bothPass = complete.filter((pair) => pair.left.passed && pair.right.passed).length;
  const bothFail = complete.filter((pair) => !pair.left.passed && !pair.right.passed).length;
  return { pairs: complete.length, leftWins, rightWins, bothPass, bothFail, discordant: leftWins + rightWins, pValue: exactPairedPValue(leftWins, rightWins) };
}

export function compareVariants(left, right, paired = null) {
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
  const pValue = paired?.pValue ?? null;
  const signal = attempts < 3 ? 'anecdotal' : attempts < 5 ? 'early' : pValue !== null && pValue <= 0.01 ? 'strong' : pValue !== null && pValue <= 0.05 ? 'convincing' : 'directional';
  return { winner, reason, passRateDelta: passDelta, assertionScoreDelta: scoreDelta, signal, minimumAttempts: attempts, paired, pValue, statisticallySignificant: pValue !== null && pValue <= 0.05 };
}
