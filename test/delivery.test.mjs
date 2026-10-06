import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExperiment } from '../src/lib/engine.mjs';
import { renderHtmlReport, renderTerminalReport } from '../src/lib/reporter.mjs';

const exec = promisify(execFile);
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.mjs');
const skip = process.platform === 'win32';

// Behaves like Claude Code where it matters here: it reads CLAUDE.md and follows
// @imports, but never reads AGENTS.md on its own. Input tokens grow with the
// memory it loaded, the way a real system prompt would.
const FAKE_CLAUDE = String.raw`#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('9.9.9 (Fake Claude Code)\n'); process.exit(0); }
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : null;
if (model === 'not-a-model') {
  process.stdout.write('[claude-code:unrecognized_model]\n' + JSON.stringify({ type: 'result', is_error: true, num_turns: 0, usage: { input_tokens: 0, output_tokens: 0 } }));
  process.exit(1);
}
const load = (file) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((line) => /^@\S+$/.test(line.trim()) ? load(path.resolve(path.dirname(file), line.trim().slice(1))) : line).join('\n') : '';
// FAKE_CLAUDE_DEAF reproduces the original bug: the agent reads nothing.
const memory = process.env.FAKE_CLAUDE_DEAF === '1' ? '' : load('CLAUDE.md');
writeFileSync('value.txt', memory.includes('MAKE_GOOD_CHANGE') ? 'expected\n' : 'wrong\n');
const turns = 3;
const perRequest = 20000 + Math.round(Buffer.byteLength(memory) / 4);
process.stdout.write(JSON.stringify({ type: 'result', num_turns: turns, total_cost_usd: 0.01, args: args.filter((arg) => arg.startsWith('--')), usage: { input_tokens: 12 * turns, cache_read_input_tokens: (perRequest - 12) * turns, cache_creation_input_tokens: 0, output_tokens: 10 } }));
`;

async function git(root, ...args) {
  await exec('git', args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
}

async function fakeClaude() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contexttest-fake-claude-'));
  const executable = path.join(directory, 'claude');
  await writeFile(executable, FAKE_CLAUDE);
  await chmod(executable, 0o755);
  return executable;
}

async function repository(files = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-delivery-'));
  await git(root, 'init');
  await writeFile(path.join(root, 'value.txt'), 'original\n');
  await writeFile(path.join(root, 'candidate.md'), `MAKE_GOOD_CHANGE\n${'- Follow the repository conventions for every change.\n'.repeat(10)}`);
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'fixture');
  return root;
}

function claudeConfig(executable, agent = {}) {
  return {
    version: 1, project: 'delivery', instructionFile: 'AGENTS.md',
    agent: { provider: 'claude', executable, timeoutMinutes: 1, ...agent }, trials: { attempts: 1, concurrency: 1 }, environment: { inherit: false },
    variants: [{ name: 'without', disabled: true }, { name: 'with', source: 'candidate.md' }],
    tasks: [{ name: 'change', prompt: 'change the value', assertions: [{ type: 'fileContains', path: 'value.txt', value: 'expected' }] }],
  };
}

test('Claude Code receives AGENTS.md through a CLAUDE.md import in every arm', { skip }, async () => {
  const root = await repository();
  const report = await runExperiment({ config: claudeConfig(await fakeClaude()), root });
  assert.equal(report.comparison.winner, 'candidate', 'the treatment must reach an agent that only reads CLAUDE.md');
  for (const variant of report.variants) {
    assert.deepEqual(variant.delivery, { file: 'AGENTS.md', method: 'bridged', bridgedVia: 'CLAUDE.md @import' });
    assert.equal(variant.trials[0].bridge, 'created', 'the arm without instructions gets the same bridge');
    assert.deepEqual(variant.trials[0].files, ['value.txt'], 'the bridge is not an agent change');
  }
  assert.equal(report.comparison.treatmentDelivery, 'consistent');
  assert.equal(report.comparison.deliveryCheck.basis, 'request');
  assert.deepEqual(report.warnings, []);
  assert.equal(report.runtime.agents[0].version, '9.9.9 (Fake Claude Code)');
});

test('isolated Claude Code trials run without user MCP servers or settings, and say so', { skip }, async () => {
  const root = await repository();
  const report = await runExperiment({ config: claudeConfig(await fakeClaude(), { isolate: true }), root });
  assert.equal(report.agent.isolate, true);
  const { args } = report.variants[1].invocation;
  assert.deepEqual(args.slice(0, 2), ['-p', '[PROMPT]']);
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'project,local');
  assert.equal(JSON.stringify(report.variants[1].invocation).includes(root), false);
  assert.match(report.variants[1].trials[0].stdout, /"--strict-mcp-config","--setting-sources"/, 'the agent received the flags');
  assert.equal(report.comparison.winner, 'candidate', 'isolation does not block project instructions');
});

test('an agent that never reads the instructions gets a doubtful-delivery warning and label', { skip }, async () => {
  const root = await repository();
  const config = { ...claudeConfig(await fakeClaude()), environment: { inherit: false, set: { FAKE_CLAUDE_DEAF: '1' } } };
  const report = await runExperiment({ config, root });
  assert.equal(report.variants[0].summary.passRate, report.variants[1].summary.passRate, 'identical arms in practice');
  assert.equal(report.comparison.treatmentDelivery, 'doubtful');
  assert.equal(report.comparison.signal, 'doubtful');
  assert.equal(report.taskResults[0].comparison.signal, 'doubtful');
  assert.equal(report.warnings[0].code, 'treatment-delivery');
  assert.match(report.warnings[0].message, /with sent only 0 more input tokens per request than without/);
  const terminal = renderTerminalReport(report, { color: false });
  assert.match(terminal, /WARNING {2}Treatment delivery is doubtful/);
  assert.match(terminal, /Evidence: doubtful;/);
  assert.match(renderHtmlReport(report), /class="alert"[\s\S]*Treatment delivery is doubtful/);
});

test('an existing CLAUDE.md keeps its rules and gains the import', { skip }, async () => {
  const root = await repository({ 'CLAUDE.md': '# Shared rules\n- Be careful.\n' });
  const report = await runExperiment({ config: claudeConfig(await fakeClaude()), root });
  assert.equal(report.comparison.winner, 'candidate');
  assert.equal(report.variants[0].trials[0].bridge, 'appended');
  assert.deepEqual(report.variants[1].trials[0].files, ['value.txt']);
});

test('an unrecognized Claude model invalidates the experiment instead of scoring failures', { skip }, async () => {
  const root = await repository();
  const config = claudeConfig(await fakeClaude(), { model: 'not-a-model' });
  await assert.rejects(
    () => runExperiment({ config, root }),
    /trial\(s\) failed before the agent could run[\s\S]*did not recognize model "not-a-model"/,
  );
});

test('a missing agent executable invalidates the experiment', { skip }, async () => {
  const root = await repository();
  await assert.rejects(
    () => runExperiment({ config: claudeConfig(path.join(os.tmpdir(), 'contexttest-no-such-claude')), root }),
    /failed before the agent could run[\s\S]*Could not start/,
  );
});

test('doctor warns that Claude Code needs a bridge and that a base CLAUDE.md reaches every arm', { skip }, async () => {
  const root = await repository({ 'CLAUDE.md': '# Shared rules\n' });
  await writeFile(path.join(root, 'contexttest.json'), `${JSON.stringify(claudeConfig(await fakeClaude()), null, 2)}\n`);
  const { stdout } = await exec(process.execPath, [cli, 'doctor'], { cwd: root });
  assert.match(stdout, /! delivery +Claude Code does not read AGENTS\.md; every arm gets CLAUDE\.md @import/);
  assert.match(stdout, /! delivery +HEAD already has CLAUDE\.md: its rules reach every arm/);
  assert.match(stdout, /! isolation +your user settings, plugins, hooks, and MCP servers load into every trial/);
  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), '# Shared rules\n', 'doctor never edits the repository');
});
