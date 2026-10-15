/**
 * Phase-0 gate: Axis Map and Default Role for the 50 most-used Std Codes.
 * Proposes them from the name rules and writes fixtures/dictionary/axis-role-overlay.json.
 * Rows already marked "reviewed" in the existing file are kept as they are.
 *
 *   pnpm tsx scripts/build-overlay.ts [N]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readWorkbook } from '@bom/sheets';
import { importDictionary, buildOverlay, type Overlay } from '@bom/dictionary';
import { at } from './paths';

const n = Number(process.argv[2] ?? 50);
const path = at('fixtures/dictionary/axis-role-overlay.json');
const grid = await readWorkbook(readFileSync(at('fixtures/dictionary/ref.xlsx')));
const { entries } = importDictionary(grid);
const proposed = buildOverlay(entries, n);
if (existsSync(path)) {
  const prev = JSON.parse(readFileSync(path, 'utf8')) as Overlay;
  const reviewed = new Map(prev.rows.filter((r) => r.status === 'reviewed').map((r) => [r.stdCode, r]));
  proposed.rows = proposed.rows.map((r) => reviewed.get(r.stdCode) ?? r);
}
writeFileSync(path, JSON.stringify(proposed, null, 2) + '\n');
console.log(`wrote ${proposed.rows.length} rows to ${path}`);
