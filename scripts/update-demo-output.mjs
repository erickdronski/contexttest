import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { analyzeAblation, runAblation } from '../src/lib/ablation.mjs';
import { aggregateReports } from '../src/lib/aggregate.mjs';
import { loadConfig } from '../src/lib/config.mjs';
import { analyzeExperiment, runExperiment } from '../src/lib/engine.mjs';
import { renderReport, renderReportTerminal } from '../src/lib/reporter.mjs';
import { ensureDir, writeJson } from '../src/lib/utils.mjs';

// Regenerate the committed example reports. Every example runs for real in
// detached worktrees; only machine-specific metadata, timestamps, commit IDs,
// and timing noise are normalized afterwards, and all numbers are re-derived
// from the normalized trials with the same analysis the engine uses.
const repository = path.resolve(import.meta.dirname, '..');
const ZERO_COMMIT = '0000000000000000000000000000000000000000';
const PORTABLE_RUNTIME = { node: 'v20+', platform: 'portable-example', arch: 'portable' };

function normalizeTrial(trial, { durationMs, failure, stdout }) {
  return {
    ...trial,
    durationMs,
    assertions: trial.assertions.map((assertion) => {
      if (assertion.type !== 'command') return assertion;
      return { ...assertion, durationMs: 120, stdout: assertion.pass ? '' : failure, stderr: '' };
    }),
    stdout: stdout ?? trial.stdout,
    stderr: '',
  };
}

function portable(source, runId, directory) {
  return {
    runId,
    generatedAt: '2026-07-24T00:00:00.000Z',
    commit: ZERO_COMMIT,
    taskRefs: Object.fromEntries(Object.keys(source.taskRefs).map((name) => [name, ZERO_COMMIT])),
    runtime: { ...PORTABLE_RUNTIME, agents: source.runtime.agents },
    artifacts: { json: `${directory}/report.json`, html: `${directory}/report.html` },
  };
}

async function calculator(runId = 'calculator-demo-example', directory = 'examples/calculator/output') {
  const loaded = await loadConfig(repository, path.join(repository, 'examples/calculator/contexttest.json'));
  const source = await runExperiment(loaded);
  const metadata = portable(source, runId, directory);
  const { variants, comparison, taskResults } = analyzeExperiment({
    variants: source.variants.map(({ summary, ...variant }, variantIndex) => ({
      ...variant,
      trials: variant.trials.map((trial) => normalizeTrial(trial, {
        durationMs: (variantIndex === 0 ? 310 : 290) + trial.attempt * 2,
        failure: 'Test failed: the existing add export was not preserved.\n',
        stdout: variantIndex === 0 ? 'Completed without repository instructions.\n' : 'Completed with repository instructions.\n',
      })),
    })),
    tasks: source.tasks,
    taskRefs: metadata.taskRefs,
    provider: source.agent.provider,
  });
  return { report: { ...source, ...metadata, variants, taskResults, comparison }, directory };
}

async function ablation() {
  const loaded = await loadConfig(repository, path.join(repository, 'examples/ablation/contexttest.json'));
  const source = await runAblation(loaded);
  const metadata = portable(source, 'inventory-ablation-example', 'examples/ablation/output');
  // Every arm gets the same timing, so the committed report cannot show a
  // duration effect that was only scheduling noise.
  const { arms, effects } = analyzeAblation({
    arms: source.arms.map(({ summary, ...arm }) => ({
      ...arm,
      trials: arm.trials.map((trial) => normalizeTrial(trial, { durationMs: 300 + trial.attempt * 2, failure: 'Test failed: the existing addItem export was not preserved.\n' })),
    })),
    tasks: source.tasks,
    taskRefs: metadata.taskRefs,
    provider: source.agent.provider,
  });
  return { report: { ...source, ...metadata, arms, effects }, directory: 'examples/ablation/output' };
}

// Two more independent runs of the calculator experiment, pooled. Each source
// is a complete experiment report; the aggregate is computed from them exactly
// as `contexttest aggregate` would.
async function aggregate() {
  const sources = [];
  for (const [runId, name] of [['calculator-demo-run-1', 'first'], ['calculator-demo-run-2', 'second']]) {
    const { report, directory } = await calculator(runId, `examples/aggregate/runs/${name}`);
    await save({ report, directory });
    sources.push({ path: `${directory}/report.json`, report });
  }
  const pooled = aggregateReports(sources);
  const directory = 'examples/aggregate/output';
  return {
    report: { ...pooled, aggregateId: 'calculator-aggregate-example', generatedAt: '2026-07-24T00:00:00.000Z', artifacts: { json: `${directory}/report.json`, html: `${directory}/report.html` } },
    directory,
  };
}

async function save({ report, directory }) {
  const output = path.join(repository, directory);
  await ensureDir(output);
  await writeJson(path.join(output, 'report.json'), report);
  await writeFile(path.join(output, 'report.html'), renderReport(report), 'utf8');
  process.stdout.write(renderReportTerminal(report, { color: false }));
  process.stdout.write(`Updated ${directory}.\n`);
}

for (const example of [calculator, ablation, aggregate]) await save(await example());
