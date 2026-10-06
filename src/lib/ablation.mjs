import { createHash } from 'node:crypto';
import path from 'node:path';
import { deliveryFor, deliveryWarning, describeInvocation } from './adapters.mjs';
import { validateConfig, variantAgents } from './config.mjs';
import { configDigest, describeAgent, executeTrials, prepareRun, runAgentVersions, runtimeMetadata, scheduleTrials, trialOrder, writeReport } from './engine.mjs';
import { readVariantInstructions } from './git.mjs';
import { renderAblationHtml } from './reporter.mjs';
import { selectSections, splitSections, withoutSection } from './sections.mjs';
import { assessTreatmentDelivery, compareVariants, holmAdjust, pairTrials, signalFor, summarizeTrials } from './stats.mjs';
import { redact, VERSION } from './utils.mjs';

const FULL = 'full';
const digest = (text) => createHash('sha256').update(text).digest('hex');
const delta = (full, without) => Number.isFinite(full) && Number.isFinite(without) ? full - without : null;

// Everything about an ablation that can be known without running an agent:
// which file, which sections, which arms, and what the run will cost.
export async function planAblation({ config, root, variantName, level = 2, sections, taskFilter }) {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`Invalid ContextTest configuration:\n- ${errors.join('\n- ')}`);
  const names = config.variants.map((variant) => variant.name);
  const index = variantName === undefined ? [1, 0].find((candidate) => !config.variants[candidate].disabled) : names.indexOf(variantName);
  if (index === undefined) throw new Error('Both variants are disabled, so there are no instructions to ablate.');
  if (index === -1) throw new Error(`No variant named ${variantName}. Variants: ${names.join(', ')}.`);
  const variant = config.variants[index];
  if (variant.disabled) throw new Error(`Variant ${variant.name} is disabled, so it has no instructions to ablate.`);
  const text = (await readVariantInstructions({ root, variant })).toString('utf8');
  const split = splitSections(text, level);
  const label = variant.source ?? `${variant.name} (inline content)`;
  if (!split.sections.length) {
    const found = Object.entries(split.headingCounts).map(([depth, count]) => `${count} at level ${depth}`).join(', ');
    throw new Error(`${label} has no level-${level} headings to ablate${found ? ` (headings found: ${found}); choose one of those levels with --level` : '; ablation splits a file at its Markdown headings'}.`);
  }
  const selected = selectSections(split.sections, sections, level);
  const tasks = taskFilter ? config.tasks.filter((task) => task.name === taskFilter) : config.tasks;
  if (!tasks.length) throw new Error(`No task named ${taskFilter}.`);
  const attempts = config.trials?.attempts ?? 3;
  const arms = [
    { name: FULL, section: null, content: text },
    ...selected.map((section) => ({ name: `without-${section.index}`, section, content: withoutSection(split, section.index) })),
  ];
  return {
    variant, variantIndex: index, label, level, split, selected, tasks, arms,
    agent: variantAgents(config)[index],
    budget: {
      arms: arms.length, tasks: tasks.length, attempts,
      trials: arms.length * tasks.length * attempts,
      // Running each section as its own A/B experiment would repeat the full arm.
      separateExperiments: 2 * selected.length * tasks.length * attempts,
    },
  };
}

// Every effect compares the file without one section (left) with the full
// file (right), paired by task and attempt against the one shared full arm.
// A positive delta means the section helps.
export function analyzeAblation({ arms, tasks, taskRefs = {}, provider }) {
  const summarized = arms.map((arm) => ({ ...arm, summary: summarizeTrials(arm.trials) }));
  const [full, ...ablated] = summarized;
  const allTrials = summarized.flatMap((arm) => arm.trials);
  const compare = (arm, trials) => {
    const own = trials.filter((trial) => trial.variant === arm.name);
    const reference = trials.filter((trial) => trial.variant === full.name);
    const [without, withSection] = [summarizeTrials(own), summarizeTrials(reference)];
    const delivery = assessTreatmentDelivery({
      left: { name: arm.name, trials: own, bytes: arm.instructions?.bytes, agent: 'shared', provider },
      right: { name: full.name, trials: reference, bytes: full.instructions?.bytes, agent: 'shared', provider },
    });
    return { without, withSection, comparison: compareVariants(without, withSection, pairTrials(trials, arm.name, full.name), delivery) };
  };
  const effects = ablated.map((arm) => {
    const { without, withSection, comparison } = compare(arm, allTrials);
    return {
      arm: arm.name,
      section: arm.section,
      deltas: {
        passRate: delta(withSection.passRate, without.passRate),
        assertionScore: delta(withSection.meanAssertionScore, without.meanAssertionScore),
        medianDurationMs: delta(withSection.medianDurationMs, without.medianDurationMs),
        medianDiffLines: delta(withSection.medianDiffLines, without.medianDiffLines),
        medianChangedFiles: delta(withSection.medianChangedFiles, without.medianChangedFiles),
        medianInputTokens: delta(withSection.medianInputTokens, without.medianInputTokens),
        medianCostUsd: delta(withSection.medianCostUsd, without.medianCostUsd),
      },
      comparison,
      taskResults: tasks.map((name) => {
        const result = compare(arm, allTrials.filter((trial) => trial.task === name));
        return { name, ref: taskRefs[name], passRates: [result.without.passRate, result.withSection.passRate], comparison: result.comparison };
      }),
    };
  });
  const adjusted = holmAdjust(effects.map((effect) => effect.comparison.pValue));
  // A reading needs a difference in success or adherence. Duration, diff size,
  // tokens, and cost stay visible as deltas, but a median over a few runs is
  // too noisy to call a section helpful or harmful on its own, and across
  // several sections such calls would mostly be chance.
  for (const [index, effect] of effects.entries()) {
    const { winner, basis, signal, minimumAttempts } = effect.comparison;
    const decided = basis === 'success' || basis === 'adherence';
    effect.reading = !decided ? 'no clear effect' : winner === 'candidate' ? 'helps' : 'hurts';
    effect.adjustedPValue = adjusted[index];
    effect.signal = signal === 'doubtful' ? 'doubtful' : signalFor(minimumAttempts, adjusted[index]);
  }
  return { arms: summarized, effects };
}

export async function runAblation({ config, root, variantName, level = 2, sections, taskFilter, keepWorktrees = false, reportDir, onEvent = () => {} }) {
  const plan = await planAblation({ config, root, variantName, level, sections, taskFilter });
  const run = await prepareRun({ config, root, taskFilter, reportDir });
  const instructionFile = config.instructionFile ?? 'AGENTS.md';
  const delivery = deliveryFor(plan.agent.provider, instructionFile);
  const arms = plan.arms.map((arm) => ({ ...arm, variant: { name: arm.name, content: arm.content }, agent: plan.agent, delivery }));
  const agentRuntime = await runAgentVersions([plan.agent], config.environment);
  await run.createDirectories();
  const order = trialOrder(config);
  const jobs = scheduleTrials({ tasks: run.tasks, arms, attempts: plan.budget.attempts, seed: order.seed });
  onEvent({ type: 'ablation:start', runId: run.runId, jobs: jobs.length, budget: plan.budget, ...order });
  const trialResults = await executeTrials({ config, root, run, jobs, keepWorktrees, onEvent });
  const title = (section) => section && { index: section.index, title: redact(section.title), lines: section.lines, bytes: section.bytes };
  const { arms: analyzedArms, effects } = analyzeAblation({
    arms: arms.map((arm) => ({
      name: arm.name,
      section: title(arm.section),
      instructions: { bytes: Buffer.byteLength(arm.content), digest: digest(arm.content) },
      trials: trialResults.filter((trial) => trial.variant === arm.name),
    })),
    tasks: run.tasks.map(({ name }) => name),
    taskRefs: run.taskRefs,
    provider: plan.agent.provider,
  });
  const report = {
    schemaVersion: 1,
    kind: 'ablation',
    version: VERSION,
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    project: config.project,
    commit: run.commit,
    taskRefs: run.taskRefs,
    instructionFile,
    agent: describeAgent(plan.agent),
    delivery: { file: delivery.file, method: delivery.method, bridgedVia: delivery.bridgedVia },
    invocation: describeInvocation(plan.agent, config.environment),
    ablation: {
      variant: plan.variant.name,
      source: plan.variant.source ?? null,
      level: plan.level,
      bytes: Buffer.byteLength(plan.split.text),
      digest: digest(plan.split.text),
      preamble: plan.split.preamble,
      sections: plan.split.sections.map((section) => ({ ...title(section), line: section.line, selected: plan.selected.includes(section) })),
    },
    experiment: {
      attemptsPerArm: plan.budget.attempts,
      concurrency: config.trials?.concurrency ?? 1,
      setupCommands: config.setup?.commands?.length ?? 0,
      configDigest: configDigest(config),
      ...order,
      plannedTrials: plan.budget.trials,
    },
    runtime: runtimeMetadata(agentRuntime),
    tasks: run.tasks.map(({ name }) => name),
    arms: analyzedArms,
    effects,
    warnings: [
      ...[deliveryWarning(plan.agent.provider, delivery)].filter(Boolean).map((message) => ({ code: 'delivery', message })),
      ...effects.filter((effect) => effect.comparison.treatmentDelivery === 'doubtful').map((effect) => ({ code: 'treatment-delivery', message: `Treatment delivery is doubtful for §${effect.section.index} ${effect.section.title}. ${effect.comparison.deliveryCheck.reason}` })),
    ],
    artifacts: { json: path.join(run.artifactRoot, 'report.json'), html: path.join(run.artifactRoot, 'report.html') },
  };
  await writeReport({ run, report, render: renderAblationHtml, keepWorktrees });
  onEvent({ type: 'ablation:complete', report });
  return report;
}
