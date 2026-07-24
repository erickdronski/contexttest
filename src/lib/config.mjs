import path from 'node:path';
import { exists, readJson } from './utils.mjs';

export const CONFIG_NAMES = ['contexttest.json', '.contexttest.json'];

export function createStarterConfig() {
  return {
    $schema: 'https://raw.githubusercontent.com/erickdronski/contexttest/main/schema/contexttest.schema.json',
    version: 1,
    project: 'my-project',
    baseRef: 'HEAD',
    instructionFile: 'AGENTS.md',
    agent: { provider: 'codex', timeoutMinutes: 20 },
    trials: { attempts: 3, concurrency: 1 },
    environment: { inherit: false, allow: [] },
    variants: [
      { name: 'baseline', disabled: true },
      { name: 'candidate', source: 'AGENTS.candidate.md' },
    ],
    tasks: [{
      name: 'focused-change',
      prompt: 'Implement the requested change. Keep the diff focused and run the relevant tests.',
      assertions: [
        { type: 'command', command: ['npm', 'test'] },
        { type: 'maxChangedFiles', value: 8 },
        { type: 'maxDiffLines', value: 250 },
      ],
    }],
  };
}

export async function findConfig(start = process.cwd(), explicit) {
  if (explicit) return path.resolve(start, explicit);
  let current = path.resolve(start);
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(current, name);
      if (await exists(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`No ContextTest configuration found. Run \`contexttest init\` or pass --config.`);
}

export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') return ['Configuration must be a JSON object.'];
  if (config.version !== 1) errors.push('version must be 1.');
  if (!config.project || typeof config.project !== 'string') errors.push('project must be a non-empty string.');
  if (!config.agent?.provider || !['codex', 'claude', 'command', 'mock'].includes(config.agent.provider)) errors.push('agent.provider must be codex, claude, command, or mock.');
  if (config.agent?.provider === 'command' && (!Array.isArray(config.agent.command) || config.agent.command.length === 0)) errors.push('agent.command must be a non-empty argument array for the command provider.');
  if (!Array.isArray(config.variants) || config.variants.length !== 2) errors.push('variants must contain exactly two variants.');
  for (const [index, variant] of (config.variants ?? []).entries()) {
    if (!variant.name) errors.push(`variants[${index}].name is required.`);
    const modes = [variant.disabled === true, typeof variant.source === 'string', typeof variant.content === 'string'].filter(Boolean).length;
    if (modes !== 1) errors.push(`variants[${index}] must set exactly one of disabled, source, or content.`);
  }
  if (!Array.isArray(config.tasks) || config.tasks.length === 0) errors.push('tasks must contain at least one task.');
  for (const [index, task] of (config.tasks ?? []).entries()) {
    if (!task.name) errors.push(`tasks[${index}].name is required.`);
    if (!task.prompt) errors.push(`tasks[${index}].prompt is required.`);
    if (task.assertions && !Array.isArray(task.assertions)) errors.push(`tasks[${index}].assertions must be an array.`);
  }
  const attempts = config.trials?.attempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 50) errors.push('trials.attempts must be an integer from 1 to 50.');
  const concurrency = config.trials?.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) errors.push('trials.concurrency must be an integer from 1 to 8.');
  return errors;
}

export async function loadConfig(start = process.cwd(), explicit) {
  const configPath = await findConfig(start, explicit);
  const config = await readJson(configPath);
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`Invalid ContextTest configuration:\n- ${errors.join('\n- ')}`);
  return { config, configPath, root: path.dirname(configPath) };
}
