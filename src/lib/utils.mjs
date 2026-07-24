import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const VERSION = '0.1.0';
export const SECRET_NAME = /(api[_-]?key|token|secret|password|passwd|credential|private[_-]?key|auth)/i;
export const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\b(?:Bearer\s+)[A-Za-z0-9._~+\/-]{16,}/gi,
];

export function slug(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'trial';
}

export function timestampId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

export async function ensureDir(target) {
  await mkdir(target, { recursive: true });
  return target;
}

export async function readJson(target) {
  const raw = await readFile(target, 'utf8');
  try { return JSON.parse(raw); } catch (error) {
    throw new Error(`Could not parse JSON at ${target}: ${error.message}`);
  }
}

export async function writeJson(target, value) {
  await ensureDir(path.dirname(target));
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function redact(value, additional = []) {
  let output = String(value ?? '');
  for (const secret of additional.filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (secret.length >= 6) output = output.split(secret).join('[REDACTED]');
  }
  for (const pattern of SECRET_VALUE_PATTERNS) output = output.replace(pattern, '[REDACTED]');
  return output;
}

export function safeEnvironment(config = {}, source = process.env) {
  const safeNames = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
    'TERM', 'COLORTERM', 'CI', 'GITHUB_ACTIONS', 'GITHUB_WORKSPACE', 'XDG_CONFIG_HOME',
    ...(config.allow ?? []),
  ]);
  if (config.inherit === true) {
    const inherited = { ...source };
    for (const name of config.deny ?? []) delete inherited[name];
    return inherited;
  }
  const result = {};
  for (const name of safeNames) if (source[name] !== undefined) result[name] = source[name];
  for (const [name, value] of Object.entries(config.set ?? {})) result[name] = String(value);
  for (const name of config.deny ?? []) delete result[name];
  return result;
}

export function secretValues(environment) {
  return Object.entries(environment).filter(([name, value]) => SECRET_NAME.test(name) && value).map(([, value]) => String(value));
}

export async function runProcess(command, args = [], options = {}) {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const limit = options.outputLimit ?? 2_000_000;
    const append = (current, chunk) => (current + chunk.toString()).slice(-limit);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); options.onStdout?.(chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); options.onStderr?.(chunk.toString()); });
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
      }
    }, timeoutMs);
    child.on('error', (error) => {
      settled = true; clearTimeout(timer);
      resolve({ command, args, code: 127, signal: null, stdout, stderr: `${stderr}${error.message}`, durationMs: Date.now() - started, timedOut: false });
    });
    child.on('close', (code, signal) => {
      settled = true; clearTimeout(timer);
      resolve({ command, args, code: code ?? 1, signal, stdout, stderr, durationMs: Date.now() - started, timedOut: signal === 'SIGTERM' || signal === 'SIGKILL' });
    });
  });
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) { positional.push(item); continue; }
    const [rawName, inline] = item.slice(2).split('=', 2);
    const name = rawName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inline !== undefined) flags[name] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) flags[name] = argv[++index];
    else flags[name] = true;
  }
  return { positional, flags };
}

export function relativeTo(base, target) {
  const relative = path.relative(base, target);
  return relative || '.';
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function formatMoney(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value < 1 ? 3 : 2)}` : '—';
}

export function interpolate(value, variables) {
  return String(value).replace(/\{([a-zA-Z][\w]*)\}/g, (_, name) => variables[name] ?? `{${name}}`);
}

export function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
