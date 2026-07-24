import { appendFile } from 'node:fs/promises';
import { loadConfig } from './lib/config.mjs';
import { runExperiment } from './lib/engine.mjs';
import { formatDuration, formatMoney } from './lib/utils.mjs';

const input = (name) => process.env[`INPUT_${name.toUpperCase().replaceAll('-', '_')}`] ?? '';
const output = async (name, value) => {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
  else process.stdout.write(`${name}=${value}\n`);
};
const percent = (value) => `${Math.round((value ?? 0) * 100)}%`;

async function main() {
  const loaded = await loadConfig(process.cwd(), input('config'));
  if (input('attempts')) loaded.config.trials.attempts = Number(input('attempts'));
  const report = await runExperiment({ ...loaded, taskFilter: input('task') || undefined, reportDir: input('report-dir') });
  await output('winner', report.comparison.winner);
  await output('report-json', report.artifacts.json);
  await output('report-html', report.artifacts.html);
  const [baseline, candidate] = report.variants;
  const summary = `## ContextTest: ${report.comparison.winner === 'tie' ? 'no clear winner' : `${report.comparison.winner} leads`}\n\n${report.comparison.reason}\n\n| Outcome | ${baseline.name} | ${candidate.name} |\n|---|---:|---:|\n| Task success | ${percent(baseline.summary.passRate)} | ${percent(candidate.summary.passRate)} |\n| Assertion adherence | ${percent(baseline.summary.meanAssertionScore)} | ${percent(candidate.summary.meanAssertionScore)} |\n| Median duration | ${formatDuration(baseline.summary.medianDurationMs)} | ${formatDuration(candidate.summary.medianDurationMs)} |\n| Median cost | ${formatMoney(baseline.summary.medianCostUsd)} | ${formatMoney(candidate.summary.medianCostUsd)} |\n\nSignal: **${report.comparison.signal}**, based on ${report.comparison.minimumAttempts} paired attempt(s).\n`;
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  if (report.comparison.winner === 'baseline') process.exitCode = 2;
}

main().catch((error) => { process.stderr.write(`::error::${error.message.replaceAll('\n', '%0A')}\n`); process.exitCode = 1; });
