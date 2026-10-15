/**
 * Adapter for the factory "MATERIAL BREAKDOWN FORM" costing sheets (e.g. Hollan House Rev. 5).
 * Reads only what the BOM needs: names, cut sizes, quantities, material codes, finish types,
 * notes, hardware and packing lines. Cost, price and margin columns are never read.
 */
import type { ProductHeader, Size3, Unit } from '@bom/domain';
import { emptyHeader } from '@bom/domain';
import { normHeader, num, str, type CellValue, type SheetGrid } from '@bom/sheets';
import type { DictionaryIndex } from '@bom/dictionary';
import { inferRole } from '@bom/dictionary';
import { buildContent, titleCase, type RawAssembly, type RawLine, type Section } from './build';
import { classifyProduct, initials, slug } from './classify';
import type { ImportedProduct } from './types';

/** Wood column (solid species). Inferred from the sheet legend — confirm with PPIC. */
export const LEGACY_WOOD_CODES: Record<string, string> = {
  m: 'MAHOGANY',
  x: 'MIXWOOD (OFF-CUT MAHOGANY)',
  p: 'PINE',
  r: 'RED OAK',
  j: 'JATI',
};

/** "M / P / Y / L" panel column. From the legend "MDF E2 / M1 E1 / Particle Board E2 / P1 E1 / Plywood / Lvl sengon". */
export const LEGACY_PANEL_CODES: Record<string, string> = {
  m: 'MDF E2',
  m1: 'MDF E1',
  p: 'PARTICLE BOARD E2',
  p1: 'PARTICLE BOARD E1',
  y: 'PLYWOOD',
  l: 'LVL SENGON',
};

/** A brand model code inside a description ("handle knop HOONE VNA10785S" → "HOONE VNA10785S"); null when the line has none. */
export function extractSku(name: string): string | null {
  const m = name.match(/\b([A-Z]{2,}\s+)?([A-Z]{1,5}-?\d{3,}[A-Z0-9-]*)\b/);
  return m ? `${m[1] ?? ''}${m[2]}`.trim() : null;
}

export function isLegacyMbf(sheet: SheetGrid): boolean {
  for (let r = 0; r < Math.min(30, sheet.rows.length); r++) {
    for (const c of sheet.rows[r] ?? []) {
      const h = normHeader(c);
      if (h === 'material breakdown form' || h === 'assembly component') return true;
    }
  }
  return false;
}

interface Found {
  row: number;
  col: number;
}

function findCell(rows: CellValue[][], pred: (h: string) => boolean, from = 0, to = rows.length, colFrom = 0, colTo = Infinity): Found | null {
  for (let r = from; r < Math.min(to, rows.length); r++) {
    const row = rows[r] ?? [];
    for (let c = colFrom; c < Math.min(row.length, colTo); c++) if (pred(normHeader(row[c]))) return { row: r, col: c };
  }
  return null;
}

/** Values to the right of a label cell, skipping ';' separators and unit labels. */
function valuesAfter(rows: CellValue[][], at: Found, max = 6, stopCol = Infinity): CellValue[] {
  const row = rows[at.row] ?? [];
  const out: CellValue[] = [];
  for (let c = at.col + 1; c < Math.min(row.length, stopCol); c++) {
    const v = row[c];
    if (v === null || v === '' || v === ';') continue;
    if (typeof v === 'string' && /^(mm|inch|cuft|kg|kgs)$/i.test(v.trim())) break;
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function threeNumbers(vals: CellValue[]): [number, number, number] | null {
  const n = vals.map(num).filter((v): v is number => v !== null);
  if (n.length < 3 || n.slice(0, 3).every((v) => v === 0)) return null;
  return [n[0], n[1], n[2]];
}

function toSize(t: [number, number, number], order: 'WDH' | 'WHD'): Size3 {
  return order === 'WDH' ? { W: t[0], D: t[1], H: t[2] } : { W: t[0], H: t[1], D: t[2] };
}

const isHeadRow = (name: string) => /^rakitan\b/i.test(name.trim()) || (name === name.toUpperCase() && /[A-Z]/.test(name) && name.trim().split(/\s+/).length >= 2);

export interface LegacyOptions {
  dictionary?: DictionaryIndex | null;
  woodCodes?: Record<string, string>;
  panelCodes?: Record<string, string>;
  /** Workbook-level notes (NOTE sheet) copied into each product. */
  workbookNotes?: string[];
}

export function parseLegacySheet(sheet: SheetGrid, opts: LegacyOptions = {}): ImportedProduct | { skip: string } {
  const rows = sheet.rows;
  const wood = opts.woodCodes ?? LEGACY_WOOD_CODES;
  const panel = opts.panelCodes ?? LEGACY_PANEL_CODES;
  const warnings: string[] = [];

  const tableHdr = findCell(rows, (h) => h === 'assembly component');
  if (!tableHdr) return { skip: 'no ASSEMBLY / COMPONENT table' };

  // ---- header block (above the table, left of the side tables) ----
  const headerTo = tableHdr.row;
  // The product header block is the left part of the sheet; the right side holds summary tables.
  const label = (re: RegExp) => findCell(rows, (h) => re.test(h), 0, headerTo, 0, 14);
  const textAfter = (re: RegExp, stopCol = 16) => {
    const at = label(re);
    if (!at) return null;
    const v = valuesAfter(rows, at, 1, stopCol)[0];
    return v === undefined ? null : str(v);
  };
  const description = textAfter(/^description$/);
  if (!description) return { skip: 'no product description (template or summary sheet)' };
  const cls = classifyProduct(`${description} ${sheet.name}`);

  const header: ProductHeader = emptyHeader();
  header.description = description;
  header.buyer = textAfter(/^buyer$/);
  header.series = textAfter(/^series$/);
  const sizeAt = label(/^product size$/);
  const size = sizeAt ? threeNumbers(valuesAfter(rows, sizeAt, 3, 16)) : null;
  header.productSize = size ? toSize(size, cls.headerOrder) : null;
  for (let b = 1; b <= 3; b++) {
    const at = label(new RegExp(`^packing size box ${b}$`));
    if (!at) continue;
    let t = threeNumbers(valuesAfter(rows, at, 3, 16));
    // Some sheets put the box size on the row below the label.
    if (!t) t = threeNumbers(valuesAfter(rows, { row: at.row + 1, col: at.col }, 3, 16));
    if (t) header.packingSizes.push({ W: t[0], D: t[1], H: t[2] });
  }
  const sideText = (re: RegExp) => {
    const at = findCell(rows, (h) => re.test(h), 0, headerTo, 14, 30);
    if (!at) return null;
    const v = valuesAfter(rows, at, 1, at.col + 12)[0];
    return v === undefined ? null : v;
  };
  header.spec = str(sideText(/^spec$/));
  header.setup = str(sideText(/^set up$/));
  header.carton = str(sideText(/^carton box$/));
  const date = sideText(/^date$/);
  header.date = date ? String(date) : null;
  header.sheetNote = str(sideText(/^note$/));
  const nwgw = findCell(rows, (h) => h === 'nw gw', 0, headerTo, 14, 30);
  if (nwgw) {
    const v = valuesAfter(rows, nwgw, 2, nwgw.col + 12).map(num);
    header.netWeightKg = v[0] ?? null;
    header.grossWeightKg = v[1] ?? null;
  }
  const load = findCell(rows, (h) => /^load 40 ?hq$/.test(h), 0, headerTo, 14, 30);
  if (load) header.loadQty40HC = num(valuesAfter(rows, load, 1, load.col + 8)[0] ?? null);
  if (header.packingSizes[0]) {
    const p = header.packingSizes[0];
    header.cbm = (p.W * p.D * p.H) / 1e9;
  }

  // ---- table columns ----
  const hdrRow = rows[tableHdr.row] ?? [];
  const subRow = rows[tableHdr.row + 1] ?? [];
  const colOf = (re: RegExp, row: CellValue[] = hdrRow, from = 0) => {
    for (let c = from; c < row.length; c++) if (re.test(normHeader(row[c]))) return c;
    return -1;
  };
  const nameCol = tableHdr.col;
  const sizeCol = colOf(/^size( mm)?$/);
  const tCol = colOf(/^t$/, subRow, sizeCol >= 0 ? sizeCol : 0);
  const lebarCol = colOf(/^l$/, subRow, tCol >= 0 ? tCol : 0);
  const panjangCol = colOf(/^p$/, subRow, lebarCol >= 0 ? lebarCol : 0);
  const qtyCol = colOf(/^qty$/);
  const woodCol = colOf(/^wood$/);
  const panelCol = colOf(/^m p y ?l$/);
  const finCol0 = colOf(/^finishing$/);
  const finCol = finCol0 >= 0 ? (colOf(/^type$/, subRow, finCol0) >= 0 ? colOf(/^type$/, subRow, finCol0) : finCol0) : -1;
  if ([tCol, lebarCol, panjangCol, qtyCol].some((c) => c < 0)) return { skip: 'could not find T / L / P / QTY columns' };
  // Notes ("AMBIL SISA POTONGAN …") sit in a free column right of the finishing block; cost columns hold numbers only.
  const notesFrom = finCol >= 0 ? finCol + 3 : panjangCol + 10;
  const notesTo = notesFrom + 10;

  // ---- sections ----
  const sectionStart = (re: RegExp, after: number) => findCell(rows, (h) => re.test(h), after, rows.length, nameCol)?.row ?? -1;
  const veneerRow = sectionStart(/^veneer$/, tableHdr.row + 2);
  const hardwareRow = sectionStart(/^hardware$/, Math.max(veneerRow, tableHdr.row + 2));
  const packingRow = sectionStart(/^packing$/, Math.max(hardwareRow, tableHdr.row + 2));
  const addedRow = sectionStart(/^added cost/, Math.max(packingRow, tableHdr.row + 2));
  const endRow = findCell(rows, (h) => h.startsWith('prepared by'), Math.max(addedRow, 0))?.row ?? rows.length;
  const mainEnd = [veneerRow, hardwareRow, packingRow, addedRow].filter((r) => r > 0).sort((a, b) => a - b)[0] ?? rows.length;

  const lines: RawLine[] = [];
  const assemblies: RawAssembly[] = [];
  let currentL1: string | null = null;

  for (let r = tableHdr.row + 2; r < mainEnd; r++) {
    const row = rows[r] ?? [];
    const name = str(row[nameCol]);
    if (!name) {
      currentL1 = null; // a blank line closes the assembly group
      continue;
    }
    const T = num(row[tCol]) ?? 0;
    const W = num(row[lebarCol]) ?? 0;
    const L = num(row[panjangCol]) ?? 0;
    const qty = num(row[qtyCol]) ?? 0;
    const woodCode = woodCol >= 0 ? str(row[woodCol])?.toLowerCase() ?? null : null;
    const panelCode = panelCol >= 0 ? str(row[panelCol])?.toLowerCase() ?? null : null;
    const finish = finCol >= 0 ? str(row[finCol]) : null;

    if (isHeadRow(name) && !woodCode && !panelCode) {
      const key = `${name.trim()}#${r}`;
      assemblies.push({ key, originalName: name, qty: qty || 1, dims: T || W || L ? { T, W, L } : null, finishCode: finish, row: r + 1 });
      currentL1 = key;
      continue;
    }
    let notes = '';
    for (let c = notesFrom; c < Math.min(notesTo, row.length); c++) {
      const v = row[c];
      if (typeof v === 'string' && /[a-z]{3,}/i.test(v) && !/^(true|false)$/i.test(v)) {
        notes = v.trim();
        break;
      }
    }
    const material = woodCode ? wood[woodCode] ?? woodCode.toUpperCase() : panelCode ? panel[panelCode] ?? panelCode.toUpperCase() : null;
    if (woodCode && !wood[woodCode]) warnings.push(`Row ${r + 1}: unknown wood code "${woodCode}"`);
    if (panelCode && !panel[panelCode]) warnings.push(`Row ${r + 1}: unknown panel code "${panelCode}"`);
    const l1Name = currentL1 ? assemblies.find((a) => a.key === currentL1)!.originalName : null;
    const isSkid = /skid/i.test(name);
    lines.push({
      originalName: name,
      l1: currentL1,
      dims: { T, W, L },
      qty,
      materialCode: woodCode ?? panelCode,
      material,
      kind: woodCode ? 'solid' : panelCode ? 'panel' : null,
      finishCode: finish,
      notes,
      section: isSkid ? 'packing' : 'main',
      row: r + 1,
      attrs: l1Name ? { l1Original: l1Name } : {},
    });
  }

  // Veneer lines: sizes T/L/P and side counts. Not geometry (they are faces of the panels above).
  if (veneerRow > 0) {
    const vSub = rows[veneerRow + 1] ?? [];
    const vt = colOf(/^t$/, vSub, nameCol);
    const vl = colOf(/^l$/, vSub, nameCol);
    const vp = colOf(/^p$/, vSub, nameCol);
    const sideCols: number[] = [];
    vSub.forEach((v, c) => {
      if (normHeader(v) === 'side') sideCols.push(c);
    });
    const stop = [hardwareRow, packingRow, addedRow].filter((x) => x > veneerRow).sort((a, b) => a - b)[0] ?? rows.length;
    for (let r = veneerRow + 2; r < stop; r++) {
      const row = rows[r] ?? [];
      const name = str(row[nameCol]);
      if (!name || vt < 0) continue;
      const sides = sideCols.reduce((acc, c) => acc + (num(row[c]) ?? 0), 0);
      const L = num(row[vp]) ?? 0;
      if (!L || !sides) continue;
      lines.push({ originalName: `veneer ${name}`, l1: null, dims: { T: num(row[vt]) ?? 0.6, W: num(row[vl]) ?? 0, L }, qty: sides, unit: 'pcs', material: 'VENEER', kind: 'veneer', section: 'veneer', row: r + 1 });
    }
  }

  // Hardware lines: the HARDWARE block and the ADDED COST (HW / JASA / OTHERS) block.
  const readHardware = (start: number, stop: number) => {
    if (start < 0) return;
    for (let r = start + 2; r < stop; r++) {
      const row = rows[r] ?? [];
      const name = str(row[nameCol]);
      if (!name) continue;
      const qty = num(row[qtyCol]) ?? 0;
      if (!qty) continue; // unused option lines on the template
      const nums = [num(row[tCol]), num(row[lebarCol]), num(row[panjangCol])].filter((v): v is number => v !== null && v > 0);
      const guess = inferRole(name, null);
      let dims = { T: 0, W: 0, L: 0 };
      if (guess.role === 'slide' && nums.length >= 2) dims = { T: 12.7, W: nums[0], L: nums[1] };
      else if (nums.length === 3) dims = { T: nums[0], W: nums[1], L: nums[2] };
      const unit: Unit | null = guess.unit;
      lines.push({ originalName: name, l1: null, dims, qty, unit, kind: 'hardware', section: 'hardware', hardwareSku: extractSku(name), row: r + 1 });
    }
  };
  readHardware(hardwareRow, [packingRow, addedRow].filter((x) => x > hardwareRow).sort((a, b) => a - b)[0] ?? endRow);
  readHardware(addedRow, endRow);

  // Packing: cartons and protection material.
  if (packingRow > 0) {
    const stop = [addedRow].filter((x) => x > packingRow)[0] ?? endRow;
    for (let r = packingRow + 2; r < stop; r++) {
      const row = rows[r] ?? [];
      const name = str(row[nameCol]);
      if (!name) continue;
      const qty = num(row[qtyCol]) ?? 0;
      if (!qty) continue;
      const nums = [num(row[tCol]), num(row[lebarCol]), num(row[panjangCol])];
      const isBox = /carton|box/i.test(name);
      const dims = isBox && nums.every((n) => n) ? { T: nums[2]!, W: nums[1]!, L: nums[0]! } : { T: 0, W: 0, L: 0 };
      const variant = str(row[nameCol + 1]);
      lines.push({ originalName: variant ? `${name} ${variant}` : name, l1: null, dims, qty, unit: isBox ? 'pcs' : 'pcs', kind: 'packing', section: 'packing' as Section, row: r + 1 });
    }
  }

  const buyerCode = initials(header.buyer) || 'XX';
  const seriesCode = initials(header.series);
  const code = [buyerCode, seriesCode, slug(sheet.name)].filter(Boolean).join('-');
  const revMatch = header.sheetNote?.match(/rev\.?\s*([0-9a-z]+)/i);
  const revisionLabel = revMatch ? `R${revMatch[1].toUpperCase()}` : 'A';
  if (opts.workbookNotes?.length) header.sheetNote = [header.sheetNote, ...opts.workbookNotes].filter(Boolean).join(' · ');
  if (!header.productSize) warnings.push('No PRODUCT SIZE in the header block');

  const built = buildContent(lines, assemblies, {
    sheet: sheet.name,
    family: cls.family,
    category: cls.category,
    subCategory: cls.subCategory,
    header,
    dictionary: opts.dictionary,
  });
  const bomCols = new Set([nameCol, tCol, lebarCol, panjangCol, qtyCol, woodCol, panelCol]);
  for (const e of sheet.errors) if (bomCols.has(e.col) && e.row > tableHdr.row) warnings.push(`Row ${e.row + 1}: formula error ${e.error} in a BOM column`);

  return {
    sheet: sheet.name,
    format: 'legacy-mbf',
    product: { code, name: titleCase(description.toLowerCase()), category: cls.category, subCategory: cls.subCategory, family: cls.family },
    revisionLabel,
    content: built.content,
    preview: built.preview,
    warnings: [...warnings.filter((w, i, a) => a.indexOf(w) === i).slice(0, 50), ...built.warnings],
  };
}
