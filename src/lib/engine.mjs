import { lstat, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { evaluateAssertions } from './assertions.mjs';
import { agentStartFailure, agentVersion, CLAUDE_BRIDGE_IMPORT, deliveryFor, deliveryWarning, describeInvocation, runAgent } from './adapters.mjs';
import { applyDeliveryBridge, applyVariant, assertGitRepository, createWorktree, currentCommit, readVariantInstructions, removeWorktree, snapshotTrialBaseline } from './git.mjs';
import { validateConfig, variantAgents } from './config.mjs';
import { renderHtmlReport } from './reporter.mjs';
import { assessTreatmentDelivery, compareVariants, pairTrials, summarizeTrials } from './stats.mjs';
import { ensureDir, environmentSecrets, isPathInside, redact, runProcess, safeEnvironment, seededShuffle, slug, stableStringify, timestampId, VERSION, writeJson } from './utils.mjs';

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

// What each arm's instruction file contains, without recording the text itself.
export async function describeInstructions({ root, variant }) {
  const content = await readVariantInstructions({ root, variant });
  const mode = variant.disabled ? 'disabled' : typeof variant.content === 'string' ? 'content' : 'source';
  return {
    mode,
    ...(mode === 'source' ? { source: variant.source } : {}),
    bytes: content?.length ?? 0,
    digest: content ? createHash('sha256').update(content).digest('hex') : null,
  };
}

export function deliveryWarnings(comparison) {
  if (comparison.treatmentDelivery !== 'doubtful') return [];
  return [{ code: 'treatment-delivery', message: `Treatment delivery is doubtful. ${comparison.deliveryCheck.reason} The evidence label is downgraded to "doubtful"; check the agent's instruction file before trusting any difference.` }];
}

// Every number in a report comes from here, so a stored report can be
// re-analyzed from its trials with exactly the rules that produced it.
export function analyzeExperiment({ variants, tasks, taskRefs = {}, provider }) {
  const summarized = variants.map((variant) => ({ ...variant, summary: summarizeTrials(variant.trials) }));
  const [left, right] = summarized;
  const checkDelivery = (trials) => {
    const side = (variant) => ({ name: variant.name, trials: trials.filter((trial) => trial.variant === variant.name), bytes: variant.instructions?.bytes, agent: variant.agent?.digest ?? 'shared', provider: variant.agent?.provider ?? provider });
    return assessTreatmentDelivery({ left: side(left), right: side(right) });
  };
  const compare = (trials) => {
    const summaries = summarized.map((variant) => summarizeTrials(trials.filter((trial) => trial.variant === variant.name)));
    return { summaries, comparison: compareVariants(summaries[0], summaries[1], pairTrials(trials, left.name, right.name), checkDelivery(trials)) };
  };
  const allTrials = summarized.flatMap((variant) => variant.trials);
  const taskResults = tasks.map((name) => {
    const { summaries, comparison } = compare(allTrials.filter((trial) => trial.task === name));
    return { name, ref: taskRefs[name], variants: summarized.map((variant, index) => ({ name: variant.name, summary: summaries[index] })), comparison };
  });
  return { variants: summarized, comparison: compare(allTrials).comparison, taskResults };
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

// What a report says about an arm's agent. The digest covers every setting,
// so two arms are "the same agent" only if nothing about them differs.
export function describeAgent(agent) {
  return { provider: agent.provider, model: agent.model ?? null, isolate: agent.isolate === true, digest: createHash('sha256').update(stableStringify(agent)).digest('hex').slice(0, 16) };
}

const agentLabel = (agent) => agent ? [agent.provider, agent.model].filter(Boolean).join(' · ') : 'unrecorded agent';

// Say plainly what differs between the two arms, so a verdict is never read
// as being about instructions when the agent changed too.
export function describeTreatment(left, right, agents = []) {
  const instructionsDiffer = left.instructions?.digest !== right.instructions?.digest;
  const [leftAgent, rightAgent] = agents;
  const settings = leftAgent && rightAgent
    ? [...new Set([...Object.keys(leftAgent), ...Object.keys(rightAgent)])].filter((key) => stableStringify(leftAgent[key]) !== stableStringify(rightAgent[key])).sort()
    : [];
  const agentDiffers = left.agent?.digest !== right.agent?.digest;
  const differs = [...(instructionsDiffer ? ['instructions'] : []), ...(agentDiffers ? ['agent'] : [])];
  const identity = left.agent?.provider !== right.agent?.provider || left.agent?.model !== right.agent?.model;
  const agentChange = identity ? `${agentLabel(left.agent)} vs ${agentLabel(right.agent)}` : `settings: ${settings.filter((key) => !['provider', 'model'].includes(key)).join(', ') || 'unrecorded'}`;
  let summary;
  if (instructionsDiffer && agentDiffers) summary = `Instructions and agent both differ (${agentChange}); the result cannot be attributed to either one alone.`;
  else if (agentDiffers) summary = `Only the agent differs (${agentChange}); both arms receive the same instructions.`;
  else if (instructionsDiffer) summary = `Only the instructions differ; both arms use ${agentLabel(left.agent)}.`;
  else summary = 'The arms are identical (an A/A comparison); any difference is run-to-run noise.';
  return { differs, agentSettings: settings, summary };
}

// Resolve refs, task selection, and the run's directories once, before any
// worktree exists, so a bad configuration fails fast and leaves nothing behind.
export async function prepareRun({ config, root, taskFilter, reportDir }) {
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
  return {
    repository, runId, stateRoot, worktreeBase, worktreeRoot, artifactRoot, tasks, taskRefs,
    commit: resolvedCommits.length === 1 ? resolvedCommits[0] : null,
    async createDirectories() {
      await ensureSafeStateDirectory(stateRoot, repository);
      await ensureSafeStateDirectory(worktreeBase, repository);
      if (!reportDir) await ensureSafeStateDirectory(reportBase, repository);
      await ensureDir(worktreeRoot); await ensureDir(artifactRoot);
    },
  };
}

// Jobs are (task, attempt, arm) tuples. Within one task and attempt every arm
// runs back to back, and the arm order reverses on even attempts so no arm
// systematically runs first. With a seed, the (task, attempt) blocks run in a
// reproducible random order, so slow drift over a long run is not lined up
// with the task list; each block still keeps its arms together.
export function scheduleTrials({ tasks, arms, attempts, seed = null }) {
  const blocks = [];
  for (const task of tasks) for (let attempt = 1; attempt <= attempts; attempt += 1) blocks.push({ task, attempt });
  const jobs = [];
  for (const { task, attempt } of seed === null ? blocks : seededShuffle(blocks, seed)) {
    const ordered = attempt % 2 ? arms : [...arms].reverse();
    for (const arm of ordered) jobs.push({ arm, variant: arm.variant, armIndex: arms.indexOf(arm), task, attempt });
  }
  return jobs;
}

export function trialOrder(config) {
  const seed = Number.isInteger(config.trials?.seed) ? config.trials.seed : null;
  return { order: seed === null ? 'sequential' : 'seeded', seed };
}

export async function runAgentVersions(agents, environment) {
  const seen = new Map();
  for (const agent of agents) {
    const executable = agent.executable ?? (agent.provider === 'command' ? agent.command[0] : agent.provider);
    const key = `${agent.provider}\u0000${executable}`;
    if (!seen.has(key)) seen.set(key, { provider: agent.provider, executable, version: await agentVersion(agent, environment) });
  }
  return [...seen.values()];
}

// Run every job in its own detached worktree. Any trial that fails before the
// agent could run invalidates the whole experiment.
export async function executeTrials({ config, root, run, jobs, keepWorktrees = false, onEvent = () => {} }) {
  const instructionFile = config.instructionFile ?? 'AGENTS.md';
  const trialResults = await pool(jobs, config.trials?.concurrency ?? 1, async (job, jobIndex) => {
    const { arm } = job;
    const id = `${slug(job.task.name)}-${slug(arm.name)}-${job.attempt}`;
    const worktree = path.join(run.worktreeRoot, id);
    onEvent({ type: 'trial:start', ...job, index: jobIndex + 1, total: jobs.length });
    let created = false;
    try {
      await createWorktree({ repository: run.repository, destination: worktree, ref: job.task.ref ?? config.baseRef ?? 'HEAD' });
      created = true;
      await applyVariant({ root, worktree, instructionFile, variant: arm.variant });
      const bridge = arm.delivery.method === 'bridged' ? await applyDeliveryBridge({ worktree, bridge: arm.delivery.bridge, importLine: CLAUDE_BRIDGE_IMPORT, target: instructionFile }) : null;
      await runSetupCommands(config, worktree);
      await snapshotTrialBaseline(worktree);
      const started = Date.now();
      const agentResult = await runAgent({ agent: arm.agent, prompt: job.task.prompt, cwd: worktree, environment: config.environment, mock: job.task.mock });
      const startFailure = agentStartFailure(arm.agent, agentResult);
      if (startFailure) throw new Error(startFailure);
      const evaluation = await evaluateAssertions({ assertions: job.task.assertions, worktree, agentResult, environment: config.environment });
      const trial = {
        id, task: job.task.name, variant: arm.name, attempt: job.attempt,
        passed: evaluation.passed, score: evaluation.score, durationMs: Date.now() - started,
        assertions: evaluation.results, files: evaluation.files, diff: evaluation.diff,
        usage: agentResult.usage, exitCode: agentResult.code, timedOut: agentResult.timedOut,
        stdout: agentResult.stdout.slice(-10_000), stderr: agentResult.stderr.slice(-10_000),
        ...(bridge ? { bridge } : {}),
      };
      onEvent({ type: 'trial:complete', trial, index: jobIndex + 1, total: jobs.length });
      return trial;
    } catch (error) {
      const trial = { id, task: job.task.name, variant: arm.name, attempt: job.attempt, passed: false, score: 0, durationMs: 0, infrastructureError: true, assertions: [{ type: 'infrastructure', pass: false, message: error.message }], files: [], diff: { additions: 0, deletions: 0, total: 0 }, usage: {}, exitCode: 1, timedOut: false, stdout: '', stderr: error.stack ?? error.message };
      onEvent({ type: 'trial:error', trial, index: jobIndex + 1, total: jobs.length });
      return trial;
    } finally {
      if (created && !keepWorktrees) await removeWorktree({ repository: run.repository, destination: worktree, worktreeRoot: run.worktreeRoot }).catch(() => {});
    }
  });
  const infrastructureFailures = trialResults.filter((trial) => trial.infrastructureError);
  if (infrastructureFailures.length) {
    if (!keepWorktrees) await rm(run.worktreeRoot, { recursive: true, force: true }).catch(() => {});
    const first = infrastructureFailures[0].assertions[0].message;
    throw new Error(`${infrastructureFailures.length} trial(s) failed before the agent could run. The experiment is invalid.\nFirst failure: ${first}`);
  }
  return trialResults;
}

export async function writeReport({ run, report, render, keepWorktrees = false }) {
  await writeJson(report.artifacts.json, report);
  await writeFile(report.artifacts.html, render(report), 'utf8');
  if (!keepWorktrees) await rm(run.worktreeRoot, { recursive: true, force: true }).catch(() => {});
}

export function configDigest(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export function runtimeMetadata(agents) {
  return { node: process.version, platform: os.platform(), arch: os.arch(), agents };
}

export async function runExperiment({ config, root, taskFilter, keepWorktrees = false, reportDir, onEvent = () => {} }) {
  const configErrors = validateConfig(config);
  if (configErrors.length) throw new Error(`Invalid ContextTest configuration:\n- ${configErrors.join('\n- ')}`);
  const run = await prepareRun({ config, root, taskFilter, reportDir });
  const instructionFile = config.instructionFile ?? 'AGENTS.md';
  const agents = variantAgents(config);
  const instructions = await Promise.all(config.variants.map((variant) => describeInstructions({ root, variant })));
  const arms = config.variants.map((variant, index) => ({ name: variant.name, variant, agent: agents[index], delivery: deliveryFor(agents[index].provider, instructionFile) }));
  const agentRuntime = await runAgentVersions(agents, config.environment);
  await run.createDirectories();
  const attempts = config.trials?.attempts ?? 3;
  const order = trialOrder(config);
  const jobs = scheduleTrials({ tasks: run.tasks, arms, attempts, seed: order.seed });
  onEvent({ type: 'experiment:start', runId: run.runId, jobs: jobs.length, ...order });
  const trialResults = await executeTrials({ config, root, run, jobs, keepWorktrees, onEvent });
  const { variants, comparison, taskResults } = analyzeExperiment({
    variants: arms.map((arm, index) => ({
      name: arm.name,
      agent: describeAgent(arm.agent),
      instructions: instructions[index],
      delivery: { file: arm.delivery.file, method: arm.delivery.method, bridgedVia: arm.delivery.bridgedVia },
      invocation: describeInvocation(arm.agent, config.environment),
      trials: trialResults.filter((trial) => trial.variant === arm.name),
    })),
    tasks: run.tasks.map(({ name }) => name),
    taskRefs: run.taskRefs,
    provider: config.agent.provider,
  });
  const deliveryMessages = [...new Set(arms.map((arm) => deliveryWarning(arm.agent.provider, arm.delivery)).filter(Boolean))];
  const treatment = describeTreatment(variants[0], variants[1], agents);
  const report = {
    schemaVersion: 1,
    version: VERSION,
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    project: config.project,
    commit: run.commit,
    taskRefs: run.taskRefs,
    instructionFile,
    agent: { provider: config.agent.provider, model: config.agent.model ?? null, isolate: config.agent.isolate === true },
    experiment: {
      attemptsPerVariant: attempts,
      concurrency: config.trials?.concurrency ?? 1,
      setupCommands: config.setup?.commands?.length ?? 0,
      configDigest: configDigest(config),
      ...order,
    },
    runtime: runtimeMetadata(agentRuntime),
    tasks: run.tasks.map(({ name }) => name),
    taskResults,
    variants,
    treatment,
    comparison,
    warnings: [
      ...deliveryMessages.map((message) => ({ code: 'delivery', message })),
      ...(treatment.differs.length === 2 ? [{ code: 'confounded', message: treatment.summary }] : []),
      ...deliveryWarnings(comparison),
    ],
    artifacts: { json: path.join(run.artifactRoot, 'report.json'), html: path.join(run.artifactRoot, 'report.html') },
  };
  await writeReport({ run, report, render: renderHtmlReport, keepWorktrees });
  onEvent({ type: 'experiment:complete', report });
  return report;
}
