import test from 'node:test';
import assert from 'node:assert/strict';
import { environmentSecrets, findExecutable, isPathInside, redact, runProcess, safeEnvironment, seededRandom, seededShuffle, stableStringify, timestampId } from '../src/lib/utils.mjs';

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

test('seeded randomness is reproducible and shuffles into a permutation', () => {
  const first = seededRandom(42);
  const second = seededRandom(42);
  const draws = Array.from({ length: 5 }, () => first());
  assert.deepEqual(Array.from({ length: 5 }, () => second()), draws);
  assert.ok(draws.every((value) => value >= 0 && value < 1));
  assert.equal(draws[0], 0.6011037519201636, 'the generator must not change between releases, or recorded seeds stop reproducing');
  const items = Array.from({ length: 20 }, (_, index) => index);
  const shuffled = seededShuffle(items, 7);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
  assert.deepEqual(seededShuffle(items, 7), shuffled);
  assert.notDeepEqual(shuffled, items);
});

test('stable serialization ignores key order', () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] }), stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: '1' }));
});

test('configured values apply on top of the environment whether or not it is inherited', () => {
  const source = { PATH: '/bin', HOME: '/home/user', INHERITED_ONLY: 'from the shell', MODE: 'shell' };
  for (const inherit of [false, true]) {
    const plain = safeEnvironment({ inherit }, source);
    assert.equal(plain.PATH, '/bin');
    assert.equal(plain.MODE, inherit ? 'shell' : undefined, `inherit: ${inherit} without set`);
    const configured = safeEnvironment({ inherit, set: { MODE: 'configured', FLAG: true, COUNT: 3 } }, source);
    assert.deepEqual([configured.MODE, configured.FLAG, configured.COUNT], ['configured', 'true', '3'], `inherit: ${inherit} with set`);
    assert.equal(configured.INHERITED_ONLY, inherit ? 'from the shell' : undefined);
    assert.equal(safeEnvironment({ inherit, set: { MODE: 'configured' }, deny: ['MODE'] }, source).MODE, undefined, 'deny still has the last word');
  }
});
