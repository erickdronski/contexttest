import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterConfig, resolveVariantAgent, validateConfig, variantAgents } from '../src/lib/config.mjs';

test('starter configuration is valid', () => {
  assert.deepEqual(validateConfig(createStarterConfig()), []);
});

test('rejects ambiguous variants', () => {
  const config = createStarterConfig();
  config.variants[0] = { name: 'ambiguous', disabled: true, content: 'also set' };
  assert.match(validateConfig(config).join('\n'), /exactly one/);
});

test('requires exactly two variants', () => {
  const config = createStarterConfig();
  config.variants.pop();
  assert.match(validateConfig(config).join('\n'), /exactly two/);
});

test('bounds concurrency and attempts', () => {
  const config = createStarterConfig();
  config.trials = { attempts: 0, concurrency: 99 };
  const errors = validateConfig(config).join('\n');
  assert.match(errors, /attempts/);
  assert.match(errors, /concurrency/);
});

test('rejects names that collide directly or after slug normalization', () => {
  const config = createStarterConfig();
  config.variants[1].name = config.variants[0].name;
  config.tasks.push({ ...config.tasks[0], name: 'focused change' });
  const errors = validateConfig(config).join('\n');
  assert.match(errors, /variant names must be unique/);
  assert.match(errors, /task names must remain unique/);
});

test('rejects unsafe paths and malformed assertions before a paid run', () => {
  const config = createStarterConfig();
  config.instructionFile = '../AGENTS.md';
  config.variants[1].source = '/tmp/instructions.md';
  config.tasks[0].assertions = [
    { type: 'command', command: 'npm test' },
    { type: 'allowedPaths', patterns: [] },
    { type: 'fileContains', path: '../../secret', value: '' },
    { type: 'imaginary' },
  ];
  const errors = validateConfig(config).join('\n');
  assert.match(errors, /instructionFile/);
  assert.match(errors, /source/);
  assert.match(errors, /command must be/);
  assert.match(errors, /patterns/);
  assert.match(errors, /path must be relative/);
  assert.match(errors, /not supported/);
});

test('validates setup commands and provider-specific mock commands', () => {
  const config = createStarterConfig();
  config.agent = { provider: 'mock', timeoutMinutes: -1 };
  config.setup = { commands: [['npm', 'ci'], []], timeoutMinutes: 0 };
  const errors = validateConfig(config).join('\n');
  assert.match(errors, /agent.timeoutMinutes/);
  assert.match(errors, /mock.command/);
  assert.match(errors, /setup.commands\[1\]/);
  assert.match(errors, /setup.timeoutMinutes/);
});

test('returns useful errors for structurally malformed JSON without throwing', () => {
  const config = createStarterConfig();
  config.extraTypo = true;
  config.agent = [];
  config.trials = [];
  config.environment = 'all';
  config.variants = [null, 7];
  config.tasks = [null];
  const errors = validateConfig(config).join('\n');
  assert.match(errors, /Unknown top-level property/);
  assert.match(errors, /agent must be an object/);
  assert.match(errors, /trials must be an object/);
  assert.match(errors, /environment must be an object/);
  assert.match(errors, /variants\[0\] must be an object/);
  assert.match(errors, /tasks\[0\] must be an object/);
});

test('isolation is a boolean for providers that support it', () => {
  const config = createStarterConfig();
  config.agent = { provider: 'claude', isolate: 'yes' };
  assert.match(validateConfig(config).join('\n'), /agent.isolate must be a boolean/);
  config.agent = { provider: 'command', command: ['agent'], isolate: true };
  assert.match(validateConfig(config).join('\n'), /agent.isolate is supported only for the codex and claude providers/);
  config.agent = { provider: 'claude', isolate: true };
  assert.deepEqual(validateConfig(config), []);
});

test('a variant agent merges over the default agent unless it names another provider', () => {
  const base = { provider: 'claude', executable: '/opt/claude', maxTurns: 30 };
  assert.deepEqual(resolveVariantAgent(base, { model: 'opus' }), { provider: 'claude', executable: '/opt/claude', maxTurns: 30, model: 'opus' });
  assert.deepEqual(resolveVariantAgent(base, { provider: 'codex', model: 'gpt' }), { provider: 'codex', model: 'gpt' }, 'no Claude executable leaks into Codex');
  assert.deepEqual(resolveVariantAgent(base, { provider: 'claude', maxTurns: 5 }).executable, '/opt/claude');
  const config = createStarterConfig();
  config.variants = [{ name: 'codex', source: 'AGENTS.md' }, { name: 'claude', source: 'AGENTS.md', agent: { provider: 'claude', isolate: true } }];
  assert.deepEqual(validateConfig(config), []);
  assert.deepEqual(variantAgents(config).map((agent) => agent.provider), ['codex', 'claude']);
});

test('validates variant agents as strictly as the default agent', () => {
  const config = createStarterConfig();
  config.variants[0].agent = { provider: 'gemini' };
  config.variants[1].agent = { provider: 'command', isolate: true, maxTurns: 0 };
  const errors = validateConfig(config).join('\n');
  assert.match(errors, /variants\[0\]\.agent\.provider must be codex, claude, command, or mock/);
  assert.match(errors, /variants\[1\]\.agent\.command must be a non-empty string argument array/);
  assert.match(errors, /variants\[1\]\.agent\.isolate is supported only/);
  assert.match(errors, /variants\[1\]\.agent\.maxTurns must be an integer/);
  config.variants[0] = { name: 'baseline', disabled: true, agent: 'claude' };
  config.variants[1] = { name: 'candidate', source: 'AGENTS.md', agnet: { provider: 'claude' } };
  const typos = validateConfig(config).join('\n');
  assert.match(typos, /variants\[0\]\.agent must be an object/);
  assert.match(typos, /Unknown property variants\[1\]\.agnet/, 'a typo must not silently turn a cross-agent run into an A/A test');
});

test('requires mock commands when any variant uses the mock agent', () => {
  const config = createStarterConfig();
  config.variants[1].agent = { provider: 'mock' };
  assert.match(validateConfig(config).join('\n'), /tasks\[0\]\.mock\.command/);
});

test('the published schema and the runtime validator accept the same keys', async () => {
  const { readFile } = await import('node:fs/promises');
  const { TOP_LEVEL_KEYS, VARIANT_KEYS } = await import('../src/lib/config.mjs');
  const schema = JSON.parse(await readFile(new URL('../schema/contexttest.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(schema.properties).sort(), [...TOP_LEVEL_KEYS].sort());
  assert.deepEqual(Object.keys(schema.properties.variants.items.properties).sort(), [...VARIANT_KEYS].sort());
  assert.equal(schema.properties.variants.items.properties.agent.$ref, '#/$defs/agent');
});

test('validates the trial-order seed and rejects unknown trial settings', () => {
  const config = createStarterConfig();
  config.trials = { attempts: 3, seed: 7 };
  assert.deepEqual(validateConfig(config), []);
  for (const seed of [-1, 1.5, 2 ** 32, '7']) {
    config.trials = { seed };
    assert.match(validateConfig(config).join('\n'), /trials.seed must be an integer from 0 to 4294967295/);
  }
  config.trials = { atempts: 5 };
  assert.match(validateConfig(config).join('\n'), /Unknown property trials.atempts/);
});
