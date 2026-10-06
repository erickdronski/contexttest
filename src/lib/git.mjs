import { copyFile, lstat, mkdir, readFile, readlink, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, isPathInside, runProcess } from './utils.mjs';

let worktreeMutationChain = Promise.resolve();

function serializeWorktreeMutation(operation) {
  const next = worktreeMutationChain.then(operation, operation);
  worktreeMutationChain = next.catch(() => {});
  return next;
}

async function git(args, cwd, options = {}) {
  const result = await runProcess('git', args, { cwd, env: options.env ?? process.env, timeoutMs: options.timeoutMs ?? 120_000 });
  if (result.code !== 0 && !options.allowFailure) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result;
}

async function detailsOrNull(target) {
  try { return await lstat(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function assertGitRepository(root) {
  const result = await git(['rev-parse', '--show-toplevel'], root, { allowFailure: true });
  if (result.code !== 0) throw new Error('ContextTest must run inside a Git repository.');
  return result.stdout.trim();
}

export async function createWorktree({ repository, destination, ref, env }) {
  await mkdir(path.dirname(destination), { recursive: true });
  await serializeWorktreeMutation(async () => {
    const result = await git(['worktree', 'add', '--detach', destination, ref], repository, { env, allowFailure: true });
    if (result.code !== 0) throw new Error(`Could not create trial worktree at ${destination}:\n${result.stderr || result.stdout}`);
  });
}

export async function removeWorktree({ repository, destination, worktreeRoot, env }) {
  if (!isPathInside(worktreeRoot, destination) || path.resolve(destination) === path.resolve(worktreeRoot)) throw new Error(`Refusing to remove unsafe worktree path: ${destination}`);
  await serializeWorktreeMutation(async () => {
    await git(['worktree', 'remove', '--force', destination], repository, { env, allowFailure: true });
    if (await exists(destination)) await rm(destination, { recursive: true, force: true });
    await git(['worktree', 'prune'], repository, { env, allowFailure: true });
  });
}

async function resolveVariantSource(root, source) {
  const target = path.resolve(root, source);
  if (!isPathInside(root, target)) throw new Error(`Variant source escapes the project root: ${source}`);
  const [realRoot, realSource] = await Promise.all([realpath(root), realpath(target)]);
  if (!isPathInside(realRoot, realSource)) throw new Error(`Variant source traverses a symlink outside the project root: ${source}`);
  if (!(await lstat(realSource)).isFile()) throw new Error(`Variant source is not a regular file: ${source}`);
  return target;
}

// The exact bytes a variant writes to the instruction file, or null when the
// variant removes it. Sources pass the same containment checks as applyVariant.
export async function readVariantInstructions({ root, variant }) {
  if (variant.disabled) return null;
  if (typeof variant.content === 'string') return Buffer.from(variant.content, 'utf8');
  return readFile(await resolveVariantSource(root, variant.source));
}

export async function applyVariant({ root, worktree, instructionFile, variant }) {
  const destination = path.resolve(worktree, instructionFile);
  if (!isPathInside(worktree, destination)) throw new Error(`instructionFile escapes the worktree: ${instructionFile}`);
  await mkdir(path.dirname(destination), { recursive: true });
  const [realWorktree, realParent] = await Promise.all([realpath(worktree), realpath(path.dirname(destination))]);
  if (!isPathInside(realWorktree, realParent)) throw new Error(`instructionFile traverses a symlink outside the worktree: ${instructionFile}`);
  const destinationDetails = await detailsOrNull(destination);
  if (variant.disabled) {
    if (destinationDetails) await unlink(destination);
  } else if (variant.source) {
    const source = await resolveVariantSource(root, variant.source);
    if (destinationDetails?.isSymbolicLink()) throw new Error(`Refusing symlinked instruction destination: ${instructionFile}`);
    await copyFile(source, destination);
  } else {
    if (destinationDetails?.isSymbolicLink()) throw new Error(`Refusing symlinked instruction destination: ${instructionFile}`);
    await writeFile(destination, variant.content, 'utf8');
  }
}

// Write the same CLAUDE.md import into every arm so Claude Code reads the
// instruction file under test. The arm without instructions gets the bridge
// too: only the imported file differs between arms, never the bridge. It is
// written before the trial baseline, so it never counts as an agent change.
export async function applyDeliveryBridge({ worktree, bridge, importLine, target }) {
  const destination = path.resolve(worktree, bridge);
  const targetPath = path.resolve(worktree, target);
  if (!isPathInside(worktree, destination)) throw new Error(`Instruction bridge escapes the worktree: ${bridge}`);
  await mkdir(path.dirname(destination), { recursive: true });
  const [realWorktree, realParent] = await Promise.all([realpath(worktree), realpath(path.dirname(destination))]);
  if (!isPathInside(realWorktree, realParent)) throw new Error(`Instruction bridge traverses a symlink outside the worktree: ${bridge}`);
  const details = await detailsOrNull(destination);
  if (details?.isSymbolicLink()) {
    // A repository that already links CLAUDE.md to AGENTS.md needs no bridge.
    // Writing through any other link could modify files outside the treatment.
    if (path.resolve(path.dirname(destination), await readlink(destination)) === targetPath) return 'symlinked';
    throw new Error(`Refusing to write an instruction bridge through symlinked ${bridge}.`);
  }
  if (details && !details.isFile()) throw new Error(`Instruction bridge path is not a regular file: ${bridge}`);
  if (!details) { await writeFile(destination, `${importLine}\n`, 'utf8'); return 'created'; }
  const existing = await readFile(destination, 'utf8');
  const imports = new Set([importLine, importLine.replace('@', '@./')]);
  if (existing.split(/\r?\n/).some((line) => imports.has(line.trim()))) return 'already-imported';
  const separator = !existing ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  await writeFile(destination, `${existing}${separator}${importLine}\n`, 'utf8');
  return 'appended';
}

export async function pathExistsAtRef(repository, ref, file) {
  const result = await git(['cat-file', '-e', `${ref}:${file.replaceAll('\\', '/')}`], repository, { allowFailure: true });
  return result.code === 0;
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
  const entries = result.stdout.split('\0');
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (file) files.push(file);
    if (/[RC]/.test(status)) index += 1;
  }
  return [...new Set(files)].sort();
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
      const target = path.join(worktree, file);
      if ((await lstat(target)).isSymbolicLink()) continue;
      const content = await readFile(target);
      if (content.includes(0)) continue;
      const text = content.toString('utf8');
      additions += text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
    } catch { /* Unreadable and binary files still count as changed files, but not text lines. */ }
  }
  return { additions, deletions, total: additions + deletions };
}

export async function currentCommit(root, ref = 'HEAD') {
  const result = await git(['rev-parse', '--verify', `${ref}^{commit}`], root);
  return result.stdout.trim();
}
