import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { evaluateAssertions } from './assertions.mjs';
import { runAgent } from './adapters.mjs';
import { applyVariant, assertGitRepository, createWorktree, currentCommit, removeWorktree, snapshotTrialBaseline } from './git.mjs';
import { renderHtmlReport } from './reporter.mjs';
import { compareVariants, summarizeTrials } from './stats.mjs';
import { ensureDir, slug, timestampId, writeJson } from './utils.mjs';

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

export async function runExperiment({ config, root, taskFilter, keepWorktrees = false, reportDir, onEvent = () => {} }) {
  const repository = await assertGitRepository(root);
  const commit = await currentCommit(repository);
  const runId = `${timestampId()}-${slug(config.project)}`;
  const stateRoot = path.join(repository, '.contexttest');
  const worktreeRoot = path.join(stateRoot, 'worktrees', runId);
  const artifactRoot = path.resolve(reportDir ?? path.join(stateRoot, 'reports', runId));
  await ensureDir(worktreeRoot); await ensureDir(artifactRoot);
  const tasks = taskFilter ? config.tasks.filter((task) => task.name === taskFilter) : config.tasks;
  if (!tasks.length) throw new Error(`No task named ${taskFilter}.`);
  const attempts = config.trials?.attempts ?? 3;
  const jobs = [];
  for (const [variantIndex, variant] of config.variants.entries()) {
    for (const task of tasks) for (let attempt = 1; attempt <= attempts; attempt += 1) jobs.push({ variant, variantIndex, task, attempt });
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
      const trial = { id, task: job.task.name, variant: job.variant.name, attempt: job.attempt, passed: false, score: 0, durationMs: 0, assertions: [{ type: 'infrastructure', pass: false, message: error.message }], files: [], diff: { additions: 0, deletions: 0, total: 0 }, usage: {}, exitCode: 1, timedOut: false, stdout: '', stderr: error.stack ?? error.message };
      onEvent({ type: 'trial:error', trial, index: jobIndex + 1, total: jobs.length });
      return trial;
    } finally {
      if (created && !keepWorktrees) await removeWorktree({ repository, destination: worktree, worktreeRoot }).catch(() => {});
    }
  });
  const variants = config.variants.map((variant) => {
    const trials = trialResults.filter((trial) => trial.variant === variant.name);
    return { name: variant.name, trials, summary: summarizeTrials(trials) };
  });
  const comparison = compareVariants(variants[0].summary, variants[1].summary);
  const jsonPath = path.join(artifactRoot, 'report.json');
  const htmlPath = path.join(artifactRoot, 'report.html');
  const report = { schemaVersion: 1, version: '0.1.0', runId, generatedAt: new Date().toISOString(), project: config.project, commit, instructionFile: config.instructionFile ?? 'AGENTS.md', agent: { provider: config.agent.provider, model: config.agent.model ?? null }, tasks: tasks.map(({ name }) => name), variants, comparison, artifacts: { json: jsonPath, html: htmlPath } };
  await writeJson(jsonPath, report);
  await import('node:fs/promises').then((fs) => fs.writeFile(htmlPath, renderHtmlReport(report), 'utf8'));
  if (!keepWorktrees) await rm(worktreeRoot, { recursive: true, force: true }).catch(() => {});
  onEvent({ type: 'experiment:complete', report });
  return report;
}
