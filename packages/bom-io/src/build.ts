import type {
  Assembly, AxisMap, LayoutFamily, Part, PartKind, ProductHeader, RevisionContent, Team, Transform, Unit, PartRole,
} from '@bom/domain';
import { stableId, makePart, makeAssembly, emptyContent } from '@bom/domain';
import { DictionaryIndex, inferRole, inferAssemblyRole, roleInfo, normalizeName, stripAssemblyPrefix } from '@bom/dictionary';
import type { ImportRowPreview } from './types';

export type Section = 'main' | 'veneer' | 'hardware' | 'packing';

export interface RawLine {
  originalName: string;
  l1: string | null;
  l2?: string | null;
  stdCode?: string | null;
  position?: string | null;
  dims: { T: number; W: number; L: number };
  qty: number;
  unit?: Unit | null;
  material?: string | null;
  materialCode?: string | null;
  kind?: PartKind | null;
  finishCode?: string | null;
  hardwareSku?: string | null;
  teamOwner?: Team | null;
  notes?: string;
  transform?: Transform | null;
  axisMap?: AxisMap | null;
  section: Section;
  row?: number | null;
  attrs?: Part['attrs'];
}

export interface RawAssembly {
  /** Key used by lines' l1. */
  key: string;
  originalName: string;
  qty: number;
  dims: { T: number; W: number; L: number } | null;
  finishCode: string | null;
  stdCode?: string | null;
  row?: number | null;
}

export interface BuildContext {
  sheet: string;
  family: LayoutFamily;
  category: string;
  subCategory: string;
  header: ProductHeader;
  dictionary?: DictionaryIndex | null;
}

/** Dictionary roles that name a whole assembly; the part's own name is more specific. */
const COARSE_ROLES = new Set(['drawer', 'body', 'legs', 'headboard', 'footboard', 'sideRails', 'skid', 'hardwarePack', 'hardware', 'profile', 'block']);

/** Display sizes for hardware the sheet lists without a size (flagged as assumed). */
export const HARDWARE_DEFAULT_DIMS: Record<string, { T: number; W: number; L: number }> = {
  knob: { T: 25, W: 30, L: 30 },
  handle: { T: 25, W: 20, L: 128 },
  glide: { T: 10, W: 25, L: 25 },
};

const SYNTHETIC_L1: Record<string, string> = { skid: 'Pallet Skid', hardware: 'Hardware Bungkus', packing: 'Packing', veneer: 'Veneer', body: 'Body' };

function familyHint(f: LayoutFamily): string {
  return f;
}

export function buildContent(lines: RawLine[], assemblies: RawAssembly[], ctx: BuildContext): { content: RevisionContent; preview: ImportRowPreview[]; warnings: string[] } {
  const content = emptyContent(ctx.family);
  content.header = ctx.header;
  const warnings: string[] = [];
  const preview: ImportRowPreview[] = [];
  const dict = ctx.dictionary ?? null;
  const asmByKey = new Map<string, Assembly>();

  const scope = { category: ctx.category, subCategory: ctx.subCategory };

  assemblies.forEach((a, i) => {
    const m = dict?.match({ stdCode: a.stdCode, name: a.originalName, ...scope, level: 1 });
    const asm = makeAssembly({
      id: stableId('asm', `${ctx.sheet}|${a.key}|${i}`),
      name: m && (m.status === 'code' || m.status === 'exact') ? m.entry!.name : titleCase(stripAssemblyPrefix(normalizeName(a.originalName))) || a.originalName,
      originalName: a.originalName.trim(),
      stdCode: m && m.status !== 'unmatched' ? m.stdCode : null,
      qty: a.qty || 1,
      dims: a.dims,
      role: inferAssemblyRole(a.originalName),
      finishCode: a.finishCode,
    });
    asmByKey.set(a.key, asm);
    content.assemblies.push(asm);
  });

  const syntheticAsm = (group: string): Assembly => {
    const key = `__${group}`;
    let asm = asmByKey.get(key);
    if (!asm) {
      const name = SYNTHETIC_L1[group] ?? 'Body';
      const m = dict?.match({ name, ...scope, level: 1 });
      asm = makeAssembly({
        id: stableId('asm', `${ctx.sheet}|${key}`),
        name: m && (m.status === 'exact' || m.status === 'code') ? m.entry!.name : name,
        originalName: name,
        stdCode: m && (m.status === 'exact' || m.status === 'code') ? m.stdCode : null,
        qty: 1,
        role: group === 'skid' ? 'skid' : group === 'hardware' ? 'hardwarePack' : group === 'body' ? 'body' : group,
      });
      asmByKey.set(key, asm);
      content.assemblies.push(asm);
    }
    return asm;
  };

  const rawAsm = new Map(assemblies.map((a) => [a.key, a]));

  lines.forEach((ln, i) => {
    const issues: string[] = [];
    const l1Name = ln.l1 ? rawAsm.get(ln.l1)?.originalName ?? ln.l1 : null;
    const guess = inferRole(ln.originalName, l1Name, { family: familyHint(ctx.family) });
    let m = dict?.match({ stdCode: ln.stdCode, name: ln.originalName, l1: l1Name, position: ln.position, ...scope, level: ln.l1 ? 2 : null }) ?? null;
    // Hardware lines roll up to the sub-category's "Hardware Bungkus" (hardware pack) head, as the dictionary does.
    if (ln.section === 'hardware' && dict && (!m || m.status === 'unmatched' || m.status === 'fuzzy')) {
      const pack = syntheticAsm('hardware');
      const packEntry = pack.stdCode ? dict.get(pack.stdCode) : undefined;
      if (packEntry) m = { status: 'exact', stdCode: packEntry.stdCode, entry: packEntry, score: 1, candidates: [{ stdCode: packEntry.stdCode, name: packEntry.name, score: 1, reason: 'hardware line → Hardware Bungkus head' }], position: null };
    }
    const entry = m?.entry ?? null;

    // Role: a specific dictionary Default Role wins; otherwise the name rules.
    let role: PartRole | null = guess.role;
    let roleSource: Part['roleSource'] = guess.role ? 'inferred' : null;
    if (entry?.defaultRole && !COARSE_ROLES.has(entry.defaultRole) && (m!.status === 'code' || m!.status === 'exact')) {
      role = entry.defaultRole;
      roleSource = 'dictionary';
    }
    const ri = roleInfo(role);

    let axisMap: AxisMap | null = null;
    let axisSource: ImportRowPreview['axisSource'] = null;
    if (ln.axisMap) {
      axisMap = ln.axisMap;
      axisSource = 'column';
    } else if (entry?.axisMap && entry.defaultRole && entry.defaultRole === role) {
      axisMap = entry.axisMap;
      axisSource = 'dictionary';
    } else if (guess.axisMap && role === guess.role) {
      axisMap = guess.axisMap;
      axisSource = 'role';
    } else if (ri?.axis) {
      axisMap = ri.axis;
      axisSource = 'role';
    }

    const kind: PartKind =
      ln.section === 'packing' || ri?.kind === 'packing'
        ? 'packing'
        : ln.kind ?? (ln.section === 'hardware' ? 'hardware' : ln.section === 'veneer' ? 'veneer' : ri?.kind ?? 'other');
    const geometric = ln.section === 'veneer' ? false : ri ? ri.geometric : kind !== 'hardware' && kind !== 'packing' && kind !== 'veneer';
    const teamOwner: Team =
      ln.teamOwner ??
      (entry?.ownerTeam && (m!.status === 'code' || m!.status === 'exact') && !COARSE_ROLES.has(entry.defaultRole ?? '') ? entry.ownerTeam : null) ??
      ri?.team ??
      (kind === 'hardware' ? 'hardware' : kind === 'packing' ? 'packing' : kind === 'veneer' ? 'finishing' : 'engineering');

    let asm: Assembly | null = ln.l1 ? asmByKey.get(ln.l1) ?? null : null;
    if (!asm) {
      const group = ln.section === 'hardware' ? 'hardware' : ln.section === 'packing' ? (role === 'skidLong' || role === 'skidShort' ? 'skid' : 'packing') : ln.section === 'veneer' ? 'veneer' : role === 'skidLong' || role === 'skidShort' || role === 'skidBlock' ? 'skid' : 'body';
      asm = syntheticAsm(group);
    }

    const dims = { ...ln.dims };
    const assumed = role ? HARDWARE_DEFAULT_DIMS[role] : undefined;
    if (assumed && geometric && (!dims.T || !dims.W || !dims.L)) {
      Object.assign(dims, assumed);
      issues.push(`Size not on the sheet — assumed ${assumed.T}×${assumed.W}×${assumed.L} mm for display`);
    }
    if (!role && geometric) issues.push('No placement role — will go to the Unplaced tray until a role is set');
    if (m && m.status === 'fuzzy') issues.push(`Fuzzy match (${Math.round(m.score * 100)}%) — needs confirmation`);
    if (m && m.status === 'unmatched') issues.push('No Std Code match');
    if (ln.qty <= 0) issues.push('Quantity is zero');
    if (geometric && (dims.T <= 0 || dims.W <= 0 || dims.L <= 0)) issues.push('Missing cut size');
    if (ln.transform && ln.qty > 1) issues.push('X/Y/Z given on a line with qty > 1: only the first piece is placed exactly');

    const part = makePart({
      id: stableId('part', `${ctx.sheet}|${ln.row ?? i}|${ln.originalName}|${i}`),
      originalName: ln.originalName.trim(),
      name: entry && (m!.status === 'code' || m!.status === 'exact') && entry.level === 2 && normalizeName(entry.name) === normalizeName(ln.originalName) ? entry.name : ln.originalName.trim(),
      stdCode: m && m.status !== 'unmatched' ? m.stdCode : ln.stdCode ?? null,
      match: m
        ? { status: m.status, score: m.score, candidates: m.candidates }
        : { status: ln.stdCode ? 'code' : 'unmatched', score: null, candidates: [] },
      l1: asm.name,
      l2: ln.l2 ?? ln.originalName.trim(),
      position: ln.position ?? m?.position ?? guess.position,
      dims,
      qty: ln.qty,
      unit: ln.unit ?? guess.unit ?? 'pcs',
      kind,
      material: ln.material ?? null,
      materialCode: ln.materialCode ?? null,
      finishCode: ln.finishCode ?? null,
      hardwareSku: ln.hardwareSku ?? null,
      teamOwner,
      role,
      roleSource,
      axisMap,
      instanceTransforms: ln.transform ? { 0: ln.transform } : {},
      assemblyId: asm.id,
      visible: null,
      notes: ln.notes ?? '',
      source: { sheet: ctx.sheet, row: ln.row ?? undefined },
      attrs: { ...(ln.attrs ?? {}), section: ln.section, geometric, axisSource, ...(issues.some((x) => x.startsWith('Size not')) ? { dimsAssumed: true } : {}) },
    });
    content.parts.push(part);
    preview.push({
      partId: part.id,
      sheetRow: ln.row ?? null,
      originalName: part.originalName,
      l1: ln.l1,
      qty: part.qty,
      dims: part.dims,
      match: { status: part.match.status, stdCode: part.stdCode, name: entry?.name ?? null, score: part.match.score, candidates: part.match.candidates },
      role,
      roleSource,
      axisMap,
      axisSource,
      geometric,
      issues,
    });
  });

  return { content, preview, warnings };
}

export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
