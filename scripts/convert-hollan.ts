/**
 * Build the committed Hollan House fixture from the original (password-protected) workbook.
 *
 *   HOLLAN_XLSX=fixtures/private/hollan-house-rev5.encrypted.xlsx HOLLAN_PASSWORD=… pnpm fixtures:hollan
 *
 * The original never enters git (fixtures/private is ignored). The fixture keeps only BOM data:
 * names, cut sizes, quantities, materials, finish types, hardware and packing lines. No cost,
 * price or margin column is read. Fuzzy matches are confirmed by "fixture-review" so the fixture
 * represents the state after the import-preview confirmation step (PRD §4).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readWorkbook } from '@bom/sheets';
import { applyPatch } from '@bom/domain';
import { importDictionary, applyOverlay, DictionaryIndex, type Overlay } from '@bom/dictionary';
import { importFile, confirmAllPatch, exportProductsWorkbook, type ExportInput } from '@bom/bom-io';
import { prepareContentWithReport } from '@bom/engine';
import { at } from './paths';

const src = process.env.HOLLAN_XLSX ?? at('fixtures/private/hollan-house-rev5.encrypted.xlsx');
const password = process.env.HOLLAN_PASSWORD;
const dict = importDictionary(await readWorkbook(readFileSync(at('fixtures/dictionary/ref.xlsx'))));
const overlay = JSON.parse(readFileSync(at('fixtures/dictionary/axis-role-overlay.json'), 'utf8')) as Overlay;
const index = new DictionaryIndex(applyOverlay(dict.entries, overlay));
const result = await importFile(readFileSync(src), 'hollan.xlsx', { dictionary: index, password });

const inputs: ExportInput[] = [];
const report: string[] = [`# Hollan House fixture — conversion report`, '', `Source: ${src.split('/').pop()} (not committed)`, `Products: ${result.products.length}; skipped sheets: ${result.skippedSheets.map((s) => `${s.name} (${s.reason})`).join(', ')}`, ''];
for (const p of result.products) {
  const confirmed = applyPatch(p.content, confirmAllPatch(p.content, 'fixture-review', 0)).content;
  const { content, oriented } = prepareContentWithReport(confirmed);
  const counts = p.preview.reduce<Record<string, number>>((m, r) => ((m[r.match.status] = (m[r.match.status] ?? 0) + 1), m), {});
  report.push(`## ${p.product.code} — ${p.product.name} (rev ${p.revisionLabel})`, `- ${p.content.parts.length} lines; matches ${JSON.stringify(counts)}`, ...oriented.map((o) => `- auto-oriented: ${o.reason}`), ...p.warnings.slice(0, 10).map((w) => `- warning: ${w}`), '');
  inputs.push({ productCode: p.product.code, productName: p.product.name, category: p.product.category, subCategory: p.product.subCategory, revisionLabel: p.revisionLabel, content });
}
mkdirSync(at('fixtures/products'), { recursive: true });
writeFileSync(at('fixtures/products/hollan-house-curated-craftsman.xlsx'), await exportProductsWorkbook(inputs));
writeFileSync(at('fixtures/products/hollan-house-conversion-report.md'), report.join('\n'));
console.log(`wrote ${inputs.length} products`);
