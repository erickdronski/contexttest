import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob } from '../src/lib/glob.mjs';

test('single star stays within one path segment', () => {
  assert.equal(matchesGlob('src/index.mjs', 'src/*.mjs'), true);
  assert.equal(matchesGlob('src/lib/index.mjs', 'src/*.mjs'), false);
});

test('double star crosses path segments', () => {
  assert.equal(matchesGlob('src/lib/index.mjs', 'src/**'), true);
  assert.equal(matchesGlob('test/index.mjs', 'src/**'), false);
});

test('question mark matches one non-separator character', () => {
  assert.equal(matchesGlob('test/a.mjs', 'test/?.mjs'), true);
  assert.equal(matchesGlob('test/ab.mjs', 'test/?.mjs'), false);
});
