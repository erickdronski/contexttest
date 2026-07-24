import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { runExperiment } from '../src/lib/engine.mjs';

const exec = promisify(execFile);

async function git(root, ...args) {
  await exec('git', args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
}

test('runs a complete paired experiment and keeps instruction changes out of metrics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-integration-'));
  await git(root, 'init');
  await writeFile(path.join(root, 'value.txt'), 'original\n');
  await writeFile(path.join(root, 'candidate.md'), 'MAKE_GOOD_CHANGE\n');
  await writeFile(path.join(root, 'agent.mjs'), `
    import { readFile, writeFile } from 'node:fs/promises';
    let rules = ''; try { rules = await readFile('AGENTS.md', 'utf8'); } catch {}
    await writeFile('value.txt', rules.includes('MAKE_GOOD_CHANGE') ? 'expected\\n' : 'wrong\\n');
  `);
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'fixture');
  const config = {
    version: 1, project: 'integration', baseRef: 'HEAD', instructionFile: 'AGENTS.md',
    agent: { provider: 'mock', timeoutMinutes: 1 }, trials: { attempts: 2, concurrency: 2 }, environment: { inherit: false },
    setup: { commands: [[process.execPath, '-e', 'require("fs").writeFileSync("prepared.txt", "ready\\n")']], timeoutMinutes: 1 },
    variants: [{ name: 'baseline', disabled: true }, { name: 'candidate', source: 'candidate.md' }],
    tasks: [{ name: 'change', prompt: 'change the value', mock: { command: ['node', 'agent.mjs'] }, assertions: [{ type: 'fileContains', path: 'value.txt', value: 'expected' }, { type: 'maxChangedFiles', value: 1 }] }],
  };
  const started = [];
  const report = await runExperiment({ config, root, onEvent: (event) => { if (event.type === 'trial:start') started.push(`${event.variant.name}-${event.attempt}`); } });
  assert.equal(report.comparison.winner, 'candidate');
  assert.equal(report.variants[0].summary.passRate, 0);
  assert.equal(report.variants[1].summary.passRate, 1);
  assert.deepEqual(report.variants[1].trials[0].files, ['value.txt']);
  assert.deepEqual(started, ['baseline-1', 'candidate-1', 'candidate-2', 'baseline-2']);
  assert.equal(await readFile(report.artifacts.html, 'utf8').then((html) => html.startsWith('<!doctype html>')), true);
  assert.equal(report.comparison.paired.pairs, 2);
  assert.equal(report.experiment.setupCommands, 1);
  assert.equal(report.experiment.configDigest.length, 64);
  assert.equal(report.taskRefs.change, report.commit);
  assert.equal(report.taskResults[0].name, 'change');
});

test('rejects invalid programmatic configurations before creating worktrees', async () => {
  const config = {
    version: 1, project: 'invalid', agent: { provider: 'mock' }, trials: { attempts: Number.NaN, concurrency: 1 },
    variants: [{ name: 'same', disabled: true }, { name: 'same', content: 'x' }],
    tasks: [{ name: 'task', prompt: 'prompt' }],
  };
  await assert.rejects(() => runExperiment({ config, root: process.cwd() }), /Invalid ContextTest configuration/);
});

test('refuses a symlinked state directory before creating worktrees', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-symlink-repo-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contexttest-symlink-outside-'));
  await git(root, 'init');
  await writeFile(path.join(root, 'seed.txt'), 'seed\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'fixture');
  await symlink(outside, path.join(root, '.contexttest'));
  const config = {
    version: 1, project: 'symlink', agent: { provider: 'mock' }, trials: { attempts: 1, concurrency: 1 },
    variants: [{ name: 'without', disabled: true }, { name: 'with', content: 'instructions' }],
    tasks: [{ name: 'task', prompt: 'prompt', mock: { command: [process.execPath, '-e', ''] } }],
  };
  await assert.rejects(() => runExperiment({ config, root }), /Refusing symlinked ContextTest state directory/);
});
