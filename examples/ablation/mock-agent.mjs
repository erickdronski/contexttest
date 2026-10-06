import { readFile, writeFile } from 'node:fs/promises';

// A deterministic stand-in for an agent. Only the "Public API" rule changes
// what it does; the formatting and pull-request rules are read and ignored,
// which is exactly what an ablation should be able to show.
let instructions = '';
try { instructions = await readFile('AGENTS.md', 'utf8'); } catch { /* An arm may have no instructions. */ }
const target = 'examples/ablation/fixture/inventory.mjs';
const existing = await readFile(target, 'utf8');
const removeItem = 'export function removeItem(items, item) {\n  return items.filter((candidate) => candidate !== item);\n}\n';
const preserveExports = instructions.includes('Preserve every existing export');
await writeFile(target, preserveExports ? `${existing}\n${removeItem}` : removeItem, 'utf8');
process.stdout.write(preserveExports ? 'Added removeItem beside the existing exports.\n' : 'Rewrote inventory.mjs around removeItem.\n');
