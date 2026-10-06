import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/lib/config.mjs';
import { analyzeExperiment, runExperiment } from '../src/lib/engine.mjs';
import { renderHtmlReport, renderTerminalReport } from '../src/lib/reporter.mjs';
import { ensureDir, writeJson } from '../src/lib/utils.mjs';

const repository = path.resolve(import.meta.dirname, '..');
const configPath = path.join(repository, 'examples/calculator/contexttest.json');
const outputDirectory = path.join(repository, 'examples/calculator/output');

function normalizeTrial(trial, variantIndex) {
  const baseline = variantIndex === 0;
  const durationMs = (baseline ? 310 : 290) + trial.attempt * 2;
  return {
    ...trial,
    durationMs,
    assertions: trial.assertions.map((assertion) => {
      if (assertion.type !== 'command') return assertion;
      return {
        ...assertion,
        durationMs: 120,
        stdout: assertion.pass ? '' : 'Test failed: the existing add export was not preserved.\n',
        stderr: '',
      };
    }),
    stdout: baseline ? 'Completed without repository instructions.\n' : 'Completed with repository instructions.\n',
    stderr: '',
  };
}

const ZERO_COMMIT = '0000000000000000000000000000000000000000';

function normalizeReport(source) {
  const taskRefs = Object.fromEntries(Object.keys(source.taskRefs).map((name) => [name, ZERO_COMMIT]));
  const { variants, comparison, taskResults } = analyzeExperiment({
    variants: source.variants.map(({ summary, ...variant }, variantIndex) => ({ ...variant, trials: variant.trials.map((trial) => normalizeTrial(trial, variantIndex)) })),
    tasks: source.tasks,
    taskRefs,
    provider: source.agent.provider,
  });
  return {
    ...source,
    runId: 'calculator-demo-example',
    generatedAt: '2026-07-24T00:00:00.000Z',
    commit: ZERO_COMMIT,
    taskRefs,
    runtime: { node: 'v20+', platform: 'portable-example', arch: 'portable' },
    variants,
    taskResults,
    comparison,
    artifacts: {
      json: 'examples/calculator/output/report.json',
      html: 'examples/calculator/output/report.html',
    },
  };
}

const loaded = await loadConfig(repository, configPath);
const source = await runExperiment(loaded);
const report = normalizeReport(source);
await ensureDir(outputDirectory);
await writeJson(path.join(outputDirectory, 'report.json'), report);
await writeFile(path.join(outputDirectory, 'report.html'), renderHtmlReport(report), 'utf8');
process.stdout.write(renderTerminalReport(report, { color: false }));
process.stdout.write(`Updated ${path.relative(repository, outputDirectory)}.\n`);
