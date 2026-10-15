/**
 * Thin, environment-neutral spreadsheet layer (Node + browser) over exceljs.
 * Everything above this package sees plain grids of primitive cell values.
 */
import ExcelJS from 'exceljs';

export type CellValue = string | number | boolean | null;

export interface SheetGrid {
  name: string;
  /** rows[r][c], 0-based. Merged-cell slaves are null so values are not duplicated. */
  rows: CellValue[][];
  /** Formula cells that evaluated to an error (#N/A, #DIV/0!) — kept for data-quality reports. */
  errors: { row: number; col: number; error: string }[];
}

export interface WorkbookGrid {
  sheets: SheetGrid[];
}

export class EncryptedWorkbookError extends Error {
  constructor() {
    super('Workbook is password protected');
  }
}

function toPrimitive(v: ExcelJS.CellValue): { value: CellValue; error?: string } {
  if (v === null || v === undefined) return { value: null };
  if (typeof v === 'string') return { value: v };
  if (typeof v === 'number' || typeof v === 'boolean') return { value: v };
  if (v instanceof Date) return { value: v.toISOString().slice(0, 10) };
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('error' in o) return { value: null, error: String(o.error) };
    if ('result' in o) {
      const r = o.result as ExcelJS.CellValue;
      if (r && typeof r === 'object' && 'error' in (r as object)) return { value: null, error: String((r as { error: unknown }).error) };
      return toPrimitive(r);
    }
    if ('richText' in o && Array.isArray(o.richText)) return { value: (o.richText as { text: string }[]).map((t) => t.text).join('') };
    if ('text' in o) return { value: String(o.text) };
    if ('formula' in o || 'sharedFormula' in o) return { value: null };
  }
  return { value: String(v) };
}

/** OLE compound file magic: D0 CF 11 E0 — encrypted OOXML packages use it. */
export function isEncryptedOoxml(data: Uint8Array): boolean {
  return data.length > 8 && data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;
}

/** Decrypt a password-protected .xlsx (agile / standard encryption). The password is never stored. */
export async function decryptWorkbook(data: Uint8Array, password: string): Promise<Uint8Array> {
  const mod = (await import('officecrypto-tool')) as unknown as {
    default?: { decrypt: (b: Buffer, o: { password: string }) => Promise<Buffer> };
    decrypt?: (b: Buffer, o: { password: string }) => Promise<Buffer>;
  };
  const decrypt = mod.decrypt ?? mod.default?.decrypt;
  if (!decrypt) throw new Error('officecrypto-tool not available');
  const out = await decrypt(Buffer.from(data), { password });
  return new Uint8Array(out);
}

export async function readWorkbook(data: Uint8Array | ArrayBuffer, opts: { password?: string } = {}): Promise<WorkbookGrid> {
  let bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (isEncryptedOoxml(bytes)) {
    if (!opts.password) throw new EncryptedWorkbookError();
    bytes = await decryptWorkbook(bytes, opts.password);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheets: SheetGrid[] = [];
  wb.eachSheet((ws) => {
    const rows: CellValue[][] = [];
    const errors: SheetGrid['errors'] = [];
    const maxCol = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const out: CellValue[] = new Array(maxCol).fill(null);
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
        const { value, error } = toPrimitive(cell.value);
        out[colNumber - 1] = value;
        if (error) errors.push({ row: rowNumber - 1, col: colNumber - 1, error });
      });
      rows[rowNumber - 1] = out;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = new Array(maxCol).fill(null);
    sheets.push({ name: ws.name, rows, errors });
  });
  return { sheets };
}

/** Parse CSV (RFC 4180, comma or semicolon) into a single-sheet grid. */
export function readCsv(text: string, name = 'CSV'): WorkbookGrid {
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: CellValue[][] = [];
  let row: CellValue[] = [];
  let field = '';
  let quoted = false;
  const push = () => {
    const t = field.trim();
    row.push(t === '' ? null : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t);
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      push();
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { push(); rows.push(row); }
  return { sheets: [{ name, rows, errors: [] }] };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export interface ColumnSpec {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
}

export interface SheetSpec {
  name: string;
  /** Rows printed above the table (title block). */
  preamble?: CellValue[][];
  columns: ColumnSpec[];
  rows: Record<string, CellValue>[];
  freezeHeader?: boolean;
}

export async function writeWorkbook(sheets: SheetSpec[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Furniture BOM Studio';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
    const pre = s.preamble ?? [];
    for (const r of pre) ws.addRow(r);
    if (pre.length) ws.addRow([]);
    const headerRow = ws.addRow(s.columns.map((c) => c.header));
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.max(10, c.header.length + 2);
      if (c.numFmt) col.numFmt = c.numFmt;
    });
    for (const r of s.rows) ws.addRow(s.columns.map((c) => r[c.key] ?? null));
    if (s.freezeHeader !== false) ws.views = [{ state: 'frozen', ySplit: headerRow.number }];
    ws.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: headerRow.number, column: s.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/* ------------------------------------------------------------------ */
/* Header helpers                                                      */
/* ------------------------------------------------------------------ */

export function normHeader(v: CellValue): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9# ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find a header row: the first row (within maxScan) where at least `minHits`
 * cells match one of the alias lists. Returns column index per field.
 */
export function findHeader<K extends string>(
  rows: CellValue[][],
  aliases: Record<K, string[]>,
  opts: { minHits?: number; maxScan?: number } = {},
): { row: number; cols: Partial<Record<K, number>> } | null {
  const minHits = opts.minHits ?? 3;
  const maxScan = Math.min(rows.length, opts.maxScan ?? 40);
  const norm: Record<string, string[]> = {};
  for (const k of Object.keys(aliases) as K[]) norm[k] = aliases[k].map((a) => normHeader(a));
  for (let r = 0; r < maxScan; r++) {
    const cols: Partial<Record<K, number>> = {};
    let hits = 0;
    rows[r]?.forEach((cell, c) => {
      const h = normHeader(cell);
      if (!h) return;
      for (const k of Object.keys(norm) as K[]) {
        if (cols[k] !== undefined) continue;
        if (norm[k].includes(h)) {
          cols[k] = c;
          hits++;
          break;
        }
      }
    });
    if (hits >= minHits) return { row: r, cols };
  }
  return null;
}

export function str(v: CellValue): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

export function num(v: CellValue): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
