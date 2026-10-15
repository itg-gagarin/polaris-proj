import type { RevisionContent, Part } from '@bom/domain';
import { writeWorkbook, type SheetSpec, type CellValue } from '@bom/sheets';
import { formatAxisMap, roleInfo } from '@bom/dictionary';

export interface ExportInput {
  productCode: string;
  productName: string;
  category: string;
  subCategory: string;
  revisionLabel: string;
  revisionState?: string;
  content: RevisionContent;
}

const geometric = (p: Part) => (typeof p.attrs.geometric === 'boolean' ? p.attrs.geometric : roleInfo(p.role)?.geometric ?? (p.kind === 'solid' || p.kind === 'panel'));

/** BOM rows in the PRD §4 import format, so an export can be re-imported unchanged. */
export function bomRows(content: RevisionContent): Record<string, CellValue>[] {
  const asm = new Map(content.assemblies.map((a) => [a.id, a]));
  const rows: Record<string, CellValue>[] = [];
  const emitted = new Set<string>();
  for (const p of content.parts) {
    const a = p.assemblyId ? asm.get(p.assemblyId) : null;
    if (a && !emitted.has(a.id) && (a.qty !== 1 || a.dims)) {
      emitted.add(a.id);
      // L1 keeps the original free text (PRD §4); the Std Code column carries the standard identity.
      rows.push({ stdCode: a.stdCode, l1: a.originalName.trim(), l2: null, partName: null, T: a.dims?.T ?? null, W: a.dims?.W ?? null, L: a.dims?.L ?? null, qty: a.qty, finish: a.finishCode });
    }
    const t = p.instanceTransforms[0];
    rows.push({
      stdCode: p.stdCode,
      l1: a ? (a.qty !== 1 || a.dims ? a.originalName.trim() : null) : p.l1,
      l2: p.l2,
      partName: p.originalName,
      position: p.position,
      T: p.dims.T,
      W: p.dims.W,
      L: p.dims.L,
      qty: p.qty,
      unit: p.unit,
      material: p.material,
      finish: p.finishCode,
      sku: p.hardwareSku,
      team: p.teamOwner,
      x: t?.position.x ?? null,
      y: t?.position.y ?? null,
      z: t?.position.z ?? null,
      rx: t?.rotation.x ?? null,
      ry: t?.rotation.y ?? null,
      rz: t?.rotation.z ?? null,
      notes: p.notes || null,
      axisMap: formatAxisMap(p.axisMap) || null,
      role: p.role,
      kind: p.kind,
      match: p.match.status,
    });
  }
  return rows;
}

export interface TakeOffRow {
  material: string;
  kind: string;
  thickness: number | null;
  pieces: number;
  volumeM3: number;
  areaM2: number;
}

/** Material take-off at cut size: solid m³ and panel / veneer m² (PRD §10). */
export function materialTakeOff(content: RevisionContent): TakeOffRow[] {
  const m = new Map<string, TakeOffRow>();
  for (const p of content.parts) {
    if (p.kind !== 'solid' && p.kind !== 'panel' && p.kind !== 'veneer') continue;
    const material = p.material ?? '(unspecified)';
    const thickness = p.kind === 'solid' ? null : p.dims.T;
    const key = `${material}|${p.kind}|${thickness ?? ''}`;
    const row = m.get(key) ?? { material, kind: p.kind, thickness, pieces: 0, volumeM3: 0, areaM2: 0 };
    row.pieces += p.qty;
    row.volumeM3 += (p.dims.T * p.dims.W * p.dims.L * p.qty) / 1e9;
    row.areaM2 += (p.dims.W * p.dims.L * p.qty) / 1e6;
    m.set(key, row);
  }
  return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.material.localeCompare(b.material) || (a.thickness ?? 0) - (b.thickness ?? 0));
}

export function cutListRows(content: RevisionContent): Record<string, CellValue>[] {
  return content.parts
    .filter((p) => (p.kind === 'solid' || p.kind === 'panel') && geometric(p))
    .map((p) => ({ stdCode: p.stdCode, l1: p.l1, partName: p.originalName, material: p.material, T: p.dims.T, W: p.dims.W, L: p.dims.L, qty: p.qty, finish: p.finishCode, notes: p.notes || null }))
    .sort((a, b) => String(a.material).localeCompare(String(b.material)) || Number(a.T) - Number(b.T) || Number(b.L) - Number(a.L));
}

const BOM_COLUMNS = [
  { header: 'Std Code', key: 'stdCode', width: 12 },
  { header: 'L1', key: 'l1', width: 22 },
  { header: 'L2', key: 'l2', width: 22 },
  { header: 'Part Name', key: 'partName', width: 30 },
  { header: 'Position', key: 'position', width: 10 },
  { header: 'T', key: 'T', width: 7 },
  { header: 'W', key: 'W', width: 7 },
  { header: 'L', key: 'L', width: 7 },
  { header: 'Qty', key: 'qty', width: 6 },
  { header: 'Unit', key: 'unit', width: 6 },
  { header: 'Material / Species', key: 'material', width: 20 },
  { header: 'Finish Code', key: 'finish', width: 10 },
  { header: 'Hardware SKU', key: 'sku', width: 24 },
  { header: 'Team Owner', key: 'team', width: 12 },
  { header: 'X', key: 'x', width: 7 },
  { header: 'Y', key: 'y', width: 7 },
  { header: 'Z', key: 'z', width: 7 },
  { header: 'RotX', key: 'rx', width: 6 },
  { header: 'RotY', key: 'ry', width: 6 },
  { header: 'RotZ', key: 'rz', width: 6 },
  { header: 'Notes', key: 'notes', width: 30 },
  { header: 'Axis Map', key: 'axisMap', width: 13 },
  { header: 'Role', key: 'role', width: 16 },
  { header: 'Kind', key: 'kind', width: 9 },
  { header: 'Match', key: 'match', width: 9 },
];

export function exportSheets(input: ExportInput): SheetSpec[] {
  const { content } = input;
  const size = content.header.productSize;
  const h = content.header;
  const preamble: CellValue[][] = [
    ['Product Code', input.productCode],
    ['Product Name', input.productName],
    ['Category', input.category],
    ['Sub-category', input.subCategory],
    ['Revision', input.revisionLabel],
    ['Product Size', size ? `${size.W} x ${size.D} x ${size.H}` : null],
    ['Packing Size', h.packingSizes.map((p) => `${p.W} x ${p.D} x ${p.H}`).join('; ') || null],
    ['Buyer', h.buyer],
    ['Series', h.series],
    ['Spec', h.spec],
    ['Set Up', h.setup],
    ['Carton Box', h.carton],
    ['NW', h.netWeightKg],
    ['GW', h.grossWeightKg],
    ['Load 40HC', h.loadQty40HC],
    ['Markets', h.markets.join(', ') || null],
    ['Sheet Note', h.sheetNote],
    ['State', input.revisionState ?? null],
  ];
  const takeoff = materialTakeOff(content);
  return [
    { name: 'BOM', preamble, columns: BOM_COLUMNS, rows: bomRows(content) },
    {
      name: 'Cut list',
      preamble: [[`Cut list — ${input.productName} rev ${input.revisionLabel}`], ['All sizes in mm at cut size']],
      columns: [
        { header: 'Material', key: 'material', width: 22 },
        { header: 'T', key: 'T', width: 7 },
        { header: 'W', key: 'W', width: 7 },
        { header: 'L', key: 'L', width: 7 },
        { header: 'Qty', key: 'qty', width: 6 },
        { header: 'Part Name', key: 'partName', width: 30 },
        { header: 'L1', key: 'l1', width: 22 },
        { header: 'Std Code', key: 'stdCode', width: 12 },
        { header: 'Finish', key: 'finish', width: 8 },
        { header: 'Notes', key: 'notes', width: 30 },
      ],
      rows: cutListRows(content),
    },
    {
      name: 'Material take-off',
      preamble: [[`Material take-off by species — ${input.productName} rev ${input.revisionLabel}`], ['Solid in m³, panel and veneer in m², at cut size']],
      columns: [
        { header: 'Material', key: 'material', width: 26 },
        { header: 'Kind', key: 'kind', width: 8 },
        { header: 'Thickness (mm)', key: 'thickness', width: 14 },
        { header: 'Pieces', key: 'pieces', width: 8 },
        { header: 'Solid m³', key: 'volumeM3', width: 10, numFmt: '0.00000' },
        { header: 'Panel m²', key: 'areaM2', width: 10, numFmt: '0.000' },
      ],
      rows: takeoff.map((r) => ({ ...r, volumeM3: r.kind === 'solid' ? r.volumeM3 : null, areaM2: r.kind === 'solid' ? null : r.areaM2 })),
    },
    {
      name: 'Hardware',
      columns: [
        { header: 'Hardware SKU', key: 'sku', width: 40 },
        { header: 'Qty', key: 'qty', width: 6 },
        { header: 'Unit', key: 'unit', width: 6 },
        { header: 'Role', key: 'role', width: 14 },
        { header: 'Std Code', key: 'stdCode', width: 12 },
      ],
      rows: content.parts.filter((p) => p.kind === 'hardware').map((p) => ({ sku: p.hardwareSku ?? p.originalName, qty: p.qty, unit: p.unit, role: p.role, stdCode: p.stdCode })),
    },
  ];
}

export function exportBomWorkbook(input: ExportInput): Promise<Uint8Array> {
  return writeWorkbook(exportSheets(input));
}

/** Several products (one sheet each) in the import format — used to write fixtures. */
export function exportProductsWorkbook(inputs: ExportInput[]): Promise<Uint8Array> {
  return writeWorkbook(
    inputs.map((i) => {
      const s = exportSheets(i)[0];
      return { ...s, name: i.productCode.replace(/^[A-Z]+-[A-Z]+-/, '').slice(0, 31) };
    }),
  );
}

export function exportJson(input: ExportInput): string {
  return JSON.stringify({ format: 'bom-studio/revision@1', exportedAt: new Date().toISOString(), ...input }, null, 2);
}
