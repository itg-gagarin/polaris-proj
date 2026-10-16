/**
 * Fixture loader shared by tests, database seeds and the demo workspace (Node only).
 * fixtures/dictionary/ref.xlsx      — the standard part-name dictionary ("testinggggg.xlsx")
 * fixtures/products/*.xlsx          — product BOMs in the PRD §4 import format
 * fixtures/products/sets.json       — bed sets composed from components
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RevisionContent, StdPart } from '@bom/domain';
import { readWorkbook } from '@bom/sheets';
import { importDictionary, applyOverlay, DictionaryIndex, type Overlay } from '@bom/dictionary';
import { importFile, type ImportedProduct } from '@bom/bom-io';
import { prepareContent, composeSet } from '@bom/engine';

/**
 * Where the fixture files are. Bundled and serverless builds move code away from the repo layout
 * (Next.js server chunks, Vercel functions under /var/task), so try the known locations in order.
 */
function findFixturesDir(): string {
  const candidates = [process.env.BOM_FIXTURES_DIR, resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures'), resolve(process.cwd(), 'fixtures'), resolve(process.cwd(), '../../fixtures')].filter((c): c is string => !!c);
  return candidates.find((c) => existsSync(resolve(c, 'dictionary/ref.xlsx'))) ?? candidates[0];
}

export const FIXTURES_DIR = findFixturesDir();
export const fixturePath = (...p: string[]) => resolve(FIXTURES_DIR, ...p);

let dictCache: Promise<{ entries: StdPart[]; index: DictionaryIndex }> | null = null;

export function loadDictionary(): Promise<{ entries: StdPart[]; index: DictionaryIndex }> {
  dictCache ??= (async () => {
    const grid = await readWorkbook(readFileSync(fixturePath('dictionary/ref.xlsx')));
    const overlayPath = fixturePath('dictionary/axis-role-overlay.json');
    const overlay = existsSync(overlayPath) ? (JSON.parse(readFileSync(overlayPath, 'utf8')) as Overlay) : null;
    const entries = applyOverlay(importDictionary(grid).entries, overlay);
    return { entries, index: new DictionaryIndex(entries) };
  })();
  return dictCache;
}

export interface FixtureProduct {
  code: string;
  name: string;
  category: string;
  subCategory: string;
  revisionLabel: string;
  imported: ImportedProduct;
  /** Prepared (parameters, assumptions, template joints) and ready to analyze. */
  content: RevisionContent;
}

let hollanCache: Promise<FixtureProduct[]> | null = null;

/** The Hollan House Curated Craftsman bedroom (11 products), as committed in the standard format. */
export function loadHollan(): Promise<FixtureProduct[]> {
  hollanCache ??= (async () => {
    const { index } = await loadDictionary();
    const res = await importFile(readFileSync(fixturePath('products/hollan-house-curated-craftsman.xlsx')), 'hollan.xlsx', { dictionary: index });
    return res.products.map((p) => ({
      code: p.product.code,
      name: p.product.name,
      category: p.product.category,
      subCategory: p.product.subCategory,
      revisionLabel: p.revisionLabel,
      imported: p,
      content: prepareContent(p.content),
    }));
  })();
  return hollanCache;
}

export interface FixtureSet {
  code: string;
  name: string;
  components: Record<string, string>;
  content: RevisionContent;
}

export async function loadSets(): Promise<FixtureSet[]> {
  const products = await loadHollan();
  const byCode = new Map(products.map((p) => [p.code, p]));
  const def = JSON.parse(readFileSync(fixturePath('products/sets.json'), 'utf8')) as { sets: { code: string; name: string; components: Record<string, string> }[] };
  return def.sets.map((s) => {
    const comps = Object.entries(s.components).map(([key, code]) => {
      const p = byCode.get(code);
      if (!p) throw new Error(`Set ${s.code}: unknown component ${code}`);
      return { key, content: p.content };
    });
    return { ...s, content: prepareContent(composeSet(s.name, comps)) };
  });
}

/** The original customer workbook, when present locally (never committed). */
export function privateHollanPath(): string | null {
  const p = fixturePath('private/hollan-house-rev5.encrypted.xlsx');
  return existsSync(p) ? p : null;
}

/** Stable, reviewable summary of an analysis for fixtures/expected/*.json. */
export function goldenOf(a: { findings: import('@bom/domain').Finding[]; summary: Record<string, number>; layout: { notes: string[]; unplaced: unknown[] } }) {
  return {
    summary: a.summary,
    layoutNotes: a.layout.notes,
    findings: a.findings
      .map((f) => ({ rule: f.ruleId, severity: f.severity, confidence: f.confidence, team: f.ownerTeam, numbers: f.numbers, hasFix: !!f.fix, message: f.message }))
      .sort((x, y) => (x.rule + x.message).localeCompare(y.rule + y.message)),
  };
}
