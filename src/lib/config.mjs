import path from 'node:path';
import { exists, readJson, slug } from './utils.mjs';

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
    setup: { commands: [], timeoutMinutes: 10 },
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
  const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
  const stringArray = (value) => Array.isArray(value) && value.every(nonEmpty);
  const commandArray = (value) => Array.isArray(value) && value.length > 0 && nonEmpty(value[0]) && value.slice(1).every((item) => typeof item === 'string');
  const boundedNumber = (value, minimum, maximum) => Number.isFinite(value) && value > minimum && value <= maximum;
  const safeRelativePath = (value) => {
    if (!nonEmpty(value) || path.isAbsolute(value)) return false;
    const normalized = path.normalize(value);
    return normalized !== '.' && normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
  };
  const duplicateValues = (items) => [...new Set(items.filter((value, index) => items.indexOf(value) !== index))];
  const assertionTypes = new Set(['command', 'maxChangedFiles', 'minChangedFiles', 'maxDiffLines', 'allowedPaths', 'forbiddenPaths', 'requiredFile', 'forbiddenFile', 'fileContains', 'stdoutContains', 'stdoutNotContains']);
  const topLevel = new Set(['$schema', 'version', 'project', 'baseRef', 'instructionFile', 'agent', 'trials', 'setup', 'environment', 'variants', 'tasks']);
  for (const name of Object.keys(config)) if (!topLevel.has(name)) errors.push(`Unknown top-level property: ${name}.`);
  if (config.version !== 1) errors.push('version must be 1.');
  if (!nonEmpty(config.project)) errors.push('project must be a non-empty string.');
  if (config.baseRef !== undefined && !nonEmpty(config.baseRef)) errors.push('baseRef must be a non-empty string.');
  if (config.instructionFile !== undefined && !safeRelativePath(config.instructionFile)) errors.push('instructionFile must be a relative path inside the repository.');
  if (!config.agent || typeof config.agent !== 'object' || Array.isArray(config.agent)) errors.push('agent must be an object.');
  if (!config.agent?.provider || !['codex', 'claude', 'command', 'mock'].includes(config.agent.provider)) errors.push('agent.provider must be codex, claude, command, or mock.');
  if (config.agent?.executable !== undefined && !nonEmpty(config.agent.executable)) errors.push('agent.executable must be a non-empty string.');
  if (config.agent?.model !== undefined && !nonEmpty(config.agent.model)) errors.push('agent.model must be a non-empty string.');
  if (config.agent?.ignoreUserConfig !== undefined && typeof config.agent.ignoreUserConfig !== 'boolean') errors.push('agent.ignoreUserConfig must be a boolean.');
  if (config.agent?.provider === 'command' && !commandArray(config.agent.command)) errors.push('agent.command must be a non-empty string argument array for the command provider.');
  if (config.agent?.timeoutMinutes !== undefined && !boundedNumber(config.agent.timeoutMinutes, 0, 1440)) errors.push('agent.timeoutMinutes must be greater than 0 and no more than 1440.');
  if (config.agent?.maxTurns !== undefined && (!Number.isInteger(config.agent.maxTurns) || config.agent.maxTurns < 1 || config.agent.maxTurns > 1000)) errors.push('agent.maxTurns must be an integer from 1 to 1000.');
  if (config.agent?.permissionMode !== undefined && !['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(config.agent.permissionMode)) errors.push('agent.permissionMode is not supported.');
  if (config.agent?.allowedTools !== undefined && !stringArray(config.agent.allowedTools)) errors.push('agent.allowedTools must contain only non-empty strings.');
  if (config.agent?.disallowedTools !== undefined && !stringArray(config.agent.disallowedTools)) errors.push('agent.disallowedTools must contain only non-empty strings.');
  if (!Array.isArray(config.variants) || config.variants.length !== 2) errors.push('variants must contain exactly two variants.');
  const variants = Array.isArray(config.variants) ? config.variants : [];
  for (const [index, variant] of variants.entries()) {
    if (!variant || typeof variant !== 'object') { errors.push(`variants[${index}] must be an object.`); continue; }
    if (!nonEmpty(variant.name)) errors.push(`variants[${index}].name is required.`);
    const modes = [variant.disabled === true, typeof variant.source === 'string', typeof variant.content === 'string'].filter(Boolean).length;
    if (modes !== 1) errors.push(`variants[${index}] must set exactly one of disabled, source, or content.`);
    if (typeof variant.source === 'string' && !safeRelativePath(variant.source)) errors.push(`variants[${index}].source must be a relative path inside the project root.`);
  }
  const variantNames = variants.map((variant) => variant?.name).filter(nonEmpty);
  if (duplicateValues(variantNames).length) errors.push('variant names must be unique.');
  if (duplicateValues(variantNames.map(slug)).length) errors.push('variant names must remain unique after filesystem-safe normalization.');
  if (!Array.isArray(config.tasks) || config.tasks.length === 0) errors.push('tasks must contain at least one task.');
  const tasks = Array.isArray(config.tasks) ? config.tasks : [];
  for (const [index, task] of tasks.entries()) {
    if (!task || typeof task !== 'object') { errors.push(`tasks[${index}] must be an object.`); continue; }
    if (!nonEmpty(task.name)) errors.push(`tasks[${index}].name is required.`);
    if (!nonEmpty(task.prompt)) errors.push(`tasks[${index}].prompt is required.`);
    if (task.ref !== undefined && !nonEmpty(task.ref)) errors.push(`tasks[${index}].ref must be a non-empty string.`);
    if (task.assertions && !Array.isArray(task.assertions)) errors.push(`tasks[${index}].assertions must be an array.`);
    if (config.agent?.provider === 'mock' && !commandArray(task.mock?.command)) errors.push(`tasks[${index}].mock.command must be a non-empty string argument array for the mock provider.`);
    for (const [assertionIndex, assertion] of (Array.isArray(task.assertions) ? task.assertions : []).entries()) {
      const prefix = `tasks[${index}].assertions[${assertionIndex}]`;
      if (!assertion || typeof assertion !== 'object' || !assertionTypes.has(assertion.type)) {
        errors.push(`${prefix}.type is not supported.`);
        continue;
      }
      if (assertion.label !== undefined && !nonEmpty(assertion.label)) errors.push(`${prefix}.label must be a non-empty string.`);
      if (assertion.type === 'command') {
        if (!commandArray(assertion.command)) errors.push(`${prefix}.command must be a non-empty string argument array.`);
        if (assertion.exitCode !== undefined && !Number.isInteger(assertion.exitCode)) errors.push(`${prefix}.exitCode must be an integer.`);
        if (assertion.timeoutMinutes !== undefined && !boundedNumber(assertion.timeoutMinutes, 0, 1440)) errors.push(`${prefix}.timeoutMinutes must be greater than 0 and no more than 1440.`);
      }
      if (['maxChangedFiles', 'minChangedFiles', 'maxDiffLines'].includes(assertion.type) && (!Number.isInteger(assertion.value) || assertion.value < 0)) errors.push(`${prefix}.value must be a non-negative integer.`);
      if (['allowedPaths', 'forbiddenPaths'].includes(assertion.type) && (!stringArray(assertion.patterns) || assertion.patterns.length === 0)) errors.push(`${prefix}.patterns must contain at least one non-empty string.`);
      if (['requiredFile', 'forbiddenFile', 'fileContains'].includes(assertion.type) && !safeRelativePath(assertion.path)) errors.push(`${prefix}.path must be relative and stay inside the repository.`);
      if (['fileContains', 'stdoutContains', 'stdoutNotContains'].includes(assertion.type) && !nonEmpty(assertion.value)) errors.push(`${prefix}.value must be a non-empty string.`);
    }
  }
  const taskNames = tasks.map((task) => task?.name).filter(nonEmpty);
  if (duplicateValues(taskNames).length) errors.push('task names must be unique.');
  if (duplicateValues(taskNames.map(slug)).length) errors.push('task names must remain unique after filesystem-safe normalization.');
  const attempts = config.trials?.attempts ?? 3;
  if (config.trials !== undefined && (!config.trials || typeof config.trials !== 'object' || Array.isArray(config.trials))) errors.push('trials must be an object.');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 50) errors.push('trials.attempts must be an integer from 1 to 50.');
  const concurrency = config.trials?.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) errors.push('trials.concurrency must be an integer from 1 to 8.');
  if (config.setup !== undefined) {
    if (!config.setup || typeof config.setup !== 'object' || !Array.isArray(config.setup.commands)) errors.push('setup.commands must be an array of command argument arrays.');
    else for (const [index, command] of config.setup.commands.entries()) if (!commandArray(command)) errors.push(`setup.commands[${index}] must be a non-empty string argument array.`);
    if (config.setup?.timeoutMinutes !== undefined && !boundedNumber(config.setup.timeoutMinutes, 0, 1440)) errors.push('setup.timeoutMinutes must be greater than 0 and no more than 1440.');
  }
  if (config.environment !== undefined) {
    if (!config.environment || typeof config.environment !== 'object' || Array.isArray(config.environment)) errors.push('environment must be an object.');
    if (config.environment?.inherit !== undefined && typeof config.environment.inherit !== 'boolean') errors.push('environment.inherit must be a boolean.');
    const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (const key of ['allow', 'deny']) if (config.environment?.[key] !== undefined && (!Array.isArray(config.environment[key]) || config.environment[key].some((name) => typeof name !== 'string' || !variableName.test(name)))) errors.push(`environment.${key} must contain valid environment variable names.`);
    if (config.environment?.set !== undefined && (!config.environment.set || typeof config.environment.set !== 'object' || Array.isArray(config.environment.set) || Object.values(config.environment.set).some((value) => !['string', 'number', 'boolean'].includes(typeof value)))) errors.push('environment.set values must be strings, numbers, or booleans.');
    if (config.environment?.set && Object.keys(config.environment.set).some((name) => !variableName.test(name))) errors.push('environment.set keys must be valid environment variable names.');
  }
  return errors;
}

export async function loadConfig(start = process.cwd(), explicit) {
  const configPath = await findConfig(start, explicit);
  const config = await readJson(configPath);
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`Invalid ContextTest configuration:\n- ${errors.join('\n- ')}`);
  return { config, configPath, root: path.dirname(configPath) };
}
