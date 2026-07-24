import { readFile, writeFile } from 'node:fs/promises';

let instructions = '';
try { instructions = await readFile('AGENTS.md', 'utf8'); } catch { /* Baseline intentionally has no instructions. */ }
const target = 'examples/calculator/fixture/calculator.mjs';
const existing = await readFile(target, 'utf8');
const implementation = instructions.includes('safeDivide')
  ? `${existing}\nexport function safeDivide(dividend, divisor) {\n  return divisor === 0 ? null : dividend / divisor;\n}\n`
  : `export const divide = (left, right) => left / right;\n`;
await writeFile(target, implementation, 'utf8');
process.stdout.write(instructions ? 'Applied repository instructions.\n' : 'Completed without repository instructions.\n');
