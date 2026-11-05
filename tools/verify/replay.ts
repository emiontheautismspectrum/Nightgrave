/** npm run verify:replay -- <file.json>: verify one exported submission (a pending item as JSON) locally. */
import { readFileSync } from 'node:fs';
import { parseItem, verifyItem } from './core';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run verify:replay -- <submission.json>');
  process.exit(2);
}
const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
const it = parseItem({ id: '0-0', ...(raw as object) });
if (!it) {
  console.log('rejected (invalid_input): malformed submission');
  process.exit(1);
}
const t0 = performance.now();
const v = verifyItem(it);
const ms = performance.now() - t0;
console.log(`${v.status}${v.status === 'rejected' ? ` (${v.reason})` : ''}: ${it.durationTicks} ticks in ${ms.toFixed(1)} ms (${Math.round((it.durationTicks / ms) * 1000)} ticks/s)`);
process.exit(v.status === 'verified' ? 0 : 1);
