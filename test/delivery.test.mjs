import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAblation } from '../src/lib/ablation.mjs';
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
// Like Claude Code 2.1.272, a dangling @import is not an error, but the model
// notices it and spends an extra turn looking for the missing file.
const imports = [];
const load = (file) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((line) => {
  if (!/^@\S+$/.test(line.trim())) return line;
  const target = path.resolve(path.dirname(file), line.trim().slice(1));
  imports.push({ target: path.relative(process.cwd(), target), exists: existsSync(target), bytes: existsSync(target) ? readFileSync(target).length : null });
  return load(target);
}).join('\n') : '';
// FAKE_CLAUDE_DEAF reproduces the original bug: the agent reads nothing.
const memory = process.env.FAKE_CLAUDE_DEAF === '1' ? '' : load('CLAUDE.md');
writeFileSync('value.txt', memory.includes('MAKE_GOOD_CHANGE') ? 'expected\n' : 'wrong\n');
const dangling = imports.filter((entry) => !entry.exists).map((entry) => entry.target);
const turns = 3 + (dangling.length ? 1 : 0);
const perRequest = 20000 + Math.round(Buffer.byteLength(memory) / 4);
process.stdout.write(JSON.stringify({ type: 'result', num_turns: turns, total_cost_usd: 0.01, imports, result: dangling.length ? 'Note: CLAUDE.md imports ' + dangling.join(', ') + ", which doesn't exist." : 'Done.', args: args.filter((arg) => arg.startsWith('--')), usage: { input_tokens: 12 * turns, cache_read_input_tokens: (perRequest - 12) * turns, cache_creation_input_tokens: 0, output_tokens: 10 } }));
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
  assert.deepEqual(report.variants[0].delivery, { file: 'AGENTS.md', method: 'bridged', bridgedVia: 'CLAUDE.md @import', emptyTargetForDisabledArm: true });
  assert.deepEqual(report.variants[1].delivery, { file: 'AGENTS.md', method: 'bridged', bridgedVia: 'CLAUDE.md @import' });
  for (const variant of report.variants) {
    assert.equal(variant.trials[0].bridge, 'created', 'the arm without instructions gets the same bridge');
    assert.deepEqual(variant.trials[0].files, ['value.txt'], 'neither the bridge nor the empty target is an agent change');
  }
  const seen = report.variants.map((variant) => JSON.parse(variant.trials[0].stdout));
  assert.deepEqual(seen[0].imports, [{ target: 'AGENTS.md', exists: true, bytes: 0 }], 'the import resolves to an empty file, not a missing one');
  assert.equal(seen[1].imports[0].exists, true);
  assert.deepEqual(seen.map((result) => [result.num_turns, result.result]), [[3, 'Done.'], [3, 'Done.']], 'no arm spends a turn on a dangling import');
  assert.match(renderTerminalReport(report, { color: false }), /Instruction delivery +via CLAUDE\.md @import \(empty AGENTS\.md\) +via CLAUDE\.md @import/);
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
  assert.match(stdout, /! delivery +Claude Code does not read AGENTS\.md; every arm gets CLAUDE\.md @import so the treatment reaches it, and an arm without instructions gets an empty AGENTS\.md/);
  assert.match(stdout, /! delivery +HEAD already has CLAUDE\.md: its rules reach every arm/);
  assert.match(stdout, /! isolation +your user settings, plugins, hooks, and MCP servers load into every trial/);
  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), '# Shared rules\n', 'doctor never edits the repository');
});

test('a cross-provider run bridges only the Claude arm and warns that two things changed', { skip }, async () => {
  const root = await repository();
  await writeFile(path.join(root, 'agent.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('value.txt', 'expected\\n');\n");
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'command agent');
  const config = claudeConfig(await fakeClaude());
  config.variants[1].agent = { provider: 'command', command: [process.execPath, 'agent.mjs'] };
  const report = await runExperiment({ config, root });
  assert.equal(report.variants[0].delivery.method, 'bridged');
  assert.equal(report.variants[1].delivery.method, 'unknown');
  assert.equal(report.variants[0].trials[0].bridge, 'created');
  assert.equal(report.variants[1].trials[0].bridge, undefined);
  assert.deepEqual(report.runtime.agents.map((agent) => [agent.provider, agent.version]), [['claude', '9.9.9 (Fake Claude Code)'], ['command', null]]);
  assert.match(report.treatment.summary, /^Instructions and agent both differ \(claude vs command\)/);
  assert.equal(report.warnings.find((warning) => warning.code === 'confounded').message, report.treatment.summary);
});

test('ablation arms reach Claude Code through the same bridge', { skip }, async () => {
  const root = await repository({ 'sectioned.md': '# Rules\n\n## Style\n\n- Two spaces.\n\n## Behavior\n\n- MAKE_GOOD_CHANGE\n' });
  const config = claudeConfig(await fakeClaude(), { isolate: true });
  config.variants[1].source = 'sectioned.md';
  const report = await runAblation({ config, root });
  assert.deepEqual(report.delivery, { file: 'AGENTS.md', method: 'bridged', bridgedVia: 'CLAUDE.md @import' });
  assert.ok(report.arms.every((arm) => arm.trials.every((trial) => trial.bridge === 'created')));
  assert.deepEqual(report.effects.map((effect) => effect.reading), ['no clear effect', 'helps']);
  assert.ok(report.invocation.args.includes('--strict-mcp-config'));
  assert.equal(report.runtime.agents[0].version, '9.9.9 (Fake Claude Code)');
});

test('the fake agent reproduces the dangling-import canary the empty target prevents', { skip }, async () => {
  const worktree = await mkdtemp(path.join(os.tmpdir(), 'contexttest-dangling-'));
  await writeFile(path.join(worktree, 'CLAUDE.md'), '@AGENTS.md\n');
  const { stdout } = await exec(await fakeClaude(), ['-p', 'x'], { cwd: worktree });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.imports, [{ target: 'AGENTS.md', exists: false, bytes: null }]);
  assert.equal(result.num_turns, 4, 'a dangling import costs a turn, as it did on Claude Code 2.1.272');
  assert.match(result.result, /imports AGENTS\.md, which doesn't exist/);
});
