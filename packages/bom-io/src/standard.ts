/**
 * PRD §4 product BOM import format: one sheet per product revision. Product fields come from a
 * header block (label | value) above the table, or from columns on every row.
 */
import type { ProductHeader, Team, Transform, Unit, PartKind } from '@bom/domain';
import { emptyHeader, TEAM_IDS } from '@bom/domain';
import { findHeader, normHeader, num, str, type SheetGrid } from '@bom/sheets';
import { parseAxisMap, type DictionaryIndex } from '@bom/dictionary';
import { buildContent, type RawAssembly, type RawLine, type Section } from './build';
import { classifyProduct } from './classify';
import type { ImportedProduct } from './types';

export const STANDARD_COLUMNS = {
  productCode: ['Product Code', 'Kode Produk'],
  productName: ['Product Name', 'Nama Produk'],
  category: ['Category', 'Kategori'],
  subCategory: ['Sub-category', 'Subcategory', 'Sub category'],
  revision: ['Revision', 'Rev', 'Revisi'],
  stdCode: ['Std Code', 'Standard Code', 'Kode Std'],
  l1: ['L1', 'L1 (Head)', 'Assembly', 'Rakitan'],
  l2: ['L2', 'Component'],
  partName: ['Part Name', 'Nama Part', 'Name', 'Original Name'],
  position: ['Position', 'Posisi'],
  T: ['T', 'T (mm)', 'Thickness', 'Tebal'],
  W: ['W', 'W (mm)', 'Width', 'Lebar'],
  L: ['L', 'L (mm)', 'Length', 'Panjang'],
  qty: ['Qty', 'Quantity', 'Jumlah'],
  unit: ['Unit', 'Satuan'],
  material: ['Material / Species', 'Material', 'Species', 'Material/Species'],
  finish: ['Finish Code', 'Finish', 'Finishing'],
  sku: ['Hardware SKU', 'SKU'],
  team: ['Team Owner', 'Team'],
  x: ['X'],
  y: ['Y'],
  z: ['Z'],
  rx: ['RotX', 'Rot X'],
  ry: ['RotY', 'Rot Y'],
  rz: ['RotZ', 'Rot Z'],
  notes: ['Notes', 'Keterangan', 'Catatan'],
  axisMap: ['Axis Map'],
  kind: ['Kind', 'Type'],
  role: ['Role'],
} as const;
type Col = keyof typeof STANDARD_COLUMNS;

export function isStandardSheet(sheet: SheetGrid): boolean {
  const h = findHeader(sheet.rows, STANDARD_COLUMNS as unknown as Record<Col, string[]>, { minHits: 4 });
  return !!h && h.cols.T !== undefined && h.cols.W !== undefined && h.cols.L !== undefined && h.cols.qty !== undefined;
}

const UNITS: Unit[] = ['pcs', 'pair', 'set', 'm', 'm2', 'kg', 'roll'];
const KINDS: PartKind[] = ['solid', 'panel', 'veneer', 'hardware', 'packing', 'other'];

export interface StandardOptions {
  dictionary?: DictionaryIndex | null;
}

export function parseStandardSheet(sheet: SheetGrid, opts: StandardOptions = {}): ImportedProduct | { skip: string } {
  const hdr = findHeader(sheet.rows, STANDARD_COLUMNS as unknown as Record<Col, string[]>, { minHits: 4 });
  if (!hdr) return { skip: 'no BOM header row' };
  const c = hdr.cols;
  const warnings: string[] = [];

  // Header block: "Label | value" pairs above the table.
  const block: Record<string, string | number> = {};
  for (let r = 0; r < hdr.row; r++) {
    const row = sheet.rows[r] ?? [];
    for (let i = 0; i < row.length - 1; i++) {
      const label = normHeader(row[i]);
      if (!label) continue;
      const value = row.slice(i + 1).find((v) => v !== null && v !== '');
      if (value !== undefined && value !== null) block[label] = value as string | number;
    }
  }
  const fromBlock = (k: Col) => {
    for (const a of STANDARD_COLUMNS[k]) {
      const v = block[normHeader(a)];
      if (v !== undefined) return String(v).trim();
    }
    return null;
  };
  const firstRowValue = (k: Col) => {
    if (c[k] === undefined) return null;
    for (let r = hdr.row + 1; r < sheet.rows.length; r++) {
      const v = str(sheet.rows[r]?.[c[k]!] ?? null);
      if (v) return v;
    }
    return null;
  };
  const productName = fromBlock('productName') ?? firstRowValue('productName') ?? sheet.name;
  const cls = classifyProduct(productName);
  const category = fromBlock('category') ?? firstRowValue('category') ?? cls.category;
  const subCategory = fromBlock('subCategory') ?? firstRowValue('subCategory') ?? cls.subCategory;
  const code = fromBlock('productCode') ?? firstRowValue('productCode') ?? sheet.name.toUpperCase().replace(/\s+/g, '-');
  const revision = fromBlock('revision') ?? firstRowValue('revision') ?? 'A';

  const header: ProductHeader = emptyHeader();
  header.description = productName;
  const sizeRaw = block['product size'] ?? block['overall size'];
  if (typeof sizeRaw === 'string') {
    const n = sizeRaw.split(/[x×*]/i).map((s) => Number(s.trim()));
    if (n.length === 3 && n.every(Number.isFinite)) header.productSize = { W: n[0], D: n[1], H: n[2] };
  }
  const triple = (v: unknown) => {
    const n = String(v).split(/[x×*]/i).map((x) => Number(x.trim()));
    return n.length === 3 && n.every(Number.isFinite) ? { W: n[0], D: n[1], H: n[2] } : null;
  };
  if (block['packing size']) header.packingSizes = String(block['packing size']).split(';').map(triple).filter((x): x is NonNullable<typeof x> => !!x);
  if (header.packingSizes[0]) header.cbm = (header.packingSizes[0].W * header.packingSizes[0].D * header.packingSizes[0].H) / 1e9;
  const text = (k: string) => (block[k] !== undefined ? String(block[k]) : null);
  const number = (k: string) => (block[k] !== undefined && Number.isFinite(Number(block[k])) ? Number(block[k]) : null);
  header.spec = text('spec');
  header.setup = text('set up');
  header.carton = text('carton box');
  header.sheetNote = text('sheet note');
  header.netWeightKg = number('nw');
  header.grossWeightKg = number('gw');
  header.loadQty40HC = number('load 40hc');
  const markets = block['markets'] ?? block['market'];
  if (markets) header.markets = String(markets).split(/[,;/ ]+/).filter(Boolean).map((m) => m.toUpperCase());
  if (block['buyer']) header.buyer = String(block['buyer']);
  if (block['series']) header.series = String(block['series']);

  const get = (row: (string | number | boolean | null)[], k: Col) => (c[k] === undefined ? null : row[c[k]!] ?? null);
  const lines: RawLine[] = [];
  const assemblies: RawAssembly[] = [];
  const asmKeys = new Set<string>();

  for (let r = hdr.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const l1 = str(get(row, 'l1'));
    const l2 = str(get(row, 'l2'));
    const partName = str(get(row, 'partName')) ?? l2;
    const T = num(get(row, 'T'));
    const W = num(get(row, 'W'));
    const L = num(get(row, 'L'));
    const qty = num(get(row, 'qty'));
    if (!l1 && !partName) continue;

    // Head row: an L1 without a component name sets the assembly quantity / size.
    if (l1 && !partName) {
      if (!asmKeys.has(l1)) {
        asmKeys.add(l1);
        assemblies.push({ key: l1, originalName: l1, qty: qty ?? 1, dims: T || W || L ? { T: T ?? 0, W: W ?? 0, L: L ?? 0 } : null, finishCode: str(get(row, 'finish')), stdCode: str(get(row, 'stdCode')), row: r + 1 });
      }
      continue;
    }
    if (l1 && !asmKeys.has(l1)) {
      asmKeys.add(l1);
      assemblies.push({ key: l1, originalName: l1, qty: 1, dims: null, finishCode: null, row: null });
    }

    const x = num(get(row, 'x'));
    const y = num(get(row, 'y'));
    const z = num(get(row, 'z'));
    const transform: Transform | null =
      x !== null && y !== null && z !== null
        ? { position: { x, y, z }, rotation: { x: num(get(row, 'rx')) ?? 0, y: num(get(row, 'ry')) ?? 0, z: num(get(row, 'rz')) ?? 0 } }
        : null;
    const unitRaw = str(get(row, 'unit'))?.toLowerCase() as Unit | undefined;
    const kindRaw = str(get(row, 'kind'))?.toLowerCase() as PartKind | undefined;
    const teamRaw = str(get(row, 'team'))?.toLowerCase();
    const team = (TEAM_IDS as readonly string[]).find((t) => teamRaw && (teamRaw === t || teamRaw.startsWith(t))) as Team | undefined;
    const kind = kindRaw && KINDS.includes(kindRaw) ? kindRaw : null;
    const section: Section = kind === 'hardware' || team === 'hardware' ? 'hardware' : kind === 'packing' ? 'packing' : kind === 'veneer' ? 'veneer' : 'main';
    if (qty === null) warnings.push(`Row ${r + 1}: missing Qty`);
    lines.push({
      originalName: partName!,
      l1,
      l2,
      stdCode: str(get(row, 'stdCode')),
      position: str(get(row, 'position')),
      dims: { T: T ?? 0, W: W ?? 0, L: L ?? 0 },
      qty: qty ?? 0,
      unit: unitRaw && UNITS.includes(unitRaw) ? unitRaw : null,
      material: str(get(row, 'material')),
      kind,
      finishCode: str(get(row, 'finish')),
      hardwareSku: str(get(row, 'sku')),
      teamOwner: team ?? null,
      notes: str(get(row, 'notes')) ?? '',
      transform,
      axisMap: parseAxisMap(get(row, 'axisMap')),
      section,
      row: r + 1,
    });
  }

  const built = buildContent(lines, assemblies, { sheet: sheet.name, family: cls.family, category, subCategory, header, dictionary: opts.dictionary });
  // An explicit Role column wins over inference.
  if (c.role !== undefined) {
    built.content.parts.forEach((p, i) => {
      const role = str(get(sheet.rows[(lines[i].row ?? 0) - 1] ?? [], 'role'));
      if (role) {
        p.role = role;
        p.roleSource = 'manual';
        built.preview[i].role = role;
        built.preview[i].roleSource = 'manual';
      }
    });
  }
  return {
    sheet: sheet.name,
    format: 'standard',
    product: { code, name: productName, category, subCategory, family: classifyProduct(`${productName} ${subCategory}`).family },
    revisionLabel: revision,
    content: { ...built.content, family: classifyProduct(`${productName} ${subCategory}`).family },
    preview: built.preview,
    warnings: [...warnings, ...built.warnings],
  };
}
