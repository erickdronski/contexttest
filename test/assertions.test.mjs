import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { evaluateAssertions } from '../src/lib/assertions.mjs';

const exec = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-assertions-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  await exec('git', ['init'], { cwd: root, env });
  await writeFile(path.join(root, 'kept.txt'), 'before\n');
  await exec('git', ['add', '.'], { cwd: root, env });
  await exec('git', ['commit', '-m', 'fixture'], { cwd: root, env });
  await writeFile(path.join(root, 'kept.txt'), 'before\nafter\n');
  await writeFile(path.join(root, 'created.txt'), 'needle\n');
  return root;
}

test('evaluates filesystem, diff, process, and output assertions', async () => {
  const root = await fixture();
  const evaluation = await evaluateAssertions({
    worktree: root, agentResult: { code: 0, stdout: 'verified outcome', stderr: '' }, environment: { inherit: false },
    assertions: [
      { type: 'command', command: [process.execPath, '-e', 'process.exit(0)'] },
      { type: 'minChangedFiles', value: 2 },
      { type: 'maxChangedFiles', value: 2 },
      { type: 'maxDiffLines', value: 5 },
      { type: 'allowedPaths', patterns: ['*.txt'] },
      { type: 'forbiddenPaths', patterns: ['secrets/**'] },
      { type: 'requiredFile', path: 'created.txt' },
      { type: 'forbiddenFile', path: 'forbidden.txt' },
      { type: 'fileContains', path: 'created.txt', value: 'needle' },
      { type: 'stdoutContains', value: 'verified' },
      { type: 'stdoutNotContains', value: 'failure' }
    ],
  });
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.results.length, 12);
});

test('unknown assertions fail explicitly', async () => {
  const root = await fixture();
  const evaluation = await evaluateAssertions({ worktree: root, agentResult: { code: 0, stdout: '', stderr: '' }, assertions: [{ type: 'imaginary' }], environment: {} });
  assert.equal(evaluation.passed, false);
  assert.match(evaluation.results[1].message, /Unknown assertion/);
});

test('redacts assertion diagnostics and does not echo command arguments', async () => {
  const root = await fixture();
  const secret = 'hunter2-value';
  const evaluation = await evaluateAssertions({
    worktree: root,
    agentResult: { code: 0, stdout: '', stderr: '' },
    environment: { inherit: false, set: { TEST_API_KEY: secret } },
    assertions: [{ type: 'command', label: 'secret-safe check', command: [process.execPath, '-e', 'process.stdout.write(process.env.TEST_API_KEY); process.exit(1)'] }],
  });
  const commandResult = evaluation.results[1];
  assert.equal(commandResult.pass, false);
  assert.equal(commandResult.stdout, '[REDACTED]');
  assert.equal(commandResult.message, 'secret-safe check exited 1.');
  assert.equal(JSON.stringify(commandResult).includes(secret), false);
  assert.equal(commandResult.message.includes('process.stdout'), false);
});

test('file assertions do not follow symlinks outside the worktree', { skip: process.platform === 'win32' }, async () => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contexttest-assertion-outside-'));
  await writeFile(path.join(outside, 'secret.txt'), 'needle\n');
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'linked.txt'));
  const evaluation = await evaluateAssertions({
    worktree: root,
    agentResult: { code: 0, stdout: '', stderr: '' },
    environment: {},
    assertions: [
      { type: 'requiredFile', path: 'linked.txt' },
      { type: 'fileContains', path: 'linked.txt', value: 'needle' },
    ],
  });
  assert.equal(evaluation.results[1].pass, false);
  assert.equal(evaluation.results[2].pass, false);
});
