import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/lib/config.mjs';
import { runExperiment } from '../src/lib/engine.mjs';
import { renderHtmlReport, renderTerminalReport } from '../src/lib/reporter.mjs';
import { compareVariants, pairTrials, summarizeTrials } from '../src/lib/stats.mjs';
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

function normalizeReport(source) {
  const variants = source.variants.map((variant, variantIndex) => {
    const trials = variant.trials.map((trial) => normalizeTrial(trial, variantIndex));
    return { ...variant, trials, summary: summarizeTrials(trials) };
  });
  const trials = variants.flatMap((variant) => variant.trials);
  const paired = pairTrials(trials, variants[0].name, variants[1].name);
  const comparison = compareVariants(variants[0].summary, variants[1].summary, paired);
  const taskResults = source.taskResults.map((task) => {
    const taskVariants = variants.map((variant) => {
      const taskTrials = variant.trials.filter((trial) => trial.task === task.name);
      return { name: variant.name, summary: summarizeTrials(taskTrials) };
    });
    const taskTrials = trials.filter((trial) => trial.task === task.name);
    const taskPaired = pairTrials(taskTrials, taskVariants[0].name, taskVariants[1].name);
    return {
      ...task,
      ref: '0000000000000000000000000000000000000000',
      variants: taskVariants,
      comparison: compareVariants(taskVariants[0].summary, taskVariants[1].summary, taskPaired),
    };
  });
  return {
    ...source,
    runId: 'calculator-demo-example',
    generatedAt: '2026-07-24T00:00:00.000Z',
    commit: '0000000000000000000000000000000000000000',
    taskRefs: Object.fromEntries(Object.keys(source.taskRefs).map((name) => [name, '0000000000000000000000000000000000000000'])),
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
