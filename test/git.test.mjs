import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { applyDeliveryBridge, applyVariant, changedFiles, createWorktree, diffStats, removeWorktree } from '../src/lib/git.mjs';

const exec = promisify(execFile);

test('changedFiles reports a rename once and diffStats counts text lines accurately', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-git-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  await exec('git', ['init'], { cwd: root, env });
  await writeFile(path.join(root, 'before.txt'), 'one\ntwo\n');
  await exec('git', ['add', '.'], { cwd: root, env });
  await exec('git', ['commit', '-m', 'fixture'], { cwd: root, env });
  await rename(path.join(root, 'before.txt'), path.join(root, 'after.txt'));
  await exec('git', ['add', '--all'], { cwd: root, env });
  await writeFile(path.join(root, 'new.txt'), 'one\ntwo\n');
  assert.deepEqual(await changedFiles(root), ['after.txt', 'new.txt']);
  const diff = await diffStats(root);
  assert.equal(diff.additions, 2);
  assert.equal(diff.deletions, 0);
  assert.equal(diff.total, 2);
});

test('binary untracked files do not invent text line counts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-binary-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  await exec('git', ['init'], { cwd: root, env });
  await writeFile(path.join(root, 'seed.txt'), 'seed\n');
  await exec('git', ['add', '.'], { cwd: root, env });
  await exec('git', ['commit', '-m', 'fixture'], { cwd: root, env });
  await writeFile(path.join(root, 'asset.bin'), Buffer.from([0, 1, 2, 3]));
  assert.equal((await diffStats(root)).total, 0);
  assert.deepEqual(await changedFiles(root), ['asset.bin']);
});

test('variant files cannot traverse symlinks outside trusted roots', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-source-root-'));
  const worktree = await mkdtemp(path.join(os.tmpdir(), 'contexttest-destination-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contexttest-variant-outside-'));
  const outsideSource = path.join(outside, 'outside.md');
  const outsideDestination = path.join(outside, 'destination.md');
  await writeFile(outsideSource, 'private source\n');
  await writeFile(outsideDestination, 'do not overwrite\n');
  await symlink(outsideSource, path.join(root, 'linked-source.md'));
  await assert.rejects(() => applyVariant({ root, worktree, instructionFile: 'AGENTS.md', variant: { source: 'linked-source.md' } }), /symlink outside/);
  await symlink(outsideDestination, path.join(worktree, 'AGENTS.md'));
  await assert.rejects(() => applyVariant({ root, worktree, instructionFile: 'AGENTS.md', variant: { content: 'overwrite' } }), /symlinked instruction destination/);
  assert.equal(await readFile(outsideDestination, 'utf8'), 'do not overwrite\n');
});

test('parallel trials serialize Git worktree registry mutations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-parallel-worktrees-'));
  const worktreeRoot = path.join(root, '.contexttest', 'worktrees', 'test-run');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  await exec('git', ['init'], { cwd: root, env });
  await writeFile(path.join(root, 'seed.txt'), 'seed\n');
  await exec('git', ['add', '.'], { cwd: root, env });
  await exec('git', ['commit', '-m', 'fixture'], { cwd: root, env });
  const destinations = Array.from({ length: 6 }, (_, index) => path.join(worktreeRoot, `trial-${index + 1}`));
  await Promise.all(destinations.map((destination) => createWorktree({ repository: root, destination, ref: 'HEAD', env })));
  await Promise.all(destinations.map((destination) => removeWorktree({ repository: root, destination, worktreeRoot, env })));
  const listed = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: root, env });
  assert.equal(listed.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
});

test('the Claude bridge imports AGENTS.md without overwriting existing rules', { skip: process.platform === 'win32' }, async () => {
  const worktree = await mkdtemp(path.join(os.tmpdir(), 'contexttest-bridge-'));
  const options = { worktree, bridge: 'CLAUDE.md', importLine: '@AGENTS.md', target: 'AGENTS.md' };
  assert.equal(await applyDeliveryBridge(options), 'created');
  assert.equal(await readFile(path.join(worktree, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(await applyDeliveryBridge(options), 'already-imported');
  await writeFile(path.join(worktree, 'CLAUDE.md'), '# Team rules\n- Keep diffs small.');
  assert.equal(await applyDeliveryBridge(options), 'appended');
  assert.equal(await readFile(path.join(worktree, 'CLAUDE.md'), 'utf8'), '# Team rules\n- Keep diffs small.\n\n@AGENTS.md\n');
  await writeFile(path.join(worktree, 'CLAUDE.md'), 'See @./AGENTS.md below\n@./AGENTS.md\n');
  assert.equal(await applyDeliveryBridge(options), 'already-imported');
  const nested = await applyDeliveryBridge({ ...options, bridge: 'packages/api/CLAUDE.md', target: 'packages/api/AGENTS.md' });
  assert.equal(nested, 'created');
  assert.equal(await readFile(path.join(worktree, 'packages/api/CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
});

test('the Claude bridge accepts a CLAUDE.md link to AGENTS.md and refuses any other link', { skip: process.platform === 'win32' }, async () => {
  const worktree = await mkdtemp(path.join(os.tmpdir(), 'contexttest-bridge-link-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contexttest-bridge-outside-'));
  const options = { worktree, bridge: 'CLAUDE.md', importLine: '@AGENTS.md', target: 'AGENTS.md' };
  await symlink('AGENTS.md', path.join(worktree, 'CLAUDE.md'));
  assert.equal(await applyDeliveryBridge(options), 'symlinked');
  await unlink(path.join(worktree, 'CLAUDE.md'));
  await writeFile(path.join(outside, 'CLAUDE.md'), 'do not overwrite\n');
  await symlink(path.join(outside, 'CLAUDE.md'), path.join(worktree, 'CLAUDE.md'));
  await assert.rejects(() => applyDeliveryBridge(options), /Refusing to write an instruction bridge through symlinked CLAUDE\.md/);
  assert.equal(await readFile(path.join(outside, 'CLAUDE.md'), 'utf8'), 'do not overwrite\n');
  await symlink(outside, path.join(worktree, 'linked'));
  await assert.rejects(() => applyDeliveryBridge({ ...options, bridge: 'linked/CLAUDE.md', target: 'linked/AGENTS.md' }), /traverses a symlink outside the worktree/);
});
