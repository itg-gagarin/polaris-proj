/**
 * Rewrite fixtures/expected/*.json from the current engine.
 * CLAUDE.md: update golden files only with a written reason —
 *   pnpm golden:update "why the expected results changed"
 */
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { analyze } from '@bom/engine';
import { loadHollan, loadSets, goldenOf, fixturePath } from '@bom/fixtures';

const reason = process.argv.slice(2).join(' ').trim();
if (!reason) {
  console.error('Give a reason: pnpm golden:update "why the expected results changed"');
  process.exit(1);
}
mkdirSync(fixturePath('expected'), { recursive: true });
const all = [...(await loadHollan()), ...(await loadSets())];
for (const p of all) {
  const a = analyze(p.content, undefined, { requireConfirmed: true });
  writeFileSync(fixturePath('expected', `${p.code}.json`), JSON.stringify(goldenOf(a), null, 2) + '\n');
}
appendFileSync(fixturePath('expected', 'CHANGELOG.md'), `- ${new Date().toISOString().slice(0, 10)}: ${reason}\n`);
console.log(`updated ${all.length} golden files`);
