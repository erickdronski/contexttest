import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'contexttest-smoke-'));
const cache = path.join(temporaryRoot, 'npm-cache');
const consumer = path.join(temporaryRoot, 'consumer');
const environment = {
  ...process.env,
  npm_config_cache: cache,
  GIT_AUTHOR_NAME: 'ContextTest Smoke',
  GIT_AUTHOR_EMAIL: 'contexttest@localhost',
  GIT_COMMITTER_NAME: 'ContextTest Smoke',
  GIT_COMMITTER_EMAIL: 'contexttest@localhost',
};

async function run(command, args, cwd = consumer) {
  return exec(command, args, { cwd, env: environment, maxBuffer: 10_000_000 });
}

try {
  await mkdir(consumer, { recursive: true });
  const packed = await run('npm', ['pack', '--json', '--pack-destination', temporaryRoot], projectRoot);
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = path.join(temporaryRoot, filename);
  await run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', tarball]);
  const bin = path.join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'contexttest.cmd' : 'contexttest');
  const version = (await run(bin, ['--version'])).stdout.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Installed CLI returned an invalid version: ${version}`);

  await run('git', ['init']);
  await run(bin, ['init']);
  await writeFile(path.join(consumer, 'value.txt'), 'original\n');
  await writeFile(path.join(consumer, 'agent.mjs'), `
    import { readFile, writeFile } from 'node:fs/promises';
    let instructions = ''; try { instructions = await readFile('AGENTS.md', 'utf8'); } catch {}
    await writeFile('value.txt', instructions.includes('MAKE_EXPECTED_CHANGE') ? 'expected\\n' : 'wrong\\n');
  `);
  const configPath = path.join(consumer, 'contexttest.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.project = 'clean-install-smoke';
  config.agent = { provider: 'mock', timeoutMinutes: 1 };
  config.trials = { attempts: 1, concurrency: 1 };
  config.variants = [{ name: 'without', disabled: true }, { name: 'with', content: '# Rules\n\n## Change\n\nMAKE_EXPECTED_CHANGE\n\n## Tone\n\nBe brief.\n' }];
  config.tasks = [{ name: 'change', prompt: 'change value', mock: { command: [process.execPath, 'agent.mjs'] }, assertions: [{ type: 'fileContains', path: 'value.txt', value: 'expected' }] }];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await run('git', ['add', '.gitignore', 'AGENTS.candidate.md', 'agent.mjs', 'contexttest.json', 'value.txt']);
  await run('git', ['commit', '-m', 'smoke fixture']);

  const experiment = await run(bin, ['run', '--json']);
  const report = JSON.parse(experiment.stdout.trim());
  if (report.comparison.winner !== 'candidate') throw new Error(`Expected candidate to lead; got ${report.comparison.winner}`);
  for (const artifact of [report.artifacts.json, report.artifacts.html]) await readFile(artifact);

  const ablation = JSON.parse((await run(bin, ['ablate', '--json'])).stdout.trim());
  const readings = ablation.effects.map((effect) => `${effect.section.title}:${effect.reading}`).join(', ');
  if (readings !== 'Change:helps, Tone:no clear effect') throw new Error(`Unexpected ablation readings: ${readings}`);
  await run(bin, ['report', ablation.artifacts.json]);

  const second = JSON.parse((await run(bin, ['run', '--json', '--seed', '3'])).stdout.trim());
  const pooled = JSON.parse((await run(bin, ['aggregate', report.artifacts.json, second.artifacts.json, '--json'])).stdout.trim());
  if (pooled.kind !== 'aggregate' || pooled.comparison.paired.pairs !== 2) throw new Error(`Unexpected aggregate: ${pooled.kind} with ${pooled.comparison.paired.pairs} pairs`);
  await run(bin, ['report', pooled.artifacts.json]);
  process.stdout.write(`Clean-install smoke passed for ContextTest ${version}.\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
