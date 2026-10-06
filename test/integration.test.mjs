import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { describeAgent, describeTreatment, runExperiment, scheduleTrials } from '../src/lib/engine.mjs';
import { renderHtmlReport, renderTerminalReport } from '../src/lib/reporter.mjs';

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

test('compares two agents on the same instructions and says only the agent differed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-cross-agent-'));
  await git(root, 'init');
  await writeFile(path.join(root, 'value.txt'), 'original\n');
  await writeFile(path.join(root, 'rules.md'), 'MAKE_GOOD_CHANGE\n');
  await writeFile(path.join(root, 'agent.mjs'), `
    import { readFile, writeFile } from 'node:fs/promises';
    const rules = await readFile('AGENTS.md', 'utf8');
    const careful = process.argv[2] === 'careful';
    await writeFile('value.txt', careful && rules.includes('MAKE_GOOD_CHANGE') ? 'expected\\n' : 'wrong\\n');
  `);
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'fixture');
  const config = {
    version: 1, project: 'cross-agent', agent: { provider: 'command', command: [process.execPath, 'agent.mjs', 'hasty'], timeoutMinutes: 1 },
    trials: { attempts: 2, concurrency: 1 }, environment: { inherit: false },
    variants: [
      { name: 'hasty-agent', source: 'rules.md' },
      { name: 'careful-agent', source: 'rules.md', agent: { command: [process.execPath, 'agent.mjs', 'careful'] } },
    ],
    tasks: [{ name: 'change', prompt: 'change the value', assertions: [{ type: 'fileContains', path: 'value.txt', value: 'expected' }] }],
  };
  const report = await runExperiment({ config, root });
  assert.equal(report.comparison.winner, 'candidate');
  assert.deepEqual(report.treatment.differs, ['agent']);
  assert.deepEqual(report.treatment.agentSettings, ['command']);
  assert.equal(report.treatment.summary, 'Only the agent differs (settings: command); both arms receive the same instructions.');
  assert.notEqual(report.variants[0].agent.digest, report.variants[1].agent.digest);
  assert.equal(report.variants[0].instructions.digest, report.variants[1].instructions.digest);
  assert.equal(report.comparison.treatmentDelivery, 'unknown');
  assert.match(report.comparison.deliveryCheck.reason, /different agents/);
  assert.deepEqual(report.variants[1].invocation.args.slice(-2), ['agent.mjs', 'careful']);
  const terminal = renderTerminalReport(report, { color: false });
  assert.match(terminal, /Agent +command +command/);
  assert.match(terminal, /Only the agent differs/);
  assert.match(renderHtmlReport(report), /<p class="treatment">Only the agent differs/);
  assert.deepEqual(report.warnings, []);
});

test('names both changes when instructions and agent differ, and recognizes an A/A comparison', () => {
  const codex = { provider: 'codex', model: 'gpt-x' };
  const claude = { provider: 'claude', model: 'opus', isolate: true };
  const arm = (agent, digest) => ({ agent: describeAgent(agent), instructions: { digest } });
  const confounded = describeTreatment(arm(codex, null), arm(claude, 'abc'), [codex, claude]);
  assert.deepEqual(confounded.differs, ['instructions', 'agent']);
  assert.equal(confounded.summary, 'Instructions and agent both differ (codex · gpt-x vs claude · opus); the result cannot be attributed to either one alone.');
  assert.deepEqual(confounded.agentSettings, ['isolate', 'model', 'provider']);
  const instructionsOnly = describeTreatment(arm(codex, null), arm(codex, 'abc'), [codex, codex]);
  assert.equal(instructionsOnly.summary, 'Only the instructions differ; both arms use codex · gpt-x.');
  const same = describeTreatment(arm(codex, 'abc'), arm(codex, 'abc'), [codex, codex]);
  assert.deepEqual(same.differs, []);
  assert.match(same.summary, /A\/A comparison/);
});

test('a seed shuffles task and attempt blocks reproducibly without splitting pairs', () => {
  const tasks = ['alpha', 'beta', 'gamma'].map((name) => ({ name }));
  const arms = [{ name: 'baseline' }, { name: 'candidate' }];
  const describe = (jobs) => jobs.map((job) => `${job.task.name}#${job.attempt}:${job.arm.name}`);
  const sequential = describe(scheduleTrials({ tasks, arms, attempts: 4 }));
  assert.deepEqual(sequential.slice(0, 4), ['alpha#1:baseline', 'alpha#1:candidate', 'alpha#2:candidate', 'alpha#2:baseline']);
  const seeded = scheduleTrials({ tasks, arms, attempts: 4, seed: 11 });
  assert.deepEqual(describe(scheduleTrials({ tasks, arms, attempts: 4, seed: 11 })), describe(seeded));
  assert.notDeepEqual(describe(seeded), sequential);
  assert.notDeepEqual(describe(scheduleTrials({ tasks, arms, attempts: 4, seed: 12 })), describe(seeded));
  assert.deepEqual([...describe(seeded)].sort(), [...sequential].sort());
  for (let index = 0; index < seeded.length; index += 2) {
    const [first, second] = [seeded[index], seeded[index + 1]];
    assert.equal(`${first.task.name}#${first.attempt}`, `${second.task.name}#${second.attempt}`, 'both arms of a pair run back to back');
    assert.equal(first.arm.name, first.attempt % 2 ? 'baseline' : 'candidate', 'order still alternates by attempt');
  }
});
