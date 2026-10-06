#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStarterConfig, loadConfig } from './lib/config.mjs';
import { runExperiment } from './lib/engine.mjs';
import { deliveryFor, deliveryWarning, ISOLATION_FLAGS } from './lib/adapters.mjs';
import { assertGitRepository, currentCommit, pathExistsAtRef } from './lib/git.mjs';
import { renderHtmlReport, renderTerminalReport } from './lib/reporter.mjs';
import { exists, findExecutable, isPathInside, parseArgs, runProcess, VERSION, writeJson } from './lib/utils.mjs';

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
    const executable = await findExecutable(name);
    if (!executable) { checks.push({ name, pass: false, detail: 'not found on PATH' }); return; }
    const result = await runProcess(executable, ['--version'], { timeoutMs: 10_000, env: process.env });
    checks.push({ name, pass: true, detail: result.code === 0 ? (result.stdout || result.stderr).trim().split('\n')[0] : executable });
  };
  await checkExecutable('git');
  let loaded;
  try { loaded = await loadConfig(process.cwd(), flags.config); checks.push({ name: 'configuration', pass: true, detail: loaded.configPath }); }
  catch (error) { checks.push({ name: 'configuration', pass: false, detail: error.message }); }
  if (loaded) {
    let repository;
    try { repository = await assertGitRepository(loaded.root); checks.push({ name: 'repository', pass: true, detail: repository }); }
    catch (error) { checks.push({ name: 'repository', pass: false, detail: error.message }); }
    if (repository) {
      const status = await runProcess('git', ['status', '--porcelain'], { cwd: repository, env: process.env, timeoutMs: 10_000 });
      checks.push({ name: 'committed base', pass: true, warn: Boolean(status.stdout.trim()), detail: status.stdout.trim() ? 'working-tree changes are excluded from experiments' : 'working tree is clean' });
      for (const task of loaded.config.tasks) {
        try {
          const commit = await currentCommit(repository, task.ref ?? loaded.config.baseRef ?? 'HEAD');
          checks.push({ name: `ref:${task.name}`, pass: true, detail: commit.slice(0, 12) });
        } catch { checks.push({ name: `ref:${task.name}`, pass: false, detail: `cannot resolve ${task.ref ?? loaded.config.baseRef ?? 'HEAD'}` }); }
      }
    }
    const delivery = deliveryFor(loaded.config.agent.provider, loaded.config.instructionFile ?? 'AGENTS.md');
    if (delivery.method === 'native') checks.push({ name: 'delivery', pass: true, detail: `${delivery.file} is loaded natively by ${loaded.config.agent.provider}` });
    if (delivery.method === 'unverified') checks.push({ name: 'delivery', pass: true, warn: true, detail: deliveryWarning(loaded.config.agent.provider, delivery) });
    if (delivery.method === 'bridged') {
      checks.push({ name: 'delivery', pass: true, warn: true, detail: `Claude Code does not read ${delivery.file}; every arm gets ${delivery.bridgedVia} so the treatment reaches it` });
      const refs = [...new Set(loaded.config.tasks.map((task) => task.ref ?? loaded.config.baseRef ?? 'HEAD'))];
      if (repository) for (const ref of refs) {
        if (await pathExistsAtRef(repository, ref, delivery.bridge)) checks.push({ name: 'delivery', pass: true, warn: true, detail: `${ref} already has ${delivery.bridge}: its rules reach every arm, including the one without instructions, and ContextTest adds the import to it` });
      }
    }
    const { provider, isolate } = loaded.config.agent;
    if (ISOLATION_FLAGS[provider] && isolate) checks.push({ name: 'isolation', pass: true, detail: `trials run with ${ISOLATION_FLAGS[provider].join(' ')}` });
    if (ISOLATION_FLAGS[provider] && !isolate) checks.push({ name: 'isolation', pass: true, warn: true, detail: provider === 'claude' ? 'your user settings, plugins, hooks, and MCP servers load into every trial; set agent.isolate: true' : 'your ~/.codex/config.toml (profiles, MCP servers) applies to every trial; set agent.isolate: true' });
    for (const variant of loaded.config.variants.filter((item) => item.source)) {
      const source = path.resolve(loaded.root, variant.source);
      const pass = isPathInside(loaded.root, source) && await exists(source);
      checks.push({ name: `variant:${variant.name}`, pass, detail: pass ? variant.source : `${variant.source} not found` });
    }
    for (const command of loaded.config.setup?.commands ?? []) {
      const executable = await findExecutable(command[0]);
      checks.push({ name: `setup:${command[0]}`, pass: Boolean(executable), detail: executable ?? 'not found on PATH' });
    }
  }
  if (loaded?.config.agent.provider === 'codex') await checkExecutable(loaded.config.agent.executable ?? 'codex');
  if (loaded?.config.agent.provider === 'claude') await checkExecutable(loaded.config.agent.executable ?? 'claude');
  if (loaded?.config.agent.provider === 'command') await checkExecutable(loaded.config.agent.command[0]);
  if (loaded?.config.agent.provider === 'mock') for (const task of loaded.config.tasks) {
    const executable = await findExecutable(task.mock.command[0]);
    checks.push({ name: `mock:${task.name}`, pass: Boolean(executable), detail: executable ?? `${task.mock.command[0]} not found on PATH` });
  }
  log('\nCONTEXTTEST / DOCTOR\n');
  for (const check of checks) log(`${!check.pass ? '×' : check.warn ? '!' : '✓'} ${check.name.padEnd(16)} ${check.detail}`);
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
