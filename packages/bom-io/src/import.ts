import { readCsv, readWorkbook, str, type WorkbookGrid } from '@bom/sheets';
import type { DictionaryIndex } from '@bom/dictionary';
import { isLegacyMbf, parseLegacySheet, type LegacyOptions } from './legacy-mbf';
import { isStandardSheet, parseStandardSheet } from './standard';
import type { ImportResult } from './types';

const COST_RE = /\$|\brp\.?\s?\d|\busd\b|\bidr\b|price|harga|cost|margin|\/\s?m[23]\b/i;

export interface ImportOptions {
  dictionary?: DictionaryIndex | null;
  /** Only these sheets. */
  sheets?: string[];
  password?: string;
  legacy?: Omit<LegacyOptions, 'dictionary'>;
}

/** Import every product sheet of a workbook grid; auto-detects the standard format and the legacy breakdown form. */
export function importGrid(grid: WorkbookGrid, opts: ImportOptions = {}): ImportResult {
  const result: ImportResult = { products: [], skippedSheets: [], workbookNotes: [] };
  // Workbook-level notes (a sheet called NOTE / Notes / Catatan).
  for (const s of grid.sheets) {
    if (/^(note|notes|catatan)$/i.test(s.name.trim())) {
      for (const row of s.rows) for (const v of row) {
        const t = str(v);
        // Costing never enters the tool: drop price / cost lines.
        if (t && /[a-z]/i.test(t) && !COST_RE.test(t)) result.workbookNotes.push(t);
      }
    }
  }
  for (const sheet of grid.sheets) {
    if (opts.sheets && !opts.sheets.includes(sheet.name)) continue;
    let out;
    if (isLegacyMbf(sheet)) out = parseLegacySheet(sheet, { ...opts.legacy, dictionary: opts.dictionary, workbookNotes: result.workbookNotes });
    else if (isStandardSheet(sheet)) out = parseStandardSheet(sheet, { dictionary: opts.dictionary });
    else out = { skip: 'not a product BOM sheet' };
    if ('skip' in out) result.skippedSheets.push({ name: sheet.name, reason: out.skip });
    else result.products.push(out);
  }
  return result;
}

export async function importFile(data: Uint8Array | ArrayBuffer, fileName: string, opts: ImportOptions = {}): Promise<ImportResult> {
  if (/\.csv$/i.test(fileName)) {
    const text = new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data));
    return importGrid(readCsv(text, fileName.replace(/\.csv$/i, '')), opts);
  }
  return importGrid(await readWorkbook(data, { password: opts.password }), opts);
}
