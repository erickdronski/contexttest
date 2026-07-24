import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const roots = ['src', 'test', 'scripts', 'examples', 'schema'];
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(target);
    return /\.(?:mjs|json)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}
const files = (await Promise.all(roots.map(collect))).flat().sort();
let failures = 0;
for (const file of files) {
  const content = await readFile(file, 'utf8');
  if (/\s+$/.test(content) && !content.endsWith('\n')) { process.stderr.write(`${file}: missing final newline\n`); failures += 1; }
  if (file.endsWith('.json')) {
    try { JSON.parse(content); } catch (error) { process.stderr.write(`${file}: ${error.message}\n`); failures += 1; }
  }
  if (file.endsWith('.mjs')) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
    catch (error) { process.stderr.write(`${file}: ${error.stderr?.toString() || error.message}\n`); failures += 1; }
  }
}
if (failures) process.exitCode = 1;
else process.stdout.write(`Checked ${files.length} source files.\n`);
