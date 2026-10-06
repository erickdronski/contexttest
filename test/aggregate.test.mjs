import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { aggregateReports, loadReports, writeAggregate } from '../src/lib/aggregate.mjs';
import { renderAggregateHtml, renderAggregateTerminal, renderReport } from '../src/lib/reporter.mjs';

// A minimal experiment report: aggregation recomputes every number from the
// trials, so only the evidence and the identity fields matter.
function report({ runId, outcomes, names = ['without', 'with'], tasks = ['task'], version = '0.3.0', configDigest = 'config-a', model = null, instructionDigest = 'rules-a', taskRef = 'abc', warnings = [] }) {
  const trials = (variant, index) => outcomes.map((pair, attempt) => ({ task: tasks[attempt % tasks.length], variant, attempt: Math.floor(attempt / tasks.length) + 1, passed: pair[index] === 1, score: pair[index], durationMs: 100, files: ['a.txt'], diff: { additions: 1, deletions: 0, total: 1 }, usage: {}, stdout: 'diagnostic', stderr: '' }));
  const agent = { provider: 'mock', model, isolate: false, digest: `agent-${model ?? 'default'}` };
  return {
    schemaVersion: 1, kind: 'experiment', version, runId, generatedAt: '2026-10-01T00:00:00.000Z', project: 'pool', commit: taskRef,
    taskRefs: Object.fromEntries(tasks.map((task) => [task, taskRef])), instructionFile: 'AGENTS.md', agent: { provider: 'mock', model, isolate: false },
    experiment: { configDigest }, tasks,
    variants: names.map((name, index) => ({ name, agent, instructions: { mode: index ? 'source' : 'disabled', bytes: index ? 400 : 0, digest: index ? instructionDigest : null }, trials: trials(name, index) })),
    treatment: { differs: ['instructions'], agentSettings: [], summary: 'Only the instructions differ; both arms use mock.' },
    warnings,
  };
}
const source = (value) => ({ path: `${value.runId}/report.json`, report: value });

test('pools paired evidence across runs without pairing trials from different runs', () => {
  const pooled = aggregateReports([
    source(report({ runId: 'run-a', outcomes: [[0, 1], [0, 1], [0, 1]] })),
    source(report({ runId: 'run-b', outcomes: [[0, 1], [0, 1], [0, 1]] })),
  ]);
  assert.equal(pooled.kind, 'aggregate');
  assert.equal(pooled.schemaVersion, 1);
  assert.deepEqual([pooled.comparison.paired.pairs, pooled.comparison.paired.rightWins], [6, 6]);
  assert.ok(Math.abs(pooled.comparison.pValue - 1 / 32) < 1e-12, 'exact two-sided p for 6 of 6 discordant pairs');
  assert.equal(pooled.comparison.signal, 'convincing');
  assert.deepEqual(pooled.sources.map((entry) => entry.comparison.signal), ['early', 'early']);
  assert.deepEqual(pooled.variants[1].trials.map((trial) => [trial.source, trial.sourceAttempt, trial.attempt]), [['run-a', 1, 1], ['run-a', 2, 2], ['run-a', 3, 3], ['run-b', 1, 4], ['run-b', 2, 5], ['run-b', 3, 6]]);
  assert.equal(JSON.stringify(pooled).includes('diagnostic'), false, 'diagnostics stay in the source reports');
  assert.equal(pooled.treatment.summary, 'Only the instructions differ; both arms use mock.');
  assert.equal(pooled.heterogeneity.disagreement, false);
  assert.deepEqual(pooled.warnings, []);
  assert.match(renderAggregateTerminal({ ...pooled, artifacts: {} }, { color: false }), /Evidence: convincing; 6 paired run\(s\) across 2 source runs; exact p=0\.031\./);
});

test('keeps opposite runs visible instead of averaging them away', () => {
  // Pairing by task and attempt alone would match run A's baseline with run B's
  // candidate. Renumbered attempts keep each run's pairs intact.
  const pooled = aggregateReports([
    source(report({ runId: 'run-a', outcomes: [[0, 1], [0, 1], [1, 1]] })),
    source(report({ runId: 'run-b', outcomes: [[1, 0], [1, 0], [1, 1]] })),
  ]);
  assert.deepEqual([pooled.comparison.paired.leftWins, pooled.comparison.paired.rightWins, pooled.comparison.paired.bothPass], [2, 2, 2]);
  assert.equal(pooled.comparison.winner, 'tie');
  assert.deepEqual(pooled.heterogeneity.leaders, { candidate: 1, baseline: 1, tie: 0 });
  assert.equal(pooled.heterogeneity.summary, 'Runs disagree: 1 favours with, 1 favours without. The pooled result averages over that disagreement.');
  assert.deepEqual(pooled.heterogeneity.passRateDeltaRange.map((value) => Number(value.toFixed(6))), [-0.666667, 0.666667]);
  assert.equal(pooled.warnings.at(-1).code, 'heterogeneity');
  assert.match(renderAggregateHtml({ ...pooled, artifacts: {} }), /Runs disagree: 1 favours with/);
});

test('refuses to pool experiments that are not the same experiment', () => {
  const base = report({ runId: 'run-a', outcomes: [[0, 1]] });
  assert.throws(() => aggregateReports([source(base)]), /at least two/);
  assert.throws(() => aggregateReports([source(base), source(report({ runId: 'run-b', outcomes: [[0, 1]], names: ['without', 'other'] }))]), /Variants differ: run-a\/report\.json compares without → with; run-b\/report\.json compares without → other/);
  assert.throws(() => aggregateReports([source(base), source(report({ runId: 'run-b', outcomes: [[0, 1]], names: ['with', 'without'] }))]), /same baseline and candidate names in the same order/);
  assert.throws(() => aggregateReports([source(base), source(report({ runId: 'run-b', outcomes: [[0, 1]], tasks: ['other'] }))]), /Tasks differ/);
  assert.throws(() => aggregateReports([source(base), source(base)]), /Run run-a appears more than once; pooling it twice would double-count/);
  assert.throws(() => aggregateReports([source(base), source({ ...base, runId: 'ablation', kind: 'ablation' })]), /is an ablation report; aggregate pools experiment reports/);
  assert.throws(() => aggregateReports([source(base), source({ ...base, runId: 'future', schemaVersion: 4 })]), /schemaVersion 4/);
  assert.throws(() => aggregateReports([source(base), source({ ...base, runId: 'broken', variants: [{ name: 'without' }] })]), /not a complete experiment report/);
});

test('warns about and records every difference that might make runs incomparable', () => {
  const pooled = aggregateReports([
    source(report({ runId: 'run-a', outcomes: [[0, 1]], warnings: [{ code: 'delivery', message: 'x' }] })),
    source(report({ runId: 'run-b', outcomes: [[0, 1]], version: '0.3.1', configDigest: 'config-b', model: 'bigger', instructionDigest: 'rules-b', taskRef: 'def' })),
  ]);
  const codes = pooled.warnings.map((warning) => warning.code);
  assert.deepEqual(codes, ['version', 'config', 'agent', 'agent', 'instructions', 'task-refs', 'source-warnings']);
  assert.match(pooled.warnings[2].message, /The without arm used different agents across runs: mock; mock · bigger\./);
  assert.match(pooled.warnings[4].message, /The with arm's instructions differ across runs \(2 distinct digests\)/);
  assert.equal(pooled.variants[0].agent.provider, 'mixed', 'a pooled arm never borrows one run\'s agent');
  assert.equal(pooled.comparison.treatmentDelivery, 'unknown');
  assert.deepEqual(pooled.sources.map((entry) => [entry.version, entry.configDigest, entry.commit]), [['0.3.0', 'config-a', 'abc'], ['0.3.1', 'config-b', 'def']]);
  assert.equal(pooled.commit, null);
});

test('pools reports written by 0.2.0, which predate agents and digests per variant', async () => {
  const legacy = JSON.parse(await readFile(new URL('./fixtures/report-v0.2.0.json', import.meta.url), 'utf8'));
  const pooled = aggregateReports([source(legacy), source({ ...legacy, runId: 'calculator-demo-replay' })]);
  assert.equal(pooled.comparison.paired.pairs, 6);
  assert.deepEqual(pooled.variants.map((variant) => variant.agents), [['mock'], ['mock']]);
  assert.ok(pooled.warnings.some((warning) => warning.code === 'instructions' && /predate instruction digests/.test(warning.message)));
  assert.equal(pooled.treatment, null, 'no treatment claim the sources never made');
});

test('writes JSON and HTML, refuses to overwrite a source, and guards its default directory', { skip: process.platform === 'win32' }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'contexttest-aggregate-'));
  for (const name of ['first', 'second']) {
    await mkdir(path.join(cwd, 'runs', name), { recursive: true });
    await writeFile(path.join(cwd, 'runs', name, 'report.json'), JSON.stringify(report({ runId: `run-${name}`, outcomes: [[0, 1], [1, 1]], names: ['without <b>', 'with'] })));
  }
  const inputs = await loadReports(['runs/first/report.json', 'runs/second/report.json'], cwd);
  assert.deepEqual(inputs.map((input) => input.path), ['runs/first/report.json', 'runs/second/report.json']);
  await assert.rejects(() => writeAggregate({ report: aggregateReports(inputs), inputs, out: 'runs/first', cwd }), /holds the source report runs\/first\/report\.json, which would be overwritten/);
  const written = await writeAggregate({ report: aggregateReports(inputs), inputs, cwd });
  assert.ok(written.artifacts.json.startsWith(path.join(cwd, '.contexttest', 'aggregates')));
  const html = await readFile(written.artifacts.html, 'utf8');
  assert.equal(html, renderReport(JSON.parse(await readFile(written.artifacts.json, 'utf8'))));
  assert.match(html, /without &lt;b&gt;/);
  assert.equal(html.includes('https://'), false);
  const linked = await mkdtemp(path.join(os.tmpdir(), 'contexttest-aggregate-linked-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contexttest-aggregate-outside-'));
  await symlink(outside, path.join(linked, '.contexttest'));
  await assert.rejects(() => writeAggregate({ report: aggregateReports(inputs), inputs, cwd: linked }), /Refusing symlinked ContextTest state directory/);
  await assert.rejects(() => access(path.join(outside, 'aggregates')));
  await assert.rejects(() => loadReports(['runs/missing.json'], cwd), /Could not read runs\/missing\.json as a JSON report/);
});
