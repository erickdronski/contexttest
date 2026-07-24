import { copyFile, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, isPathInside, runProcess } from './utils.mjs';

async function git(args, cwd, options = {}) {
  const result = await runProcess('git', args, { cwd, env: options.env ?? process.env, timeoutMs: options.timeoutMs ?? 120_000 });
  if (result.code !== 0 && !options.allowFailure) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result;
}

export async function assertGitRepository(root) {
  const result = await git(['rev-parse', '--show-toplevel'], root, { allowFailure: true });
  if (result.code !== 0) throw new Error('ContextTest must run inside a Git repository.');
  return result.stdout.trim();
}

export async function createWorktree({ repository, destination, ref, env }) {
  await mkdir(path.dirname(destination), { recursive: true });
  const result = await git(['worktree', 'add', '--detach', destination, ref], repository, { env, allowFailure: true });
  if (result.code !== 0) throw new Error(`Could not create trial worktree at ${destination}:\n${result.stderr || result.stdout}`);
}

export async function removeWorktree({ repository, destination, worktreeRoot, env }) {
  if (!isPathInside(worktreeRoot, destination) || path.resolve(destination) === path.resolve(worktreeRoot)) throw new Error(`Refusing to remove unsafe worktree path: ${destination}`);
  await git(['worktree', 'remove', '--force', destination], repository, { env, allowFailure: true });
  if (await exists(destination)) await rm(destination, { recursive: true, force: true });
  await git(['worktree', 'prune'], repository, { env, allowFailure: true });
}

export async function applyVariant({ root, worktree, instructionFile, variant }) {
  const destination = path.resolve(worktree, instructionFile);
  if (!isPathInside(worktree, destination)) throw new Error(`instructionFile escapes the worktree: ${instructionFile}`);
  await mkdir(path.dirname(destination), { recursive: true });
  if (variant.disabled) {
    if (await exists(destination)) await unlink(destination);
  } else if (variant.source) {
    const source = path.resolve(root, variant.source);
    if (!isPathInside(root, source)) throw new Error(`Variant source escapes the project root: ${variant.source}`);
    await copyFile(source, destination);
  } else {
    await writeFile(destination, variant.content, 'utf8');
  }
}

export async function snapshotTrialBaseline(worktree) {
  await git(['add', '--all'], worktree);
  const staged = await git(['diff', '--cached', '--quiet'], worktree, { allowFailure: true });
  if (staged.code === 0) return;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'ContextTest', GIT_AUTHOR_EMAIL: 'contexttest@localhost',
    GIT_COMMITTER_NAME: 'ContextTest', GIT_COMMITTER_EMAIL: 'contexttest@localhost',
  };
  await git(['-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', 'contexttest: establish trial baseline'], worktree, { env });
}

export async function changedFiles(worktree) {
  const result = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], worktree);
  return result.stdout.split('\0').filter(Boolean).map((entry) => entry.slice(3)).filter(Boolean).sort();
}

export async function diffStats(worktree) {
  const tracked = await git(['diff', '--numstat', 'HEAD'], worktree);
  const untracked = await git(['ls-files', '--others', '--exclude-standard'], worktree);
  let additions = 0;
  let deletions = 0;
  for (const line of tracked.stdout.trim().split('\n').filter(Boolean)) {
    const [add, del] = line.split('\t');
    additions += Number(add) || 0;
    deletions += Number(del) || 0;
  }
  for (const file of untracked.stdout.trim().split('\n').filter(Boolean)) {
    try {
      const content = await import('node:fs/promises').then((fs) => fs.readFile(path.join(worktree, file), 'utf8'));
      additions += content.split('\n').length;
    } catch { additions += 1; }
  }
  return { additions, deletions, total: additions + deletions };
}

export async function currentCommit(root) {
  const result = await git(['rev-parse', 'HEAD'], root);
  return result.stdout.trim();
}
