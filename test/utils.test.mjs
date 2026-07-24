import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentSecrets, findExecutable, isPathInside, redact, runProcess, safeEnvironment, timestampId } from '../src/lib/utils.mjs';

test('redacts common token formats and explicit values', () => {
  const output = redact('key=sk-abcdefghijklmnopqrstuvwxyz secret=hunter2-value', ['hunter2-value']);
  assert.equal(output.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(output.includes('hunter2-value'), false);
  assert.match(output, /\[REDACTED\]/);
});

test('safe environment strips secrets by default', () => {
  const env = safeEnvironment({ allow: ['VISIBLE'], set: { FIXED: 3 } }, { PATH: '/bin', HOME: '/tmp/home', OPENAI_API_KEY: 'secret', VISIBLE: 'yes' });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.VISIBLE, 'yes');
  assert.equal(env.FIXED, '3');
});

test('path containment rejects siblings', () => {
  assert.equal(isPathInside('/tmp/root', '/tmp/root/child'), true);
  assert.equal(isPathInside('/tmp/root', '/tmp/root-other'), false);
});

test('runProcess records timeouts even when the child handles termination', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.on("SIGTERM", () => process.exit(0)); setTimeout(() => {}, 10000)'], { timeoutMs: 30 });
  assert.equal(result.timedOut, true);
});

test('timestamp IDs retain milliseconds to reduce run collisions', () => {
  assert.equal(timestampId(new Date('2026-07-24T12:34:56.789Z')), '20260724T123456789Z');
});

test('findExecutable resolves PATH entries without invoking a shell', async () => {
  assert.equal(await findExecutable(process.execPath), process.execPath);
  assert.equal(await findExecutable('definitely-not-a-contexttest-command', { PATH: '' }), null);
});

test('explicitly allowed and configured environment values are treated as secrets', () => {
  const secrets = environmentSecrets({ allow: ['GENERIC_VALUE'], set: { FIXED_VALUE: 'configured-secret' } }, { GENERIC_VALUE: 'allowed-secret', PATH: '/bin' });
  assert.equal(secrets.includes('allowed-secret'), true);
  assert.equal(secrets.includes('configured-secret'), true);
});
