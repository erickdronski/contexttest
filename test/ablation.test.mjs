import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { analyzeAblation, planAblation, runAblation } from '../src/lib/ablation.mjs';
import { renderAblationTerminal, renderReport } from '../src/lib/reporter.mjs';

const exec = promisify(execFile);
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };

const RULES = '# Rules\n\nShared preamble.\n\n## Style\n\n- Two spaces.\n\n## Behavior\n\n- MAKE_GOOD_CHANGE\n\n## Release <notes>\n\n- Tag from main.\n';

// The agent passes only when the "Behavior" section is present.
async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'contexttest-ablation-'));
  await exec('git', ['init'], { cwd: root, env: gitEnv });
  await writeFile(path.join(root, 'value.txt'), 'original\n');
  await writeFile(path.join(root, 'rules.md'), RULES);
  await writeFile(path.join(root, 'agent.mjs'), "import { readFile, writeFile } from 'node:fs/promises';\nlet rules = ''; try { rules = await readFile('AGENTS.md', 'utf8'); } catch {}\nawait writeFile('value.txt', rules.includes('MAKE_GOOD_CHANGE') ? 'expected\\n' : 'wrong\\n');\n");
  await exec('git', ['add', '.'], { cwd: root, env: gitEnv });
  await exec('git', ['commit', '-m', 'fixture'], { cwd: root, env: gitEnv });
  return root;
}

function config(overrides = {}) {
  return {
    version: 1, project: 'ablation', agent: { provider: 'mock', timeoutMinutes: 1 }, trials: { attempts: 2, concurrency: 2 }, environment: { inherit: false },
    variants: [{ name: 'without', disabled: true }, { name: 'with', source: 'rules.md' }],
    tasks: [
      { name: 'first', prompt: 'change the value', mock: { command: [process.execPath, 'agent.mjs'] }, assertions: [{ type: 'fileContains', path: 'value.txt', value: 'expected' }] },
      { name: 'second', prompt: 'change the value again', mock: { command: [process.execPath, 'agent.mjs'] }, assertions: [{ type: 'fileContains', path: 'value.txt', value: 'expected' }] },
    ],
    ...overrides,
  };
}

test('ablates each section against one shared full arm and finds the section that matters', async () => {
  const root = await repository();
  const started = [];
  const report = await runAblation({ config: config(), root, onEvent: (event) => { if (event.type === 'trial:start') started.push(`${event.task.name}#${event.attempt}:${event.arm.name}`); } });
  assert.equal(report.kind, 'ablation');
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.arms.map((arm) => [arm.name, arm.trials.length]), [['full', 4], ['without-1', 4], ['without-2', 4], ['without-3', 4]], 'the full arm runs once per task and attempt, not once per section');
  assert.equal(report.experiment.plannedTrials, 16);
  assert.deepEqual(report.effects.map((effect) => [effect.section.title, effect.reading, effect.deltas.passRate]), [['Style', 'no clear effect', 0], ['Behavior', 'helps', 1], ['Release <notes>', 'no clear effect', 0]]);
  const behavior = report.effects[1];
  assert.deepEqual([behavior.comparison.paired.pairs, behavior.comparison.paired.rightWins], [4, 4]);
  assert.equal(behavior.comparison.pValue, 0.125);
  assert.equal(behavior.adjustedPValue, 0.375, 'Holm across three sections');
  assert.equal(behavior.signal, 'early');
  assert.deepEqual(behavior.taskResults.map((task) => task.passRates), [[0, 1], [0, 1]]);
  assert.deepEqual(started.slice(0, 8), ['first#1:full', 'first#1:without-1', 'first#1:without-2', 'first#1:without-3', 'first#2:without-3', 'first#2:without-2', 'first#2:without-1', 'first#2:full']);
  assert.equal(report.ablation.preamble.lines, 4);
  assert.deepEqual(report.ablation.sections.map((section) => section.selected), [true, true, true]);
  assert.equal(report.arms[0].instructions.bytes, Buffer.byteLength(RULES));
  assert.equal(report.arms[2].instructions.bytes, Buffer.byteLength(RULES) - report.ablation.sections[1].bytes);
  const listed = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: root });
  assert.equal(listed.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length, 1, 'every trial worktree is removed');
  await assert.rejects(() => access(path.join(root, '.contexttest', 'worktrees', report.runId)));
  const html = renderReport(JSON.parse(await readFile(report.artifacts.json, 'utf8')));
  assert.equal(html, await readFile(report.artifacts.html, 'utf8'));
  assert.match(html, /§3 Release &lt;notes&gt;/);
  assert.equal(html.includes('MAKE_GOOD_CHANGE'), false, 'section bodies never enter the report');
  assert.match(renderAblationTerminal(report, { color: false }), /§2 Behavior +4 +0% +\+100 pp/);
});

test('plans the budget without running anything and honors --sections', async () => {
  const root = await repository();
  const plan = await planAblation({ config: config(), root, sections: 'behavior', taskFilter: 'first' });
  assert.deepEqual(plan.arms.map((arm) => arm.name), ['full', 'without-2']);
  assert.deepEqual(plan.budget, { arms: 2, tasks: 1, attempts: 2, trials: 4, separateExperiments: 4 });
  const all = await planAblation({ config: config(), root });
  assert.deepEqual([all.budget.trials, all.budget.separateExperiments], [16, 24]);
  assert.equal(all.variant.name, 'with', 'defaults to the variant that has instructions');
});

test('refuses ablations that cannot mean anything before any worktree exists', async () => {
  const root = await repository();
  await assert.rejects(() => planAblation({ config: config(), root, variantName: 'without' }), /Variant without is disabled/);
  await assert.rejects(() => planAblation({ config: config(), root, variantName: 'other' }), /No variant named other\. Variants: without, with\./);
  await assert.rejects(() => planAblation({ config: config({ variants: [{ name: 'a', disabled: true }, { name: 'b', disabled: true }] }), root }), /Both variants are disabled/);
  await assert.rejects(() => planAblation({ config: config(), root, level: 3 }), /no level-3 headings to ablate \(headings found: 1 at level 1, 3 at level 2\)/);
  await assert.rejects(() => planAblation({ config: config({ variants: [{ name: 'a', disabled: true }, { name: 'b', content: 'no headings here' }] }), root }), /b \(inline content\) has no level-2 headings/);
});

test('refuses an instruction source that links outside the project', { skip: process.platform === 'win32' }, async () => {
  const root = await repository();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contexttest-ablation-outside-'));
  await writeFile(path.join(outside, 'secret.md'), '## Secret\n\nprivate\n');
  await symlink(path.join(outside, 'secret.md'), path.join(root, 'linked.md'));
  const linked = config({ variants: [{ name: 'without', disabled: true }, { name: 'with', source: 'linked.md' }] });
  await assert.rejects(() => runAblation({ config: linked, root }), /traverses a symlink outside the project root/);
});

test('an arm whose agent cannot start invalidates the whole ablation', async () => {
  const root = await repository();
  const broken = config();
  for (const task of broken.tasks) task.mock = { command: ['contexttest-definitely-missing-agent'] };
  await assert.rejects(() => runAblation({ config: broken, root }), /failed before the agent could run[\s\S]*Could not start/);
  const listed = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: root });
  assert.equal(listed.stdout.split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
});

test('duration alone never makes a section helpful or harmful', () => {
  const trial = (variant, attempt, durationMs) => ({ task: 't', variant, attempt, passed: true, score: 1, durationMs, files: [], diff: { total: 0 }, usage: {} });
  const arm = (name, durationMs) => ({ name, section: name === 'full' ? null : { index: 1, title: 'Notes', lines: 3, bytes: 40 }, instructions: { bytes: name === 'full' ? 140 : 100 }, trials: [1, 2, 3].map((attempt) => trial(name, attempt, durationMs)) });
  const { effects } = analyzeAblation({ arms: [arm('full', 1000), arm('without-1', 400)], tasks: ['t'], provider: 'mock' });
  assert.equal(effects[0].comparison.basis, 'duration');
  assert.equal(effects[0].reading, 'no clear effect');
  assert.equal(effects[0].deltas.medianDurationMs, 600, 'the measurement is still reported');
});
