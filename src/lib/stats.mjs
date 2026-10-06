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

// Evidence labels depend only on sample size and the exact paired p-value.
export function signalFor(attempts, pValue) {
  if (attempts < 3) return 'anecdotal';
  if (attempts < 5) return 'early';
  if (pValue !== null && pValue <= 0.01) return 'strong';
  if (pValue !== null && pValue <= 0.05) return 'convincing';
  return 'directional';
}

// Holm's step-down adjustment: testing several sections at once must not
// manufacture a "convincing" result by chance. Returns p-values in input order.
export function holmAdjust(pValues) {
  const order = pValues.map((value, index) => ({ value: value ?? 1, index })).sort((a, b) => a.value - b.value);
  const adjusted = new Array(pValues.length);
  let running = 0;
  for (const [rank, { value, index }] of order.entries()) {
    running = Math.max(running, Math.min(1, (pValues.length - rank) * value));
    adjusted[index] = running;
  }
  return adjusted;
}

// Total prompt-side tokens one trial sent, including cache reads and writes.
// Claude Code reports cache tokens separately from input; Codex includes them.
export function totalInputTokens(usage = {}, provider) {
  if (Number.isFinite(usage.totalInputTokens)) return usage.totalInputTokens;
  const input = usage.inputTokens ?? 0;
  return provider === 'claude' ? input + (usage.cachedInputTokens ?? 0) : input;
}

const TOKENS_PER_BYTE = 1 / 4;
const SMALLEST_DETECTABLE_TOKENS = 25;
const DELIVERED_FRACTION = 0.25;
const rounded = (value, places = 1) => Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null;
const spreadOf = (items) => { const center = median(items); return center === null ? 0 : median(items.map((value) => Math.abs(value - center))); };

// A passive manipulation check. Instructions travel with every model request,
// so an arm with more instruction text should send more input tokens per
// request. When the observed difference is far below that, the agent probably
// never read the file and the comparison is between identical treatments.
// It can raise doubt; it cannot prove delivery.
export function assessTreatmentDelivery({ left, right }) {
  const unknown = (reason) => ({ status: 'unknown', reason });
  if (left.agent !== right.agent) return unknown('The arms use different agents, so their token usage is not comparable.');
  if (!Number.isFinite(left.bytes) || !Number.isFinite(right.bytes)) return unknown('Instruction sizes were not recorded.');
  const expected = (right.bytes - left.bytes) * TOKENS_PER_BYTE;
  if (Math.abs(expected) < SMALLEST_DETECTABLE_TOKENS) return unknown(`The instructions differ by ${Math.abs(right.bytes - left.bytes)} bytes, too little to see in token usage.`);
  const samples = (side) => side.trials.map((trial) => ({ total: totalInputTokens(trial.usage, side.provider), requests: trial.usage?.requests })).filter((sample) => sample.total > 0);
  const leftSamples = samples(left);
  const rightSamples = samples(right);
  if (!leftSamples.length || !rightSamples.length) return unknown('The agent did not report token usage.');
  const perRequest = [...leftSamples, ...rightSamples].every((sample) => sample.requests > 0);
  const value = (sample) => perRequest ? sample.total / sample.requests : sample.total;
  const leftValues = leftSamples.map(value);
  const rightValues = rightSamples.map(value);
  const observed = median(rightValues) - median(leftValues);
  const ratio = observed / expected;
  const spread = Math.max(spreadOf(leftValues), spreadOf(rightValues));
  const unit = perRequest ? 'per request' : 'per trial';
  const [heavier, lighter] = expected > 0 ? [right.name, left.name] : [left.name, right.name];
  const details = { basis: perRequest ? 'request' : 'trial', instructionBytes: [left.bytes, right.bytes], expectedTokens: rounded(Math.abs(expected)), observedTokens: rounded(observed * Math.sign(expected)), ratio: rounded(ratio, 3), spreadTokens: rounded(spread) };
  if (ratio >= DELIVERED_FRACTION) return { status: 'consistent', reason: `${heavier} sent about ${Math.round(observed * Math.sign(expected))} more input tokens ${unit} than ${lighter}; its instructions should add about ${Math.round(Math.abs(expected))}.`, ...details };
  if (spread > Math.abs(expected)) return { status: 'unknown', reason: `Input ${unit} varies by about ±${Math.round(spread)} tokens between trials, more than the ~${Math.round(Math.abs(expected))}-token treatment, so usage cannot confirm delivery.`, ...details };
  return { status: 'doubtful', reason: `${heavier} sent only ${Math.round(observed * Math.sign(expected))} more input tokens ${unit} than ${lighter}, but its instructions should add about ${Math.round(Math.abs(expected))}. The agent may never have read them.`, ...details };
}

export function compareVariants(left, right, paired = null, delivery = null) {
  const passDelta = right.passRate - left.passRate;
  const scoreDelta = (right.meanAssertionScore ?? 0) - (left.meanAssertionScore ?? 0);
  let winner = 'tie';
  let basis = null;
  let reason = 'The variants are effectively tied on the measured outcomes.';
  if (Math.abs(passDelta) >= 0.1) {
    winner = passDelta > 0 ? 'candidate' : 'baseline';
    basis = 'success';
    reason = `${Math.abs(passDelta * 100).toFixed(0)} percentage-point difference in task success.`;
  } else if (Math.abs(scoreDelta) >= 0.05) {
    winner = scoreDelta > 0 ? 'candidate' : 'baseline';
    basis = 'adherence';
    reason = `${Math.abs(scoreDelta * 100).toFixed(0)} percentage-point difference in assertion adherence.`;
  } else if (left.passRate === right.passRate && left.medianDurationMs && right.medianDurationMs) {
    const durationDelta = (right.medianDurationMs - left.medianDurationMs) / left.medianDurationMs;
    if (Math.abs(durationDelta) >= 0.15) {
      winner = durationDelta < 0 ? 'candidate' : 'baseline';
      basis = 'duration';
      reason = `${Math.abs(durationDelta * 100).toFixed(0)}% difference in median duration at equal success.`;
    }
  }
  const attempts = Math.min(left.attempts, right.attempts);
  const pValue = paired?.pValue ?? null;
  // A comparison whose treatment probably never reached the agent cannot earn
  // a confident label, whatever its p-value says.
  const signal = delivery?.status === 'doubtful' ? 'doubtful' : signalFor(attempts, pValue);
  const deliveryFields = delivery ? { treatmentDelivery: delivery.status, deliveryCheck: delivery } : {};
  return { winner, basis, reason, passRateDelta: passDelta, assertionScoreDelta: scoreDelta, signal, minimumAttempts: attempts, paired, pValue, statisticallySignificant: pValue !== null && pValue <= 0.05, ...deliveryFields };
}
