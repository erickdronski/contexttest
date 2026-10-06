import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, removeItem } from './inventory.mjs';

test('preserves addItem', () => assert.deepEqual(addItem(['a'], 'b'), ['a', 'b']));
test('removes an item', () => assert.deepEqual(removeItem(['a', 'b', 'a'], 'a'), ['b']));
test('leaves other items alone', () => assert.deepEqual(removeItem(['a'], 'z'), ['a']));
