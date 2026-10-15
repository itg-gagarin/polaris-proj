import type { StdPart, AxisMap, PartRole, Team } from '@bom/domain';
import { inferRole, inferAssemblyRole, roleInfo } from './roles';
import { topUsed } from './quality';
import { formatAxisMap, parseAxisMap } from './axis';

/** Enrichment for the dictionary's new columns (PRD §4: add Axis Map and Default Role). */
export interface OverlayRow {
  stdCode: string;
  axisMap: string | null;
  defaultRole: PartRole | null;
  ownerTeam: Team | null;
  /** 'rule-proposed' until a person from the dictionary owner team reviews it. */
  status: 'rule-proposed' | 'reviewed';
  note?: string;
}

export interface Overlay {
  version: 1;
  generatedAt: string;
  description: string;
  rows: OverlayRow[];
}

const FAMILY_OF_CATEGORY: Record<string, string> = { Beds: 'bed' };

/** Propose axis map / role / owner for one entry from its standard name (rules in roles.ts). */
export function proposeEnrichment(e: StdPart): OverlayRow {
  const family = FAMILY_OF_CATEGORY[e.category];
  if (e.level === 1) {
    const ar = inferAssemblyRole(e.name);
    const g = inferRole(e.name, null, { family });
    const role = g.role && roleInfo(g.role)?.geometric !== false && !ar ? g.role : null;
    const team: Team | null =
      ar === 'skid' ? 'packing' : ar === 'hardwarePack' ? 'hardware' : ar === 'counterweight' || ar === 'stretcher' || ar === 'body' ? 'engineering' : ar ? 'design' : g.info?.team ?? null;
    return { stdCode: e.stdCode, axisMap: role ? formatAxisMap(g.axisMap) : null, defaultRole: role ?? (ar as PartRole | null), ownerTeam: team, status: 'rule-proposed', note: ar ? `assembly: ${ar}` : undefined };
  }
  const g = inferRole(e.l2 ?? e.name, e.l1, { family });
  return {
    stdCode: e.stdCode,
    axisMap: formatAxisMap(g.axisMap) || null,
    defaultRole: g.role,
    ownerTeam: g.info?.team ?? null,
    status: 'rule-proposed',
    note: g.ruleId ? `rule ${g.ruleId}` : 'no rule matched',
  };
}

/** Build the overlay for the N most-used Std Codes (phase-0 gate: N = 50). */
export function buildOverlay(entries: StdPart[], n = 50): Overlay {
  return {
    version: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    description: `Axis Map / Default Role / Owner Team for the ${n} most-used Std Codes (by # SG Lines). Proposed by name rules; status flips to "reviewed" after the dictionary owner checks each row.`,
    rows: topUsed(entries, n).map(proposeEnrichment),
  };
}

/** Merge an overlay into dictionary entries (sheet values win when present). */
export function applyOverlay(entries: StdPart[], overlay: Overlay | null | undefined): StdPart[] {
  if (!overlay) return entries;
  const m = new Map(overlay.rows.map((r) => [r.stdCode, r]));
  return entries.map((e) => {
    const r = m.get(e.stdCode);
    if (!r) return e;
    return {
      ...e,
      axisMap: e.axisMap ?? (parseAxisMap(r.axisMap) as AxisMap | null),
      defaultRole: e.defaultRole ?? r.defaultRole,
      ownerTeam: e.ownerTeam ?? r.ownerTeam,
    };
  });
}
