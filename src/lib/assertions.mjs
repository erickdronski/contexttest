import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { changedFiles, diffStats } from './git.mjs';
import { matchesAny } from './glob.mjs';
import { exists, isPathInside, runProcess, safeEnvironment } from './utils.mjs';

function result(type, pass, message, details = {}) { return { type, pass, message, ...details }; }

export async function evaluateAssertions({ assertions = [], worktree, agentResult, environment }) {
  const files = await changedFiles(worktree);
  const diff = await diffStats(worktree);
  const results = [result('agentExitCode', agentResult.code === 0, agentResult.code === 0 ? 'Agent completed successfully.' : `Agent exited with code ${agentResult.code}.`, { actual: agentResult.code, expected: 0 })];
  for (const assertion of assertions) {
    switch (assertion.type) {
      case 'command': {
        const command = Array.isArray(assertion.command) ? assertion.command : [];
        if (!command.length) { results.push(result('command', false, 'Command assertion requires an argument array.')); break; }
        const [executable, ...args] = command;
        const execution = await runProcess(executable, args, { cwd: worktree, env: safeEnvironment(environment), timeoutMs: (assertion.timeoutMinutes ?? 10) * 60_000 });
        results.push(result('command', execution.code === (assertion.exitCode ?? 0), `${command.join(' ')} ${execution.code === (assertion.exitCode ?? 0) ? 'passed' : `exited ${execution.code}`}.`, { actual: execution.code, expected: assertion.exitCode ?? 0, durationMs: execution.durationMs, stdout: execution.stdout.slice(-4000), stderr: execution.stderr.slice(-4000) }));
        break;
      }
      case 'maxChangedFiles': results.push(result(assertion.type, files.length <= assertion.value, `${files.length} changed file${files.length === 1 ? '' : 's'}; limit ${assertion.value}.`, { actual: files.length, expected: assertion.value })); break;
      case 'minChangedFiles': results.push(result(assertion.type, files.length >= assertion.value, `${files.length} changed file${files.length === 1 ? '' : 's'}; minimum ${assertion.value}.`, { actual: files.length, expected: assertion.value })); break;
      case 'maxDiffLines': results.push(result(assertion.type, diff.total <= assertion.value, `${diff.total} changed lines; limit ${assertion.value}.`, { actual: diff.total, expected: assertion.value })); break;
      case 'allowedPaths': {
        const violations = files.filter((file) => !matchesAny(file, assertion.patterns));
        results.push(result(assertion.type, violations.length === 0, violations.length ? `${violations.length} file(s) fell outside allowed paths.` : 'All changes stayed inside allowed paths.', { violations })); break;
      }
      case 'forbiddenPaths': {
        const violations = files.filter((file) => matchesAny(file, assertion.patterns));
        results.push(result(assertion.type, violations.length === 0, violations.length ? `${violations.length} forbidden path(s) changed.` : 'No forbidden paths changed.', { violations })); break;
      }
      case 'requiredFile': {
        const target = path.resolve(worktree, assertion.path);
        const pass = isPathInside(worktree, target) && await exists(target);
        results.push(result(assertion.type, pass, pass ? `${assertion.path} exists.` : `${assertion.path} is missing.`)); break;
      }
      case 'forbiddenFile': {
        const target = path.resolve(worktree, assertion.path);
        const present = isPathInside(worktree, target) && await exists(target);
        results.push(result(assertion.type, !present, present ? `${assertion.path} exists but is forbidden.` : `${assertion.path} was not created.`)); break;
      }
      case 'fileContains': {
        const target = path.resolve(worktree, assertion.path);
        let content = '';
        if (isPathInside(worktree, target) && await exists(target)) content = await readFile(target, 'utf8');
        const pass = content.includes(assertion.value);
        results.push(result(assertion.type, pass, pass ? `${assertion.path} contains the expected text.` : `${assertion.path} does not contain the expected text.`)); break;
      }
      case 'stdoutContains': {
        const pass = agentResult.stdout.includes(assertion.value);
        results.push(result(assertion.type, pass, pass ? 'Agent output contains the expected text.' : 'Agent output does not contain the expected text.')); break;
      }
      case 'stdoutNotContains': {
        const pass = !agentResult.stdout.includes(assertion.value);
        results.push(result(assertion.type, pass, pass ? 'Agent output excludes the forbidden text.' : 'Agent output contains forbidden text.')); break;
      }
      default: results.push(result(assertion.type ?? 'unknown', false, `Unknown assertion type: ${assertion.type}`));
    }
  }
  return { results, files, diff, passed: results.every((item) => item.pass), score: results.filter((item) => item.pass).length / results.length };
}
