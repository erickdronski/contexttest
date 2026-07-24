#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStarterConfig, loadConfig } from './lib/config.mjs';
import { runExperiment } from './lib/engine.mjs';
import { renderHtmlReport, renderTerminalReport } from './lib/reporter.mjs';
import { exists, parseArgs, VERSION, writeJson } from './lib/utils.mjs';

const HELP = `
ContextTest — A/B testing for coding-agent instructions

Usage
  contexttest init [--force]
  contexttest run [--config path] [--task name] [--attempts n]
                  [--keep-worktrees] [--report-dir path] [--json]
  contexttest doctor [--config path]
  contexttest report <report.json> [--output report.html]
  contexttest --version

Examples
  contexttest init
  contexttest run --attempts 5
  contexttest run --task focused-change --json
`;

function log(message = '') { process.stdout.write(`${message}\n`); }
function fail(error) { process.stderr.write(`ContextTest: ${error.message}\n`); process.exitCode = 1; }

async function init(flags) {
  const target = path.resolve('contexttest.json');
  const candidate = path.resolve('AGENTS.candidate.md');
  if (await exists(target) && !flags.force) throw new Error('contexttest.json already exists. Pass --force to replace it.');
  await writeJson(target, createStarterConfig());
  if (!await exists(candidate)) await writeFile(candidate, '# Coding agent instructions\n\n- Keep changes focused.\n- Run the relevant tests before finishing.\n- Explain verification in the final response.\n', 'utf8');
  const ignore = path.resolve('.gitignore');
  const marker = '.contexttest/';
  if (!await exists(ignore)) await writeFile(ignore, `${marker}\n`, 'utf8');
  else if (!(await readFile(ignore, 'utf8')).split(/\r?\n/).includes(marker)) await appendFile(ignore, `\n${marker}\n`, 'utf8');
  log('Created contexttest.json, AGENTS.candidate.md, and .contexttest/ ignore rule.');
  log('Next: edit the task and assertions, then run `contexttest run`.');
}

async function run(flags) {
  const loaded = await loadConfig(process.cwd(), flags.config);
  if (flags.attempts) loaded.config.trials.attempts = Number(flags.attempts);
  let completed = 0;
  const report = await runExperiment({
    ...loaded,
    taskFilter: flags.task,
    keepWorktrees: Boolean(flags.keepWorktrees),
    reportDir: flags.reportDir,
    onEvent(event) {
      if (flags.json) return;
      if (event.type === 'experiment:start') log(`\nRunning ${event.jobs} trials in isolated worktrees…`);
      if (event.type === 'trial:complete' || event.type === 'trial:error') {
        completed += 1;
        const trial = event.trial;
        log(`[${completed}/${event.total}] ${trial.variant} / ${trial.task} / ${trial.attempt}  ${trial.passed ? 'PASS' : 'FAIL'}`);
      }
    },
  });
  if (flags.json) log(JSON.stringify(report));
  else log(renderTerminalReport(report));
  if (report.comparison.winner === 'baseline') process.exitCode = 2;
}

async function doctor(flags) {
  const checks = [];
  const checkExecutable = async (name) => {
    const result = await import('./lib/utils.mjs').then(({ runProcess }) => runProcess(name, ['--version'], { timeoutMs: 10_000, env: process.env }));
    checks.push({ name, pass: result.code === 0, detail: result.code === 0 ? (result.stdout || result.stderr).trim().split('\n')[0] : 'not found' });
  };
  await checkExecutable('git');
  let loaded;
  try { loaded = await loadConfig(process.cwd(), flags.config); checks.push({ name: 'configuration', pass: true, detail: loaded.configPath }); }
  catch (error) { checks.push({ name: 'configuration', pass: false, detail: error.message }); }
  if (loaded?.config.agent.provider === 'codex') await checkExecutable(loaded.config.agent.executable ?? 'codex');
  if (loaded?.config.agent.provider === 'claude') await checkExecutable(loaded.config.agent.executable ?? 'claude');
  if (loaded?.config.agent.provider === 'command') await checkExecutable(loaded.config.agent.command[0]);
  log('\nCONTEXTTEST / DOCTOR\n');
  for (const check of checks) log(`${check.pass ? '✓' : '×'} ${check.name.padEnd(16)} ${check.detail}`);
  if (checks.some((check) => !check.pass)) process.exitCode = 1;
}

async function reportCommand(positional, flags) {
  const input = positional[1];
  if (!input) throw new Error('report requires a report.json path.');
  const data = JSON.parse(await readFile(path.resolve(input), 'utf8'));
  const output = path.resolve(flags.output ?? path.join(path.dirname(input), 'report.html'));
  await writeFile(output, renderHtmlReport(data), 'utf8');
  log(`Wrote ${output}`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (flags.version || command === 'version') return log(VERSION);
  if (flags.help || !command || command === 'help') return log(HELP.trim());
  if (command === 'init') return init(flags);
  if (command === 'run') return run(flags);
  if (command === 'doctor') return doctor(flags);
  if (command === 'report') return reportCommand(positional, flags);
  throw new Error(`Unknown command: ${command}\n\n${HELP.trim()}`);
}

main().catch(fail);
