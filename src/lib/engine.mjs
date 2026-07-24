import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { evaluateAssertions } from './assertions.mjs';
import { runAgent } from './adapters.mjs';
import { applyVariant, assertGitRepository, createWorktree, currentCommit, removeWorktree, snapshotTrialBaseline } from './git.mjs';
import { validateConfig } from './config.mjs';
import { renderHtmlReport } from './reporter.mjs';
import { compareVariants, pairTrials, summarizeTrials } from './stats.mjs';
import { ensureDir, environmentSecrets, isPathInside, redact, runProcess, safeEnvironment, slug, timestampId, VERSION, writeJson } from './utils.mjs';

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function runSetupCommands(config, worktree) {
  const commands = config.setup?.commands ?? [];
  if (!commands.length) return;
  const env = safeEnvironment(config.environment);
  const secrets = environmentSecrets(config.environment, { ...process.env, ...env });
  for (const [command, ...args] of commands) {
    const result = await runProcess(command, args, { cwd: worktree, env, timeoutMs: (config.setup?.timeoutMinutes ?? 10) * 60_000 });
    if (result.code !== 0 || result.timedOut) {
      const outcome = result.timedOut ? 'timed out' : `exited with code ${result.code}`;
      const diagnostics = redact(result.stderr || result.stdout, secrets).slice(-4000);
      throw new Error(`Setup command ${command} ${outcome}.${diagnostics ? `\n${diagnostics}` : ''}`);
    }
  }
}

async function ensureSafeStateDirectory(target, repository) {
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink()) throw new Error(`Refusing symlinked ContextTest state directory: ${target}`);
    if (!details.isDirectory()) throw new Error(`ContextTest state path is not a directory: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await ensureDir(target);
  }
  const [realRepository, realTarget] = await Promise.all([realpath(repository), realpath(target)]);
  if (!isPathInside(realRepository, realTarget)) throw new Error(`ContextTest state directory escapes the repository: ${target}`);
}

export async function runExperiment({ config, root, taskFilter, keepWorktrees = false, reportDir, onEvent = () => {} }) {
  const configErrors = validateConfig(config);
  if (configErrors.length) throw new Error(`Invalid ContextTest configuration:\n- ${configErrors.join('\n- ')}`);
  const repository = await assertGitRepository(root);
  const runId = `${timestampId()}-${slug(config.project)}-${randomBytes(2).toString('hex')}`;
  const stateRoot = path.join(repository, '.contexttest');
  const worktreeBase = path.join(stateRoot, 'worktrees');
  const reportBase = path.join(stateRoot, 'reports');
  const worktreeRoot = path.join(worktreeBase, runId);
  const artifactRoot = path.resolve(reportDir ?? path.join(reportBase, runId));
  if (isPathInside(worktreeRoot, artifactRoot)) throw new Error('reportDir cannot be inside the temporary worktree directory.');
  const tasks = taskFilter ? config.tasks.filter((task) => task.name === taskFilter) : config.tasks;
  if (!tasks.length) throw new Error(`No task named ${taskFilter}.`);
  const taskRefs = {};
  for (const task of tasks) taskRefs[task.name] = await currentCommit(repository, task.ref ?? config.baseRef ?? 'HEAD');
  const resolvedCommits = [...new Set(Object.values(taskRefs))];
  const commit = resolvedCommits.length === 1 ? resolvedCommits[0] : null;
  await ensureSafeStateDirectory(stateRoot, repository);
  await ensureSafeStateDirectory(worktreeBase, repository);
  if (!reportDir) await ensureSafeStateDirectory(reportBase, repository);
  await ensureDir(worktreeRoot); await ensureDir(artifactRoot);
  const attempts = config.trials?.attempts ?? 3;
  const jobs = [];
  for (const task of tasks) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const orderedVariants = attempt % 2 ? config.variants : [...config.variants].reverse();
      for (const variant of orderedVariants) jobs.push({ variant, variantIndex: config.variants.indexOf(variant), task, attempt });
    }
  }
  onEvent({ type: 'experiment:start', runId, jobs: jobs.length });
  const trialResults = await pool(jobs, config.trials?.concurrency ?? 1, async (job, jobIndex) => {
    const id = `${slug(job.task.name)}-${slug(job.variant.name)}-${job.attempt}`;
    const worktree = path.join(worktreeRoot, id);
    onEvent({ type: 'trial:start', ...job, index: jobIndex + 1, total: jobs.length });
    let created = false;
    try {
      await createWorktree({ repository, destination: worktree, ref: job.task.ref ?? config.baseRef ?? 'HEAD' });
      created = true;
      await applyVariant({ root, worktree, instructionFile: config.instructionFile ?? 'AGENTS.md', variant: job.variant });
      await runSetupCommands(config, worktree);
      await snapshotTrialBaseline(worktree);
      const started = Date.now();
      const agentResult = await runAgent({ agent: config.agent, prompt: job.task.prompt, cwd: worktree, environment: config.environment, mock: job.task.mock });
      const evaluation = await evaluateAssertions({ assertions: job.task.assertions, worktree, agentResult, environment: config.environment });
      const trial = {
        id, task: job.task.name, variant: job.variant.name, attempt: job.attempt,
        passed: evaluation.passed, score: evaluation.score, durationMs: Date.now() - started,
        assertions: evaluation.results, files: evaluation.files, diff: evaluation.diff,
        usage: agentResult.usage, exitCode: agentResult.code, timedOut: agentResult.timedOut,
        stdout: agentResult.stdout.slice(-10_000), stderr: agentResult.stderr.slice(-10_000),
      };
      onEvent({ type: 'trial:complete', trial, index: jobIndex + 1, total: jobs.length });
      return trial;
    } catch (error) {
      const trial = { id, task: job.task.name, variant: job.variant.name, attempt: job.attempt, passed: false, score: 0, durationMs: 0, infrastructureError: true, assertions: [{ type: 'infrastructure', pass: false, message: error.message }], files: [], diff: { additions: 0, deletions: 0, total: 0 }, usage: {}, exitCode: 1, timedOut: false, stdout: '', stderr: error.stack ?? error.message };
      onEvent({ type: 'trial:error', trial, index: jobIndex + 1, total: jobs.length });
      return trial;
    } finally {
      if (created && !keepWorktrees) await removeWorktree({ repository, destination: worktree, worktreeRoot }).catch(() => {});
    }
  });
  const infrastructureFailures = trialResults.filter((trial) => trial.infrastructureError);
  if (infrastructureFailures.length) {
    if (!keepWorktrees) await rm(worktreeRoot, { recursive: true, force: true }).catch(() => {});
    const first = infrastructureFailures[0].assertions[0].message;
    throw new Error(`${infrastructureFailures.length} trial(s) failed before the agent could run. The experiment is invalid.\nFirst failure: ${first}`);
  }
  const variants = config.variants.map((variant) => {
    const trials = trialResults.filter((trial) => trial.variant === variant.name);
    return { name: variant.name, trials, summary: summarizeTrials(trials) };
  });
  const paired = pairTrials(trialResults, variants[0].name, variants[1].name);
  const comparison = compareVariants(variants[0].summary, variants[1].summary, paired);
  const taskResults = tasks.map((task) => {
    const taskTrials = trialResults.filter((trial) => trial.task === task.name);
    const taskVariants = config.variants.map((variant) => {
      const trials = taskTrials.filter((trial) => trial.variant === variant.name);
      return { name: variant.name, summary: summarizeTrials(trials) };
    });
    const taskPaired = pairTrials(taskTrials, taskVariants[0].name, taskVariants[1].name);
    return { name: task.name, ref: taskRefs[task.name], variants: taskVariants, comparison: compareVariants(taskVariants[0].summary, taskVariants[1].summary, taskPaired) };
  });
  const jsonPath = path.join(artifactRoot, 'report.json');
  const htmlPath = path.join(artifactRoot, 'report.html');
  const report = {
    schemaVersion: 1,
    version: VERSION,
    runId,
    generatedAt: new Date().toISOString(),
    project: config.project,
    commit,
    taskRefs,
    instructionFile: config.instructionFile ?? 'AGENTS.md',
    agent: { provider: config.agent.provider, model: config.agent.model ?? null },
    experiment: {
      attemptsPerVariant: attempts,
      concurrency: config.trials?.concurrency ?? 1,
      setupCommands: config.setup?.commands?.length ?? 0,
      configDigest: createHash('sha256').update(JSON.stringify(config)).digest('hex'),
    },
    runtime: { node: process.version, platform: os.platform(), arch: os.arch() },
    tasks: tasks.map(({ name }) => name),
    taskResults,
    variants,
    comparison,
    artifacts: { json: jsonPath, html: htmlPath },
  };
  await writeJson(jsonPath, report);
  await import('node:fs/promises').then((fs) => fs.writeFile(htmlPath, renderHtmlReport(report), 'utf8'));
  if (!keepWorktrees) await rm(worktreeRoot, { recursive: true, force: true }).catch(() => {});
  onEvent({ type: 'experiment:complete', report });
  return report;
}
