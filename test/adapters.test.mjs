import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCommand, parseClaudeUsage, parseCodexUsage, runAgent } from '../src/lib/adapters.mjs';

test('builds the verified Codex CLI contract without bypass flags', () => {
  const invocation = buildCommand({ provider: 'codex', model: 'gpt-test', ignoreUserConfig: true }, 'do work', '/repo');
  assert.equal(invocation.command, 'codex');
  assert.deepEqual(invocation.args, ['exec', '--ephemeral', '--sandbox', 'workspace-write', '--color', 'never', '--json', '-C', '/repo', '--model', 'gpt-test', '--ignore-user-config', 'do work']);
  assert.equal(invocation.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
});

test('builds the documented Claude Code print-mode contract', () => {
  const invocation = buildCommand({ provider: 'claude', model: 'sonnet', maxTurns: 8, allowedTools: ['Read', 'Bash(git diff:*)'], disallowedTools: ['WebFetch'] }, 'do work', '/repo');
  assert.equal(invocation.command, 'claude');
  assert.deepEqual(invocation.args, ['-p', 'do work', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', '8', '--model', 'sonnet', '--allowedTools', 'Read,Bash(git diff:*)', '--disallowedTools', 'WebFetch']);
  assert.equal(invocation.args.includes('--dangerously-skip-permissions'), false);
});

test('parses provider usage without trusting diagnostic lines', () => {
  const codex = parseCodexUsage('diagnostic\n{"usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":2}}\n{"data":{"usage":{"inputTokens":15,"outputTokens":3}}}');
  assert.deepEqual(codex, { inputTokens: 15, cachedInputTokens: 4, outputTokens: 3, costUsd: null });
  const claude = parseClaudeUsage(JSON.stringify({ total_cost_usd: 0.012, usage: { input_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 7 } }));
  assert.deepEqual(claude, { inputTokens: 20, cachedInputTokens: 7, outputTokens: 7, costUsd: 0.012 });
  assert.deepEqual(parseClaudeUsage('not json'), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null });
});

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
