import test from 'node:test';
import assert from 'node:assert/strict';
import { add, safeDivide } from './calculator.mjs';

test('preserves addition', () => assert.equal(add(2, 3), 5));
test('divides finite numbers', () => assert.equal(safeDivide(8, 2), 4));
test('returns null for division by zero', () => assert.equal(safeDivide(8, 0), null));
