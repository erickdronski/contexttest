import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentStartFailure, agentVersion, buildCommand, deliveryFor, deliveryWarning, describeInvocation, parseClaudeUsage, parseCodexUsage, runAgent } from '../src/lib/adapters.mjs';

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
  assert.deepEqual(codex, { inputTokens: 15, cachedInputTokens: 4, outputTokens: 3, costUsd: null, totalInputTokens: 15, requests: null });
  const claude = parseClaudeUsage(JSON.stringify({ total_cost_usd: 0.012, num_turns: 3, usage: { input_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 7 } }));
  assert.deepEqual(claude, { inputTokens: 20, cachedInputTokens: 7, outputTokens: 7, costUsd: 0.012, totalInputTokens: 27, requests: 3 });
  assert.deepEqual(parseClaudeUsage('not json'), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null, totalInputTokens: 0, requests: null });
  assert.equal(parseClaudeUsage(`warning: diagnostic\n${JSON.stringify({ num_turns: 2, usage: { input_tokens: 9 } })}`).inputTokens, 9);
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

test('knows which instruction files each provider loads by itself', () => {
  assert.deepEqual(deliveryFor('codex', 'AGENTS.md'), { file: 'AGENTS.md', method: 'native', bridgedVia: null });
  assert.deepEqual(deliveryFor('claude', 'CLAUDE.md'), { file: 'CLAUDE.md', method: 'native', bridgedVia: null });
  assert.deepEqual(deliveryFor('claude', 'AGENTS.md'), { file: 'AGENTS.md', method: 'bridged', bridgedVia: 'CLAUDE.md @import', bridge: 'CLAUDE.md' });
  assert.equal(deliveryFor('claude', 'packages/api/AGENTS.md').bridge, 'packages/api/CLAUDE.md');
  assert.equal(deliveryFor('claude', 'docs/rules.md').method, 'unverified');
  assert.equal(deliveryFor('codex', 'CLAUDE.md').method, 'unverified');
  assert.equal(deliveryFor('mock', 'AGENTS.md').method, 'unknown');
  assert.match(deliveryWarning('claude', deliveryFor('claude', 'docs/rules.md')), /Claude Code does not load docs\/rules\.md/);
  assert.equal(deliveryWarning('claude', deliveryFor('claude', 'AGENTS.md')), null);
});

test('classifies an unrecognized Claude model as a run that never started', () => {
  const stdout = `[claude-code:unrecognized_model]\n${JSON.stringify({ type: 'result', is_error: true, num_turns: 0, usage: { input_tokens: 0, output_tokens: 0 } })}`;
  const result = { command: 'claude', code: 1, stdout, stderr: '', usage: parseClaudeUsage(stdout) };
  assert.match(agentStartFailure({ provider: 'claude', model: 'claude-opus-5-5' }, result), /did not recognize model "claude-opus-5-5"; the agent never ran/);
  const ran = { ...result, usage: { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 30 } };
  assert.equal(agentStartFailure({ provider: 'claude' }, ran), null);
  assert.equal(agentStartFailure({ provider: 'codex' }, { ...result, usage: {} }), null);
});

test('a Claude result with no turns is a start failure, but a timeout is a scored outcome', () => {
  const stdout = JSON.stringify({ type: 'result', is_error: true, num_turns: 0, usage: { input_tokens: 0, output_tokens: 0 } });
  const result = { command: 'claude', code: 1, timedOut: false, stdout, stderr: '', usage: parseClaudeUsage(stdout) };
  assert.match(agentStartFailure({ provider: 'claude' }, result), /exited with code 1 before its first turn/);
  assert.equal(agentStartFailure({ provider: 'claude' }, { ...result, timedOut: true }), null);
  assert.equal(agentStartFailure({ provider: 'claude' }, { ...result, stdout: '', usage: parseClaudeUsage('') }), null, 'no result object: the agent may have crashed mid-run');
});

test('a missing agent executable is a start failure, not an agent failure', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'contexttest-missing-agent-'));
  const result = await runAgent({ agent: { provider: 'command', command: ['contexttest-definitely-missing-agent'] }, prompt: 'x', cwd, environment: { inherit: false } });
  assert.equal(result.spawnError, 'ENOENT');
  assert.match(agentStartFailure({ provider: 'command' }, result), /Could not start contexttest-definitely-missing-agent: ENOENT/);
});

test('isolation keeps user-level agent setup out of trials', () => {
  const claude = buildCommand({ provider: 'claude', isolate: true, model: 'sonnet' }, 'do work', '/repo');
  assert.deepEqual(claude.args, ['-p', 'do work', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--max-turns', '30', '--strict-mcp-config', '--setting-sources', 'project,local', '--model', 'sonnet']);
  assert.equal(claude.args.includes('--mcp-config'), false, 'strict MCP config with no server list means no MCP servers');
  const codex = buildCommand({ provider: 'codex', isolate: true, ignoreUserConfig: true }, 'do work', '/repo');
  assert.deepEqual(codex.args.filter((arg) => arg === '--ignore-user-config'), ['--ignore-user-config']);
});

test('records a portable invocation without the prompt, worktree, or secrets', () => {
  assert.deepEqual(describeInvocation({ provider: 'codex', isolate: true }).args, ['exec', '--ephemeral', '--sandbox', 'workspace-write', '--color', 'never', '--json', '-C', '[WORKTREE]', '--ignore-user-config', '[PROMPT]']);
  const custom = describeInvocation({ provider: 'command', command: ['agent', '--token', 'sk-abcdefghijklmnopqrstuvwxyz', '--cwd', '{cwd}', '{prompt}'] });
  assert.deepEqual(custom.args, ['--token', '[REDACTED]', '--cwd', '[WORKTREE]', '[PROMPT]']);
  assert.equal(describeInvocation({ provider: 'mock' }), null);
});

test('captures the agent CLI version without probing custom commands', async () => {
  assert.equal(await agentVersion({ provider: 'claude', executable: process.execPath }, { inherit: false }), process.version);
  assert.equal(await agentVersion({ provider: 'command', command: [process.execPath] }, {}), null);
  assert.equal(await agentVersion({ provider: 'codex', executable: 'contexttest-definitely-missing-codex' }, {}), null);
});
