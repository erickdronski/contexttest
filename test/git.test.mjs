import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { applyVariant, changedFiles, diffStats } from '../src/lib/git.mjs';

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
