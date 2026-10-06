#!/usr/bin/env node
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStarterConfig, loadConfig, variantAgents } from './lib/config.mjs';
import { runExperiment } from './lib/engine.mjs';
import { deliveryFor, deliveryWarning, ISOLATION_ENV, ISOLATION_FLAGS } from './lib/adapters.mjs';
import { assertGitRepository, currentCommit, pathExistsAtRef } from './lib/git.mjs';
import { planAblation, runAblation } from './lib/ablation.mjs';
import { aggregateReports, loadReports, writeAggregate } from './lib/aggregate.mjs';
import { renderAblationPlan, renderAblationTerminal, renderAggregateTerminal, renderReport, renderTerminalReport, reportKind } from './lib/reporter.mjs';
import { exists, findExecutable, isPathInside, parseArgs, runProcess, stableStringify, VERSION, writeJson } from './lib/utils.mjs';

const HELP = `
ContextTest — A/B testing for coding-agent instructions

Usage
  contexttest init [--force]
  contexttest run [--config path] [--task name] [--attempts n] [--seed n]
                  [--keep-worktrees] [--report-dir path] [--json]
  contexttest ablate [--config path] [--variant name] [--level 2]
                     [--sections "A,B"] [--task name] [--attempts n] [--seed n]
                     [--dry-run] [--keep-worktrees] [--report-dir path] [--json]
  contexttest aggregate <report.json> <report.json>... [--out dir] [--json]
  contexttest doctor [--config path]
  contexttest report <report.json> [--output report.html]
  contexttest --version

Examples
  contexttest init
  contexttest run --attempts 5
  contexttest run --task focused-change --json
  contexttest ablate --dry-run
  contexttest ablate --sections "Testing,Style" --attempts 5
  contexttest aggregate runs/*/report.json --out pooled
`;

function log(message = '') { process.stdout.write(`${message}\n`); }

// A flag given without a value parses as `true`; never let that become 1.
function valueFlag(flags, name) {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (value === true) throw new Error(`--${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} requires a value.`);
  return value;
}

function integerFlag(flags, name) {
  const value = valueFlag(flags, name);
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) throw new Error(`--${name} must be an integer.`);
  return Number(value);
}

// Command-line overrides replace config values; the engine validates bounds.
async function loadWithOverrides(flags) {
  const loaded = await loadConfig(process.cwd(), valueFlag(flags, 'config'));
  const attempts = integerFlag(flags, 'attempts');
  const seed = integerFlag(flags, 'seed');
  if (attempts !== undefined) loaded.config.trials = { ...loaded.config.trials, attempts };
  if (seed !== undefined) loaded.config.trials = { ...loaded.config.trials, seed };
  return loaded;
}
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
  const loaded = await loadWithOverrides(flags);
  const report = await runExperiment({
    ...loaded,
    taskFilter: valueFlag(flags, 'task'),
    keepWorktrees: Boolean(flags.keepWorktrees),
    reportDir: valueFlag(flags, 'reportDir'),
    onEvent: progress(flags),
  });
  if (flags.json) log(JSON.stringify(report));
  else log(renderTerminalReport(report));
  if (report.comparison.winner === 'baseline') process.exitCode = 2;
}

function progress(flags) {
  let completed = 0;
  return (event) => {
    if (flags.json) return;
    if (event.type === 'experiment:start' || event.type === 'ablation:start') log(`\nRunning ${event.jobs} trials in isolated worktrees${event.order === 'seeded' ? ` (seeded order, seed ${event.seed})` : ''}…`);
    if (event.type === 'trial:complete' || event.type === 'trial:error') {
      completed += 1;
      const trial = event.trial;
      log(`[${completed}/${event.total}] ${trial.variant} / ${trial.task} / ${trial.attempt}  ${trial.passed ? 'PASS' : 'FAIL'}`);
    }
  };
}

async function ablate(flags) {
  const loaded = await loadWithOverrides(flags);
  const options = {
    ...loaded,
    variantName: valueFlag(flags, 'variant'),
    level: integerFlag(flags, 'level') ?? 2,
    sections: valueFlag(flags, 'sections'),
    taskFilter: valueFlag(flags, 'task'),
  };
  const plan = await planAblation(options);
  if (flags.dryRun) {
    if (flags.json) log(JSON.stringify({ variant: plan.variant.name, source: plan.variant.source ?? null, level: plan.level, sections: plan.split.sections.map((section) => ({ ...section, selected: plan.selected.includes(section) })), budget: plan.budget }));
    else log(`\n${renderAblationPlan(plan)}\n\nDry run: no worktrees were created and no agent ran.`);
    return;
  }
  if (!flags.json) log(`\n${renderAblationPlan(plan)}`);
  const report = await runAblation({ ...options, keepWorktrees: Boolean(flags.keepWorktrees), reportDir: valueFlag(flags, 'reportDir'), onEvent: progress(flags) });
  log(flags.json ? JSON.stringify(report) : renderAblationTerminal(report));
}

async function aggregate(positional, flags) {
  const inputs = await loadReports(positional.slice(1));
  const report = aggregateReports(inputs);
  await writeAggregate({ report, inputs, out: valueFlag(flags, 'out') });
  log(flags.json ? JSON.stringify(report) : renderAggregateTerminal(report));
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
  try { loaded = await loadConfig(process.cwd(), valueFlag(flags, 'config')); checks.push({ name: 'configuration', pass: true, detail: loaded.configPath }); }
  catch (error) { checks.push({ name: 'configuration', pass: false, detail: error.message }); }
  // One entry per distinct agent: variants may override the top-level agent.
  const agents = loaded ? [...new Map(variantAgents(loaded.config).map((agent) => [stableStringify(agent), agent])).values()] : [];
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
    for (const provider of [...new Set(agents.map((agent) => agent.provider))]) {
      const delivery = deliveryFor(provider, loaded.config.instructionFile ?? 'AGENTS.md');
      if (delivery.method === 'native') checks.push({ name: 'delivery', pass: true, detail: `${delivery.file} is loaded natively by ${provider}` });
      if (delivery.method === 'unverified') checks.push({ name: 'delivery', pass: true, warn: true, detail: deliveryWarning(provider, delivery) });
      if (delivery.method === 'bridged') {
        checks.push({ name: 'delivery', pass: true, warn: true, detail: `Claude Code does not read ${delivery.file}; every arm gets ${delivery.bridgedVia} so the treatment reaches it, and an arm without instructions gets an empty ${delivery.file} so the import never dangles` });
        const refs = [...new Set(loaded.config.tasks.map((task) => task.ref ?? loaded.config.baseRef ?? 'HEAD'))];
        if (repository) for (const ref of refs) {
          if (await pathExistsAtRef(repository, ref, delivery.bridge)) checks.push({ name: 'delivery', pass: true, warn: true, detail: `${ref} already has ${delivery.bridge}: its rules reach every arm, including the one without instructions, and ContextTest adds the import to it` });
        }
      }
    }
    for (const { provider, isolate } of agents) {
      const variables = Object.entries(ISOLATION_ENV[provider] ?? {}).map(([name, value]) => `${name}=${value}`);
      if (ISOLATION_FLAGS[provider] && isolate) checks.push({ name: 'isolation', pass: true, detail: `${provider} trials run with ${[...ISOLATION_FLAGS[provider], ...variables].join(' ')}` });
      if (ISOLATION_FLAGS[provider] && !isolate) checks.push({ name: 'isolation', pass: true, warn: true, detail: provider === 'claude' ? 'your user settings, plugins, hooks, and MCP servers load into every trial, and all trials share one auto-memory directory; set agent.isolate: true' : 'your ~/.codex/config.toml (profiles, MCP servers) applies to every trial; set agent.isolate: true' });
    }
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
  const executables = new Set(agents.filter((agent) => agent.provider !== 'mock').map((agent) => agent.provider === 'command' ? agent.command[0] : agent.executable ?? agent.provider));
  for (const executable of executables) await checkExecutable(executable);
  if (agents.some((agent) => agent.provider === 'mock')) for (const task of loaded.config.tasks) {
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
  const kind = reportKind(data);
  const output = path.resolve(valueFlag(flags, 'output') ?? path.join(path.dirname(input), 'report.html'));
  await writeFile(output, renderReport(data), 'utf8');
  log(`Wrote ${output} (${kind} report)`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (flags.version || command === 'version') return log(VERSION);
  if (flags.help || !command || command === 'help') return log(HELP.trim());
  if (command === 'init') return init(flags);
  if (command === 'run') return run(flags);
  if (command === 'ablate') return ablate(flags);
  if (command === 'aggregate') return aggregate(positional, flags);
  if (command === 'doctor') return doctor(flags);
  if (command === 'report') return reportCommand(positional, flags);
  throw new Error(`Unknown command: ${command}\n\n${HELP.trim()}`);
}

main().catch(fail);
