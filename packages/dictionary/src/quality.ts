import type { StdPart } from '@bom/domain';
import { levenshtein } from './normalize';
import { ROLE_INFO } from './roles';

/** Axis maps apply to level-2 components and to level-1 rows that are themselves a geometric part; not to assemblies or hardware packs. */
export function needsAxisMap(e: StdPart): boolean {
  if (e.defaultRole) return ROLE_INFO[e.defaultRole]?.geometric === true;
  return e.level === 2;
}

export type DataIssueCode =
  | 'please-specify'
  | 'misspelling'
  | 'similar-subcategory'
  | 'missing-axis-map'
  | 'missing-default-role'
  | 'duplicate-code'
  | 'orphan-l2'
  | 'l1-name-mismatch'
  | 'empty-name'
  | 'code-prefix-mismatch'
  | 'rare-name';

export interface DataIssue {
  code: DataIssueCode;
  severity: 'error' | 'warn' | 'info';
  message: string;
  stdCodes: string[];
  count: number;
}

/** Known misspellings in the reference workbook → correction (PRD §4). */
export const KNOWN_TYPOS: Record<string, string> = {
  Extention: 'Extension',
  Entertaiment: 'Entertainment',
};

export interface QualityReport {
  totals: { entries: number; l1: number; l2: number; distinctL1: number; distinctL2: number; categories: number; subCategories: number };
  byCategory: Record<string, number>;
  issues: DataIssue[];
}

export function qualityReport(entries: StdPart[], opts: { topN?: number } = {}): QualityReport {
  const issues: DataIssue[] = [];
  const add = (code: DataIssueCode, severity: DataIssue['severity'], message: string, codes: string[]) => {
    if (codes.length) issues.push({ code, severity, message, stdCodes: codes, count: codes.length });
  };

  const l1 = entries.filter((e) => e.level === 1);
  const l2 = entries.filter((e) => e.level === 2);
  const byCategory: Record<string, number> = {};
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
  const subCats = [...new Set(entries.map((e) => `${e.category} / ${e.subCategory}`))];

  add('please-specify', 'warn', 'Entries under sub-category "Please specify" need a real sub-category', entries.filter((e) => /please specify/i.test(e.subCategory)).map((e) => e.stdCode));

  for (const [wrong, right] of Object.entries(KNOWN_TYPOS)) {
    const hits = entries.filter((e) => [e.category, e.subCategory, e.name, e.l1, e.l2 ?? ''].some((f) => f.includes(wrong))).map((e) => e.stdCode);
    add('misspelling', 'warn', `Misspelling "${wrong}" → "${right}"`, hits);
  }

  const subNames = [...new Set(entries.map((e) => e.subCategory))];
  for (let i = 0; i < subNames.length; i++)
    for (let j = i + 1; j < subNames.length; j++) {
      const a = subNames[i].toLowerCase();
      const b = subNames[j].toLowerCase();
      if (a.length > 5 && levenshtein(a, b) <= 2)
        add('similar-subcategory', 'info', `Sub-categories "${subNames[i]}" and "${subNames[j]}" look like the same name`, entries.filter((e) => e.subCategory === subNames[i] || e.subCategory === subNames[j]).map((e) => e.stdCode));
    }

  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.stdCode, (seen.get(e.stdCode) ?? 0) + 1);
  add('duplicate-code', 'error', 'Std Code appears more than once', [...seen].filter(([, n]) => n > 1).map(([c]) => c));

  const byCode = new Map(entries.map((e) => [e.stdCode, e]));
  add('orphan-l2', 'error', 'Level-2 entry whose parent L1 code is missing', l2.filter((e) => !e.parentCode || !byCode.has(e.parentCode)).map((e) => e.stdCode));
  add('l1-name-mismatch', 'warn', 'Level-2 entry whose L1 (Head) differs from its parent', l2.filter((e) => e.parentCode && byCode.has(e.parentCode) && byCode.get(e.parentCode)!.l1 !== e.l1).map((e) => e.stdCode));
  add('empty-name', 'error', 'Entry without a Standard SG Name', entries.filter((e) => !e.name.trim()).map((e) => e.stdCode));

  const prefixBySub = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const key = `${e.category}/${e.subCategory}`;
    const p = e.stdCode.split('-')[0];
    const m = prefixBySub.get(key) ?? new Map();
    m.set(p, (m.get(p) ?? 0) + 1);
    prefixBySub.set(key, m);
  }
  const prefixOdd: string[] = [];
  for (const e of entries) {
    const m = prefixBySub.get(`${e.category}/${e.subCategory}`)!;
    const main = [...m].sort((a, b) => b[1] - a[1])[0][0];
    if (e.stdCode.split('-')[0] !== main) prefixOdd.push(e.stdCode);
  }
  add('code-prefix-mismatch', 'info', 'Std Code prefix differs from the rest of its sub-category', prefixOdd);

  add('missing-axis-map', 'warn', 'No Axis Map: placement falls back to name rules (column added in phase 0)', entries.filter((e) => needsAxisMap(e) && !e.axisMap).map((e) => e.stdCode));
  add('missing-default-role', 'info', 'No Default Role', entries.filter((e) => !e.defaultRole).map((e) => e.stdCode));

  const top = topUsed(entries, opts.topN ?? 50);
  add('missing-axis-map', 'error', `Top-${opts.topN ?? 50} most-used geometric Std Code without an Axis Map (phase 0 gate)`, top.filter((e) => needsAxisMap(e) && !e.axisMap).map((e) => e.stdCode));
  add('missing-default-role', 'error', `Top-${opts.topN ?? 50} most-used Std Code without a Default Role (phase 0 gate)`, top.filter((e) => !e.defaultRole).map((e) => e.stdCode));

  add('rare-name', 'info', 'Used by a single finished good — review before relying on it', entries.filter((e) => e.fgsUsing <= 1).map((e) => e.stdCode));

  return {
    totals: {
      entries: entries.length,
      l1: l1.length,
      l2: l2.length,
      distinctL1: new Set(l1.map((e) => e.name)).size,
      distinctL2: new Set(l2.map((e) => e.name)).size,
      categories: Object.keys(byCategory).length,
      subCategories: subCats.length,
    },
    byCategory,
    issues,
  };
}

/** Most-used entries by # SG Lines, then # FGs Using. */
export function topUsed(entries: StdPart[], n: number): StdPart[] {
  return [...entries].sort((a, b) => b.sgLines - a.sgLines || b.fgsUsing - a.fgsUsing || a.stdCode.localeCompare(b.stdCode)).slice(0, n);
}

export function applyTypoFixes(entries: StdPart[]): StdPart[] {
  const fix = (s: string) => Object.entries(KNOWN_TYPOS).reduce((acc, [w, r]) => acc.replaceAll(w, r), s);
  return entries.map((e) => ({ ...e, category: fix(e.category), subCategory: fix(e.subCategory), name: fix(e.name), l1: fix(e.l1), l2: e.l2 ? fix(e.l2) : null }));
}
