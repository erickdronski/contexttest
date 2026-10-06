import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.mjs');
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };

async function contexttest(cwd, ...args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, ...args], { cwd, maxBuffer: 10_000_000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

// A repository whose config has no `trials` object, like many hand-written ones.
async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-cli-'));
  await exec('git', ['init'], { cwd: root, env: gitEnv });
  await writeFile(path.join(root, 'value.txt'), 'original\n');
  await writeFile(path.join(root, 'agent.mjs'), "import { readFile, writeFile } from 'node:fs/promises';\nlet rules = ''; try { rules = await readFile('AGENTS.md', 'utf8'); } catch {}\nawait writeFile('value.txt', rules.includes('GOOD') ? 'expected\\n' : 'wrong\\n');\n");
  await writeFile(path.join(root, 'contexttest.json'), `${JSON.stringify({
    version: 1, project: 'cli', agent: { provider: 'mock', timeoutMinutes: 1 }, environment: { inherit: false },
    variants: [{ name: 'without', disabled: true }, { name: 'with', content: 'GOOD\n' }],
    tasks: [{ name: 'change', prompt: 'change the value', mock: { command: [process.execPath, 'agent.mjs'] }, assertions: [{ type: 'fileContains', path: 'value.txt', value: 'expected' }] }],
  }, null, 2)}\n`);
  await exec('git', ['add', '.'], { cwd: root, env: gitEnv });
  await exec('git', ['commit', '-m', 'fixture'], { cwd: root, env: gitEnv });
  return root;
}

test('command-line overrides work on a config without a trials object and record the seed', async () => {
  const root = await repository();
  const result = await contexttest(root, 'run', '--attempts', '2', '--seed', '7', '--json');
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.experiment.attemptsPerVariant, 2);
  assert.deepEqual([report.experiment.order, report.experiment.seed], ['seeded', 7]);
  assert.equal(report.comparison.winner, 'candidate');
});

test('value flags without a value fail instead of silently becoming 1', async () => {
  const root = await repository();
  const missing = await contexttest(root, 'run', '--attempts');
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /--attempts requires a value/);
  const malformed = await contexttest(root, 'run', '--seed', 'abc');
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /--seed must be an integer/);
  const outOfRange = await contexttest(root, 'run', '--seed', '-1');
  assert.equal(outOfRange.code, 1);
  assert.match(outOfRange.stderr, /trials.seed must be an integer/);
});
