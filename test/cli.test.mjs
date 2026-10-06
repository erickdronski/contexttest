import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

test('ablate --dry-run prints the plan and budget without creating anything', async () => {
  const root = await repository();
  const config = JSON.parse(await readFile(path.join(root, 'contexttest.json'), 'utf8'));
  config.variants[1].content = '# Rules\n\n## One\n\nGOOD\n\n## Two\n\nnoise\n';
  await writeFile(path.join(root, 'contexttest.json'), `${JSON.stringify(config, null, 2)}\n`);
  const result = await contexttest(root, 'ablate', '--dry-run', '--attempts', '4');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Budget: 3 arms \(full \+ 2 without one section\) × 1 task\(s\) × 4 attempt\(s\) = 12 agent runs\./);
  assert.match(result.stdout, /would take 16\./);
  assert.match(result.stdout, /Dry run: no worktrees were created/);
  await assert.rejects(() => access(path.join(root, '.contexttest')), 'nothing was written');
  const json = await contexttest(root, 'ablate', '--dry-run', '--json', '--sections', 'two');
  assert.deepEqual(JSON.parse(json.stdout).budget, { arms: 2, tasks: 1, attempts: 3, trials: 6, separateExperiments: 6 });
  const unknown = await contexttest(root, 'ablate', '--dry-run', '--sections', 'three');
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /No level-2 section matches "three"/);
});

test('report regenerates HTML for old and new report kinds and refuses unknown ones', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contexttest-report-'));
  const legacy = path.join(directory, 'report.json');
  await writeFile(legacy, await readFile(new URL('./fixtures/report-v0.2.0.json', import.meta.url)));
  const rendered = await contexttest(directory, 'report', legacy);
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.match(rendered.stdout, /\(experiment report\)/);
  assert.match(await readFile(path.join(directory, 'report.html'), 'utf8'), /^<!doctype html>/);
  const ablation = new URL('../examples/ablation/output/report.json', import.meta.url);
  const output = path.join(directory, 'ablation.html');
  const ablated = await contexttest(directory, 'report', fileURLToPath(ablation), '--output', output);
  assert.equal(ablated.code, 0, ablated.stderr);
  assert.equal(await readFile(output, 'utf8'), await readFile(new URL('../examples/ablation/output/report.html', import.meta.url), 'utf8'));
  await writeFile(path.join(directory, 'future.json'), JSON.stringify({ schemaVersion: 9, kind: 'experiment' }));
  const future = await contexttest(directory, 'report', 'future.json');
  assert.equal(future.code, 1);
  assert.match(future.stderr, /schemaVersion 9/);
});

test('aggregate pools committed runs, writes both artifacts, and explains refusals', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'contexttest-cli-aggregate-'));
  const runs = ['first', 'second'].map((name) => fileURLToPath(new URL(`../examples/aggregate/runs/${name}/report.json`, import.meta.url)));
  const pooled = await contexttest(directory, 'aggregate', ...runs, '--out', 'pooled', '--json');
  assert.equal(pooled.code, 0, pooled.stderr);
  const report = JSON.parse(pooled.stdout.trim());
  assert.deepEqual([report.kind, report.comparison.paired.pairs, report.comparison.signal], ['aggregate', 6, 'convincing']);
  assert.match(await readFile(path.join(directory, 'pooled', 'report.html'), 'utf8'), /More runs, <em>same<\/em> question/);
  const terminal = await contexttest(directory, 'aggregate', ...runs, '--out', 'again');
  assert.match(terminal.stdout, /SOURCE RUNS[\s\S]*calculator-demo-run-2/);
  const twice = await contexttest(directory, 'aggregate', runs[0], runs[0], '--out', 'twice');
  assert.equal(twice.code, 1);
  assert.match(twice.stderr, /appears more than once/);
  const ablation = fileURLToPath(new URL('../examples/ablation/output/report.json', import.meta.url));
  const mixed = await contexttest(directory, 'aggregate', runs[0], ablation, '--out', 'mixed');
  assert.equal(mixed.code, 1);
  assert.match(mixed.stderr, /is an ablation report/);
});
