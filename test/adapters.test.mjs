import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgent } from '../src/lib/adapters.mjs';

test('command adapter substitutes prompt and cwd as complete arguments', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'contexttest-adapter-'));
  const result = await runAgent({
    agent: { provider: 'command', command: [process.execPath, '-e', 'process.stdout.write(process.argv.slice(1).join("|"))', '{prompt}', '{cwd}'] },
    prompt: 'prompt with spaces; $(not-a-shell)', cwd, environment: { inherit: false },
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `prompt with spaces; $(not-a-shell)|${cwd}`);
});

test('mock adapter redacts secrets from captured output', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'contexttest-mock-'));
  const result = await runAgent({
    agent: { provider: 'mock' }, mock: { command: [process.execPath, '-e', 'process.stdout.write("sk-abcdefghijklmnopqrstuvwxyz")'] },
    prompt: 'unused', cwd, environment: { inherit: false },
  });
  assert.equal(result.stdout, '[REDACTED]');
});

test('mock adapter requires a command', async () => {
  await assert.rejects(() => runAgent({ agent: { provider: 'mock' }, prompt: 'x', cwd: process.cwd(), environment: {} }), /mock\.command/i);
});
