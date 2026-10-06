import path from 'node:path';
import { exists, readJson, slug } from './utils.mjs';

export const CONFIG_NAMES = ['contexttest.json', '.contexttest.json'];
export const TOP_LEVEL_KEYS = ['$schema', 'version', 'project', 'baseRef', 'instructionFile', 'agent', 'trials', 'setup', 'environment', 'variants', 'tasks'];
export const VARIANT_KEYS = ['name', 'disabled', 'source', 'content', 'agent'];
export const TRIAL_KEYS = ['attempts', 'concurrency', 'seed'];
export const PROVIDERS = ['codex', 'claude', 'command', 'mock'];

// A variant's agent is the top-level agent with the variant's overrides on
// top. Naming a different provider replaces the agent outright, so settings
// meant for one provider (an executable, a command) never leak into another.
export function resolveVariantAgent(agent, override) {
  if (!override) return agent;
  if (override.provider && override.provider !== agent?.provider) return { ...override };
  return { ...agent, ...override };
}

export function variantAgents(config) {
  return config.variants.map((variant) => resolveVariantAgent(config.agent, variant.agent));
}

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
  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  // Field checks apply to whatever an agent object sets; the provider-specific
  // requirements apply to the agent a trial will actually run.
  const agentFieldErrors = (agent, prefix) => {
    if (agent.provider !== undefined && !PROVIDERS.includes(agent.provider)) errors.push(`${prefix}.provider must be codex, claude, command, or mock.`);
    if (agent.executable !== undefined && !nonEmpty(agent.executable)) errors.push(`${prefix}.executable must be a non-empty string.`);
    if (agent.model !== undefined && !nonEmpty(agent.model)) errors.push(`${prefix}.model must be a non-empty string.`);
    if (agent.ignoreUserConfig !== undefined && typeof agent.ignoreUserConfig !== 'boolean') errors.push(`${prefix}.ignoreUserConfig must be a boolean.`);
    if (agent.isolate !== undefined && typeof agent.isolate !== 'boolean') errors.push(`${prefix}.isolate must be a boolean.`);
    if (agent.timeoutMinutes !== undefined && !boundedNumber(agent.timeoutMinutes, 0, 1440)) errors.push(`${prefix}.timeoutMinutes must be greater than 0 and no more than 1440.`);
    if (agent.maxTurns !== undefined && (!Number.isInteger(agent.maxTurns) || agent.maxTurns < 1 || agent.maxTurns > 1000)) errors.push(`${prefix}.maxTurns must be an integer from 1 to 1000.`);
    if (agent.permissionMode !== undefined && !['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(agent.permissionMode)) errors.push(`${prefix}.permissionMode is not supported.`);
    if (agent.allowedTools !== undefined && !stringArray(agent.allowedTools)) errors.push(`${prefix}.allowedTools must contain only non-empty strings.`);
    if (agent.disallowedTools !== undefined && !stringArray(agent.disallowedTools)) errors.push(`${prefix}.disallowedTools must contain only non-empty strings.`);
  };
  const effectiveAgentErrors = (agent, prefix) => {
    if (agent.provider === 'command' && !commandArray(agent.command)) errors.push(`${prefix}.command must be a non-empty string argument array for the command provider.`);
    if (agent.isolate === true && !['codex', 'claude'].includes(agent.provider)) errors.push(`${prefix}.isolate is supported only for the codex and claude providers; isolate a custom agent inside its own command.`);
  };
  const topLevel = new Set(TOP_LEVEL_KEYS);
  for (const name of Object.keys(config)) if (!topLevel.has(name)) errors.push(`Unknown top-level property: ${name}.`);
  if (config.version !== 1) errors.push('version must be 1.');
  if (!nonEmpty(config.project)) errors.push('project must be a non-empty string.');
  if (config.baseRef !== undefined && !nonEmpty(config.baseRef)) errors.push('baseRef must be a non-empty string.');
  if (config.instructionFile !== undefined && !safeRelativePath(config.instructionFile)) errors.push('instructionFile must be a relative path inside the repository.');
  if (!isObject(config.agent)) errors.push('agent must be an object.');
  if (!config.agent?.provider || !PROVIDERS.includes(config.agent.provider)) errors.push('agent.provider must be codex, claude, command, or mock.');
  if (isObject(config.agent)) {
    const { provider, ...fields } = config.agent;
    agentFieldErrors(fields, 'agent');
    if (PROVIDERS.includes(provider)) effectiveAgentErrors(config.agent, 'agent');
  }
  if (!Array.isArray(config.variants) || config.variants.length !== 2) errors.push('variants must contain exactly two variants.');
  const variants = Array.isArray(config.variants) ? config.variants : [];
  const variantKeys = new Set(VARIANT_KEYS);
  const effectiveAgents = isObject(config.agent) ? [config.agent] : [];
  for (const [index, variant] of variants.entries()) {
    if (!variant || typeof variant !== 'object') { errors.push(`variants[${index}] must be an object.`); continue; }
    for (const name of Object.keys(variant)) if (!variantKeys.has(name)) errors.push(`Unknown property variants[${index}].${name}.`);
    if (!nonEmpty(variant.name)) errors.push(`variants[${index}].name is required.`);
    const modes = [variant.disabled === true, typeof variant.source === 'string', typeof variant.content === 'string'].filter(Boolean).length;
    if (modes !== 1) errors.push(`variants[${index}] must set exactly one of disabled, source, or content.`);
    if (typeof variant.source === 'string' && !safeRelativePath(variant.source)) errors.push(`variants[${index}].source must be a relative path inside the project root.`);
    if (variant.agent !== undefined) {
      if (!isObject(variant.agent)) { errors.push(`variants[${index}].agent must be an object.`); continue; }
      agentFieldErrors(variant.agent, `variants[${index}].agent`);
      const effective = resolveVariantAgent(isObject(config.agent) ? config.agent : {}, variant.agent);
      if (PROVIDERS.includes(effective.provider)) effectiveAgentErrors(effective, `variants[${index}].agent`);
      effectiveAgents.push(effective);
    }
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
    if (effectiveAgents.some((agent) => agent.provider === 'mock') && !commandArray(task.mock?.command)) errors.push(`tasks[${index}].mock.command must be a non-empty string argument array for the mock provider.`);
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
  if (isObject(config.trials)) for (const name of Object.keys(config.trials)) if (!TRIAL_KEYS.includes(name)) errors.push(`Unknown property trials.${name}.`);
  if (config.trials?.seed !== undefined && (!Number.isInteger(config.trials.seed) || config.trials.seed < 0 || config.trials.seed > 0xFFFFFFFF)) errors.push('trials.seed must be an integer from 0 to 4294967295.');
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
