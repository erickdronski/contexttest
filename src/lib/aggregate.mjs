import { randomBytes } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeExperiment, deliveryWarnings, ensureSafeStateDirectory } from './engine.mjs';
import { agentLabel, renderAggregateHtml, reportKind } from './reporter.mjs';
import { ensureDir, slug, timestampId, VERSION, writeJson } from './utils.mjs';

// Pool several experiment reports of the same experiment into one paired
// analysis. Pairs never cross runs: attempts are renumbered per source run, so
// the pooled exact test only counts disagreements between arms that ran side
// by side. Each source is also analyzed on its own, so disagreement between
// runs stays visible instead of being averaged away.

const unique = (values) => [...new Set(values.map((value) => JSON.stringify(value ?? null)))].map((value) => JSON.parse(value));
const sameSet = (left, right) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);

function validateSource({ path, report }) {
  const kind = reportKind(report);
  if (kind !== 'experiment') throw new Error(`${path} is an ${kind} report; aggregate pools experiment reports from \`contexttest run\`.`);
  const complete = Array.isArray(report.variants) && report.variants.length === 2
    && report.variants.every((variant) => typeof variant?.name === 'string' && Array.isArray(variant.trials) && variant.trials.every((trial) => typeof trial?.task === 'string' && Number.isInteger(trial.attempt) && typeof trial.passed === 'boolean'))
    && Array.isArray(report.tasks) && typeof report.runId === 'string';
  if (!complete) throw new Error(`${path} is not a complete experiment report: it needs two variants with trials, a task list, and a runId.`);
}

// Keep what the pooled analysis needs. Diagnostics stay in the source reports.
function compactTrial(trial, source, offset) {
  return {
    source, task: trial.task, variant: trial.variant, attempt: offset + trial.attempt, sourceAttempt: trial.attempt,
    passed: trial.passed, score: trial.score, durationMs: trial.durationMs, files: trial.files ?? [],
    diff: trial.diff ?? { additions: 0, deletions: 0, total: 0 }, usage: trial.usage ?? {},
  };
}

// One description of each arm's agent and instructions across every source:
// when they disagree, the pooled arm says so rather than borrowing one run's.
function pooledArm(name, sources, index) {
  const agents = sources.map(({ report }) => report.variants[index].agent ?? { ...report.agent, isolate: report.agent?.isolate ?? false, digest: null });
  const agentDigests = unique(agents.map((agent) => agent.digest ?? `${agent.provider}\u0000${agent.model ?? ''}`));
  const instructions = sources.map(({ report }) => report.variants[index].instructions ?? null);
  const digests = unique(instructions.map((entry) => entry?.digest ?? null));
  const recorded = instructions.every(Boolean);
  return {
    name,
    agent: agentDigests.length === 1 ? agents[0] : { provider: 'mixed', model: null, isolate: false, digest: `mixed-${index}` },
    agents: unique(agents.map(agentLabel)),
    instructions: recorded && digests.length === 1 ? instructions[0] : null,
    consistency: { agents: agentDigests.length, instructionDigests: recorded ? digests.length : null },
  };
}

function heterogeneityOf(sources, variants) {
  const leaders = { candidate: 0, baseline: 0, tie: 0 };
  for (const source of sources) leaders[source.comparison.winner] += 1;
  const deltas = sources.map((source) => source.comparison.passRateDelta);
  const [baseline, candidate] = variants.map((variant) => variant.name);
  const favour = (count, name) => `${count} favour${count === 1 ? 's' : ''} ${name}`;
  const parts = [leaders.candidate && favour(leaders.candidate, candidate), leaders.baseline && favour(leaders.baseline, baseline), leaders.tie && `${leaders.tie} show${leaders.tie === 1 ? 's' : ''} no clear leader`].filter(Boolean);
  const disagreement = leaders.candidate > 0 && leaders.baseline > 0;
  let summary;
  if (disagreement) summary = `Runs disagree: ${parts.join(', ')}. The pooled result averages over that disagreement.`;
  else if (leaders.tie === sources.length) summary = `No run shows a clear leader on its own.`;
  else summary = `No run contradicts another: ${parts.join(', ')}.`;
  return { leaders, disagreement, passRateDeltaRange: [Math.min(...deltas), Math.max(...deltas)], summary };
}

function compatibilityWarnings(sources, variants) {
  const warnings = [];
  const add = (code, message) => warnings.push({ code, message });
  const reports = sources.map(({ report }) => report);
  const projects = unique(reports.map((report) => report.project));
  if (projects.length > 1) add('project', `Source runs name different projects: ${projects.join(', ')}.`);
  const versions = unique(reports.map((report) => report.version));
  if (versions.length > 1) add('version', `Source runs were produced by different ContextTest versions: ${versions.join(', ')}.`);
  const digests = unique(reports.map((report) => report.experiment?.configDigest));
  if (digests.length > 1) add('config', `Configuration digests differ across source runs (${digests.length} distinct); check that nothing but the sample size changed.`);
  for (const variant of variants) {
    if (variant.consistency.agents > 1) add('agent', `The ${variant.name} arm used different agents across runs: ${variant.agents.join('; ')}.`);
    if (variant.consistency.instructionDigests > 1) add('instructions', `The ${variant.name} arm's instructions differ across runs (${variant.consistency.instructionDigests} distinct digests); the pooled result mixes treatments.`);
    if (variant.consistency.instructionDigests === null) add('instructions', `Some source runs predate instruction digests, so it cannot be confirmed that the ${variant.name} arm's instructions stayed the same.`);
  }
  const refs = unique(reports.map((report) => report.taskRefs ?? null));
  if (refs.length > 1) add('task-refs', 'Task refs differ across source runs; the pooled result mixes repository states.');
  const flagged = sources.filter(({ report }) => (report.warnings ?? []).length);
  if (flagged.length) add('source-warnings', `${flagged.length} source run(s) carried warnings of their own; see the source breakdown.`);
  return warnings;
}

export function aggregateReports(inputs) {
  if (inputs.length < 2) throw new Error('aggregate needs at least two experiment reports to pool.');
  for (const input of inputs) validateSource(input);
  const [first] = inputs;
  const names = first.report.variants.map((variant) => variant.name);
  for (const { path, report } of inputs.slice(1)) {
    const other = report.variants.map((variant) => variant.name);
    if (other.join('\u0000') !== names.join('\u0000')) throw new Error(`Variants differ: ${first.path} compares ${names.join(' → ')}; ${path} compares ${other.join(' → ')}. Pooling requires the same baseline and candidate names in the same order.`);
    if (!sameSet(report.tasks, first.report.tasks)) throw new Error(`Tasks differ: ${first.path} ran ${first.report.tasks.join(', ')}; ${path} ran ${report.tasks.join(', ')}. Pool runs of the same task set.`);
  }
  const runIds = inputs.map(({ report }) => report.runId);
  const repeated = runIds.find((runId, index) => runIds.indexOf(runId) !== index);
  if (repeated) throw new Error(`Run ${repeated} appears more than once; pooling it twice would double-count its trials.`);

  const tasks = first.report.tasks;
  const variants = names.map((name, index) => pooledArm(name, inputs, index));
  const provider = variants[0].agent.provider === variants[1].agent.provider ? variants[0].agent.provider : undefined;
  let offset = 0;
  const pooledTrials = [];
  const sources = inputs.map(({ path, report }) => {
    const trials = report.variants.flatMap((variant) => variant.trials);
    pooledTrials.push(...trials.map((trial) => compactTrial(trial, report.runId, offset)));
    offset += Math.max(...trials.map((trial) => trial.attempt));
    const analysis = analyzeExperiment({
      variants: report.variants.map((variant) => ({ name: variant.name, agent: variant.agent, instructions: variant.instructions, trials: variant.trials })),
      tasks, taskRefs: report.taskRefs, provider: report.agent?.provider,
    });
    return {
      runId: report.runId,
      report: path,
      generatedAt: report.generatedAt ?? null,
      version: report.version ?? null,
      project: report.project,
      commit: report.commit ?? null,
      configDigest: report.experiment?.configDigest ?? null,
      order: report.experiment?.order ?? 'sequential',
      seed: report.experiment?.seed ?? null,
      agents: report.variants.map((variant) => agentLabel(variant.agent ?? report.agent)),
      variants: analysis.variants.map(({ name, summary }) => ({ name, summary })),
      comparison: analysis.comparison,
      taskResults: analysis.taskResults.map(({ name, variants: taskVariants, comparison }) => ({ name, passRates: taskVariants.map((variant) => variant.summary.passRate), winner: comparison.winner, pValue: comparison.pValue })),
      warnings: report.warnings ?? [],
    };
  });
  const pooled = analyzeExperiment({
    variants: variants.map(({ name, agent, instructions }) => ({ name, agent, instructions, trials: pooledTrials.filter((trial) => trial.variant === name) })),
    tasks, provider,
  });
  const treatments = unique(inputs.map(({ report }) => report.treatment?.summary ?? null));
  const treatment = treatments.length === 1 && treatments[0] !== null ? first.report.treatment : null;
  const heterogeneity = heterogeneityOf(sources, variants);
  const commits = unique(inputs.map(({ report }) => report.commit ?? null));
  const projects = unique(inputs.map(({ report }) => report.project));
  return {
    schemaVersion: 1,
    kind: 'aggregate',
    version: VERSION,
    aggregateId: `${timestampId()}-${slug(projects[0])}-aggregate-${randomBytes(2).toString('hex')}`,
    generatedAt: new Date().toISOString(),
    project: projects.join(' + '),
    commit: commits.length === 1 ? commits[0] : null,
    instructionFile: first.report.instructionFile ?? 'AGENTS.md',
    tasks,
    sources,
    variants: pooled.variants.map(({ name, agent, instructions, trials, summary }, index) => ({ name, agent, agents: variants[index].agents, instructions, trials, summary })),
    treatment,
    comparison: pooled.comparison,
    taskResults: pooled.taskResults,
    heterogeneity,
    warnings: [
      ...compatibilityWarnings(inputs, variants),
      ...(treatments.length > 1 ? [{ code: 'treatment', message: 'Source runs describe their treatments differently; the pooled comparison has no single treatment.' }] : []),
      ...(heterogeneity.disagreement ? [{ code: 'heterogeneity', message: heterogeneity.summary }] : []),
      ...deliveryWarnings(pooled.comparison),
    ],
  };
}

export async function loadReports(files, cwd = process.cwd()) {
  return Promise.all(files.map(async (file) => {
    const absolute = path.resolve(cwd, file);
    let report;
    try { report = JSON.parse(await readFile(absolute, 'utf8')); }
    catch (error) { throw new Error(`Could not read ${file} as a JSON report: ${error.message}`); }
    return { path: path.relative(cwd, absolute).split(path.sep).join('/') || file, absolute, report };
  }));
}

const realOrResolved = async (target) => { try { return await realpath(target); } catch { return path.resolve(target); } };

// Default output lives under .contexttest/aggregates with the same symlink and
// containment checks as run reports. Writing into a source report's directory
// would overwrite that report, so it is refused.
export async function writeAggregate({ report, inputs, out, cwd = process.cwd() }) {
  let directory;
  if (out) directory = path.resolve(cwd, out);
  else {
    const stateRoot = path.join(cwd, '.contexttest');
    const base = path.join(stateRoot, 'aggregates');
    await ensureSafeStateDirectory(stateRoot, cwd);
    await ensureSafeStateDirectory(base, cwd);
    directory = path.join(base, report.aggregateId);
  }
  const target = await realOrResolved(directory);
  for (const input of inputs) {
    if (await realOrResolved(path.dirname(input.absolute)) === target) throw new Error(`Refusing to write the aggregate into ${directory}: it holds the source report ${input.path}, which would be overwritten. Choose another --out directory.`);
  }
  await ensureDir(directory);
  report.artifacts = { json: path.join(directory, 'report.json'), html: path.join(directory, 'report.html') };
  await writeJson(report.artifacts.json, report);
  await writeFile(report.artifacts.html, renderAggregateHtml(report), 'utf8');
  return report;
}
