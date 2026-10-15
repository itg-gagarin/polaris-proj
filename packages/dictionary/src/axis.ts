import type { AxisMap, Axis, DimKey } from '@bom/domain';

/** Parse "T:x W:z L:y" (also "T=x, W=z, L=y" or "x z y" in T,W,L order). Returns null when invalid. */
export function parseAxisMap(raw: unknown): AxisMap | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const out: Partial<Record<DimKey, Axis>> = {};
  const pairs = [...s.matchAll(/([twl])\s*[:=]\s*([xyz])/g)];
  if (pairs.length) {
    for (const [, d, a] of pairs) out[d.toUpperCase() as DimKey] = a as Axis;
  } else {
    const bare = s.match(/^([xyz])[\s,/]*([xyz])[\s,/]*([xyz])$/);
    if (!bare) return null;
    out.T = bare[1] as Axis;
    out.W = bare[2] as Axis;
    out.L = bare[3] as Axis;
  }
  if (!out.T || !out.W || !out.L) return null;
  if (new Set([out.T, out.W, out.L]).size !== 3) return null;
  return out as AxisMap;
}

export function formatAxisMap(m: AxisMap | null): string {
  return m ? `T:${m.T} W:${m.W} L:${m.L}` : '';
}

export function axisMapFrom(s: string): AxisMap {
  const m = parseAxisMap(s);
  if (!m) throw new Error(`Bad axis map ${s}`);
  return m;
}
