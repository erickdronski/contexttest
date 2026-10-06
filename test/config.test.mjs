import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterConfig, validateConfig } from '../src/lib/config.mjs';

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
