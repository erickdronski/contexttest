import { environmentSecrets, interpolate, redact, runProcess, safeEnvironment } from './utils.mjs';

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

export function parseClaudeUsage(stdout) {
  try {
    const data = JSON.parse(stdout);
    const candidate = data.usage ?? {};
    return {
      inputTokens: candidate.input_tokens ?? 0,
      cachedInputTokens: (candidate.cache_read_input_tokens ?? 0) + (candidate.cache_creation_input_tokens ?? 0),
      outputTokens: candidate.output_tokens ?? 0,
      costUsd: data.total_cost_usd ?? null,
    };
  } catch {
    return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null };
  }
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
