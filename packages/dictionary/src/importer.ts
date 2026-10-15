import type { StdPart, Team, PartRole } from '@bom/domain';
import { TEAM_IDS } from '@bom/domain';
import { findHeader, num, str, type CellValue, type WorkbookGrid } from '@bom/sheets';
import { parseAxisMap } from './axis';

/**
 * Column aliases. The importer finds the header row by name, so column order,
 * extra columns and future columns (Axis Map, Default Role, Owner Team, English alias) are tolerated.
 */
export const DICTIONARY_COLUMNS = {
  category: ['Category', 'Kategori'],
  subCategory: ['Sub-category', 'Subcategory', 'Sub category', 'Sub Kategori', 'Subkategori'],
  stdCode: ['Std Code', 'Standard Code', 'Std. Code', 'Kode Std', 'Kode Standar', 'Code'],
  level: ['Level', 'Lvl'],
  l1: ['L1 (Head)', 'L1', 'Head', 'L1 Head'],
  l2: ['L2', 'L2 (Component)', 'Component'],
  name: ['Standard SG Name', 'Standard Name', 'Std Name', 'Nama Standar', 'SG Name'],
  fgsUsing: ['# FGs Using', 'FGs Using', '# FG Using'],
  sgLines: ['# SG Lines', 'SG Lines'],
  positions: ['Positions Seen', 'Positions', 'Posisi'],
  variants: ['Variants Seen', 'Variants', 'Varian'],
  source: ['Source', 'Sumber'],
  mergedNames: ['Original Names Merged (examples)', 'Original Names Merged', 'Merged Names', 'Nama Asal'],
  mergedCount: ['# Original Names Merged'],
  axisMap: ['Axis Map', 'Axis', 'AxisMap'],
  defaultRole: ['Default Role', 'Role'],
  ownerTeam: ['Owner Team', 'Team Owner', 'Team'],
  nameEn: ['English Alias', 'English Name', 'Name (EN)', 'Alias EN'],
} as const;

export type DictionaryColumn = keyof typeof DICTIONARY_COLUMNS;

export interface ImportedDictionary {
  entries: StdPart[];
  meta: {
    sheets: { name: string; headerRow: number; rows: number; columns: Partial<Record<DictionaryColumn, number>> }[];
    skippedRows: { sheet: string; row: number; reason: string }[];
  };
}

export interface DictionaryImportOptions {
  /** Only read these sheets (default: every sheet with a recognisable header). */
  sheets?: string[];
  /** When a sheet has no Category column, use the sheet name as the category (one sheet per category layout). */
  categoryFromSheetName?: boolean;
}

function splitList(v: CellValue, sep: RegExp): string[] {
  const s = str(v);
  if (!s) return [];
  return s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function inferLevel(code: string): 1 | 2 | null {
  const parts = code.split('-');
  if (parts.length === 2) return 1;
  if (parts.length === 3) return 2;
  return null;
}

export function parentCodeOf(code: string): string | null {
  const parts = code.split('-');
  return parts.length >= 3 ? parts.slice(0, -1).join('-') : null;
}

function parseTeam(v: CellValue): Team | null {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  const hit = TEAM_IDS.find((t) => t === s || s.startsWith(t));
  if (hit) return hit;
  if (s.includes('paint') || s.includes('colour') || s.includes('color') || s.includes('finish')) return 'finishing';
  if (s.includes('assembl') || s.includes('rakit')) return 'assembly';
  if (s.includes('pack')) return 'packing';
  if (s.includes('hard')) return 'hardware';
  if (s.includes('engin')) return 'engineering';
  if (s.includes('design') || s.includes('desain') || s.includes('r&d')) return 'design';
  return null;
}

/** Parse the standard part-name dictionary from any workbook layout that has the expected headers. */
export function importDictionary(grid: WorkbookGrid, opts: DictionaryImportOptions = {}): ImportedDictionary {
  const entries: StdPart[] = [];
  const meta: ImportedDictionary['meta'] = { sheets: [], skippedRows: [] };

  for (const sheet of grid.sheets) {
    if (opts.sheets && !opts.sheets.includes(sheet.name)) continue;
    const header = findHeader(sheet.rows, DICTIONARY_COLUMNS as unknown as Record<DictionaryColumn, string[]>, { minHits: 3 });
    if (!header || header.cols.stdCode === undefined) continue;
    const c = header.cols;
    const useSheetCategory = c.category === undefined && (opts.categoryFromSheetName ?? true);
    let count = 0;

    for (let r = header.row + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const get = (k: DictionaryColumn) => (c[k] === undefined ? null : row[c[k]!] ?? null);
      const stdCode = str(get('stdCode'));
      if (!stdCode) {
        if (row.some((v) => v !== null && v !== '')) meta.skippedRows.push({ sheet: sheet.name, row: r + 1, reason: 'no Std Code' });
        continue;
      }
      const levelRaw = num(get('level'));
      const level = (levelRaw === 1 || levelRaw === 2 ? levelRaw : inferLevel(stdCode)) ?? 1;
      const l1 = str(get('l1')) ?? '';
      const l2 = str(get('l2'));
      const name = str(get('name')) ?? (level === 2 ? l2 : l1) ?? '';
      entries.push({
        stdCode,
        level: level as 1 | 2,
        l1,
        l2: level === 2 ? l2 ?? name : null,
        name,
        nameEn: str(get('nameEn')),
        category: str(get('category')) ?? (useSheetCategory ? sheet.name : ''),
        subCategory: str(get('subCategory')) ?? '',
        positions: splitList(get('positions'), /\s*\/\s*|\s*;\s*/),
        variants: splitList(get('variants'), /\s*;\s*/),
        mergedNames: splitList(get('mergedNames'), /\s*;\s*/),
        fgsUsing: num(get('fgsUsing')) ?? 0,
        sgLines: num(get('sgLines')) ?? 0,
        source: str(get('source')) ?? '',
        axisMap: parseAxisMap(get('axisMap')),
        defaultRole: (str(get('defaultRole')) as PartRole | null) ?? null,
        ownerTeam: parseTeam(get('ownerTeam')),
        parentCode: level === 2 ? parentCodeOf(stdCode) : null,
      });
      count++;
    }
    meta.sheets.push({ name: sheet.name, headerRow: header.row + 1, rows: count, columns: c });
  }
  return { entries, meta };
}
