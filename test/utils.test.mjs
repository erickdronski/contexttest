import test from 'node:test';
import assert from 'node:assert/strict';
import { isPathInside, redact, safeEnvironment } from '../src/lib/utils.mjs';

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
