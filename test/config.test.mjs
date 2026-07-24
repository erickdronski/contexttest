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
