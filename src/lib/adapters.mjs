import path from 'node:path';
import { environmentSecrets, interpolate, redact, runProcess, safeEnvironment } from './utils.mjs';

// Which instruction files each agent loads by itself. Anything else reaches the
// agent only if the repository or prompt points at it, so ContextTest cannot
// promise the treatment was delivered.
const NATIVE_INSTRUCTION_FILES = {
  codex: new Set(['AGENTS.md', 'AGENTS.override.md']),
  claude: new Set(['CLAUDE.md', 'CLAUDE.local.md']),
};
export const CLAUDE_BRIDGE_IMPORT = '@AGENTS.md';

export function deliveryFor(provider, instructionFile = 'AGENTS.md') {
  const file = instructionFile.replaceAll('\\', '/');
  const name = path.posix.basename(file);
  if (!NATIVE_INSTRUCTION_FILES[provider]) return { file, method: 'unknown', bridgedVia: null };
  if (NATIVE_INSTRUCTION_FILES[provider].has(name)) return { file, method: 'native', bridgedVia: null };
  // Claude Code reads CLAUDE.md, not AGENTS.md. A sibling CLAUDE.md that imports
  // AGENTS.md delivers the same text without rewriting the file under test.
  if (provider === 'claude' && name === 'AGENTS.md') {
    const bridge = path.posix.join(path.posix.dirname(file), 'CLAUDE.md');
    return { file, method: 'bridged', bridgedVia: `${bridge} @import`, bridge };
  }
  return { file, method: 'unverified', bridgedVia: null };
}

const PROVIDER_NAMES = { codex: 'Codex', claude: 'Claude Code' };

// Plain-language consequence of a delivery method, or null when nothing is at risk.
export function deliveryWarning(provider, delivery) {
  if (delivery.method !== 'unverified') return null;
  const loader = provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
  return `${PROVIDER_NAMES[provider] ?? provider} does not load ${delivery.file} by itself. Reference it from ${loader} or the task prompt, or the treatment may never reach the agent.`;
}

// Recognize runs where the agent never started, so they invalidate the
// experiment instead of being scored as the agent failing the task.
export function agentStartFailure(agent, result) {
  if (result.spawnError) return `Could not start ${result.command}: ${result.spawnError}. Check that the agent executable is installed and on PATH.`;
  if (agent.provider === 'claude') {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const usage = result.usage ?? {};
    const consumed = (usage.inputTokens ?? 0) + (usage.cachedInputTokens ?? 0) + (usage.outputTokens ?? 0);
    if (output.includes('[claude-code:unrecognized_model]') && consumed === 0) {
      return `Claude Code did not recognize model ${JSON.stringify(agent.model ?? 'default')}; the agent never ran. Check agent.model.`;
    }
    // A reported result with zero turns and zero tokens means Claude Code
    // stopped before asking the model anything. A timeout is different: the
    // agent was working, so it stays a scored outcome.
    if (result.code !== 0 && !result.timedOut && usage.requests === 0 && consumed === 0) {
      return `Claude Code exited with code ${result.code} before its first turn; the agent never ran.`;
    }
  }
  return null;
}

export function parseCodexUsage(stdout) {
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null };
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      const candidate = event.usage ?? event.data?.usage ?? event.item?.usage;
      if (!candidate) continue;
      usage.inputTokens = Math.max(usage.inputTokens, candidate.input_tokens ?? candidate.inputTokens ?? 0);
      usage.cachedInputTokens = Math.max(usage.cachedInputTokens, candidate.cached_input_tokens ?? candidate.cachedInputTokens ?? 0);
      usage.outputTokens = Math.max(usage.outputTokens, candidate.output_tokens ?? candidate.outputTokens ?? 0);
    } catch { /* Non-JSON diagnostic lines are expected. */ }
  }
  return usage;
}

function lastJsonObject(stdout) {
  try { return JSON.parse(stdout); } catch { /* Diagnostics can precede the result object. */ }
  for (const line of stdout.trim().split('\n').reverse()) {
    try { const value = JSON.parse(line); if (value && typeof value === 'object') return value; } catch { /* Keep looking. */ }
  }
  return null;
}

export function parseClaudeUsage(stdout) {
  const data = lastJsonObject(stdout);
  if (!data) return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null, requests: null };
  const candidate = data.usage ?? {};
  return {
    inputTokens: candidate.input_tokens ?? 0,
    cachedInputTokens: (candidate.cache_read_input_tokens ?? 0) + (candidate.cache_creation_input_tokens ?? 0),
    outputTokens: candidate.output_tokens ?? 0,
    costUsd: data.total_cost_usd ?? null,
    requests: Number.isInteger(data.num_turns) ? data.num_turns : null,
  };
}

export function buildCommand(agent, prompt, cwd) {
  if (agent.provider === 'codex') {
    const args = ['exec', '--ephemeral', '--sandbox', 'workspace-write', '--color', 'never', '--json', '-C', cwd];
    if (agent.model) args.push('--model', agent.model);
    if (agent.ignoreUserConfig) args.push('--ignore-user-config');
    args.push(prompt);
    return { command: agent.executable ?? 'codex', args, parseUsage: parseCodexUsage };
  }
  if (agent.provider === 'claude') {
    const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', agent.permissionMode ?? 'acceptEdits', '--max-turns', String(agent.maxTurns ?? 30)];
    if (agent.model) args.push('--model', agent.model);
    if (agent.allowedTools?.length) args.push('--allowedTools', agent.allowedTools.join(','));
    if (agent.disallowedTools?.length) args.push('--disallowedTools', agent.disallowedTools.join(','));
    return { command: agent.executable ?? 'claude', args, parseUsage: parseClaudeUsage };
  }
  if (agent.provider === 'command') {
    const variables = { prompt, cwd };
    const [command, ...args] = agent.command.map((part) => interpolate(part, variables));
    return { command, args, parseUsage: () => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null }) };
  }
  throw new Error(`Unsupported real agent provider: ${agent.provider}`);
}

export async function runAgent({ agent, prompt, cwd, environment, onOutput, mock }) {
  const env = safeEnvironment(environment);
  const secrets = environmentSecrets(environment, { ...process.env, ...env });
  if (agent.provider === 'mock') {
    if (!mock?.command) throw new Error('Mock tasks require mock.command.');
    const [command, ...args] = mock.command.map((part) => interpolate(part, { prompt, cwd }));
    const result = await runProcess(command, args, { cwd, env, timeoutMs: (agent.timeoutMinutes ?? 5) * 60_000, onStdout: onOutput });
    return { ...result, stdout: redact(result.stdout, secrets), stderr: redact(result.stderr, secrets), usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null } };
  }
  const invocation = buildCommand(agent, prompt, cwd);
  const result = await runProcess(invocation.command, invocation.args, {
    cwd,
    env,
    timeoutMs: (agent.timeoutMinutes ?? 20) * 60_000,
    onStdout: onOutput,
  });
  return {
    ...result,
    stdout: redact(result.stdout, secrets),
    stderr: redact(result.stderr, secrets),
    usage: invocation.parseUsage(result.stdout),
    invocation: { command: invocation.command, args: invocation.args.map((arg) => arg === prompt ? '[PROMPT]' : redact(arg, secrets)) },
  };
}
