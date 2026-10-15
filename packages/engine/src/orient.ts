import type { AxisMap, Part, RevisionContent, Vec3 } from '@bom/domain';
import { worldSize } from './geometry';
import { ContentIndex } from './model';

export interface OrientChange {
  partId: string;
  from: AxisMap;
  to: AxisMap;
  reason: string;
}

type Expect = Partial<Vec3>;

/** Expected extents per role, from the inferred parameters. */
function expectations(ix: ContentIndex, params: Record<string, number>): Record<string, Expect> {
  const W = params['case.width'];
  const D = params['case.depth'];
  const legH = params['leg.height'];
  const legBW = params['leg.backWidth'] ?? 0;
  const legD = params['leg.depth'] ?? 0;
  const legBD = params['leg.backDepth'] ?? 0;
  const out: Record<string, Expect> = {};
  if (W && D && legH) {
    out.back = { x: W - 2 * legBW, y: legH };
    out.dustPanel = { x: params['opening.width'] ?? W, z: D * 0.75 };
    out.top = { x: W, z: D };
    out.sidePanel = { z: D - legD - legBD, y: legH };
    const front = ix.first('drawerFront');
    if (front) out.drawerBottom = { x: Math.max(front.dims.L, front.dims.W) * 0.95, z: D * 0.7 };
  }
  const size = ix.content.header.productSize;
  if (size && (ix.content.family === 'bed' || ix.content.family === 'bedComponent')) {
    out.bedPanel = { x: size.W * 0.85, y: Math.min(size.H, 1200) * 0.8 };
    out.slat = { x: size.W * 0.9 };
  }
  return out;
}

function swapWL(m: AxisMap): AxisMap {
  return { T: m.T, W: m.L, L: m.W };
}

function score(s: Vec3, e: Expect): number {
  let sum = 0;
  let n = 0;
  for (const k of ['x', 'y', 'z'] as const) {
    const v = e[k];
    if (!v) continue;
    sum += Math.abs(s[k] - v) / v;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Sheets swap W and L for the same kind of part (PRD §1: side-panel W/L swapped between sheets).
 * When the swapped axis map fits the expected extents much better, use it and say so.
 * Axis maps from an explicit column or set by a person are never changed.
 */
export function autoOrient(content: RevisionContent, params: Record<string, number>): { content: RevisionContent; changes: OrientChange[] } {
  const ix = new ContentIndex(content);
  const exp = expectations(ix, params);
  const changes: OrientChange[] = [];
  const size = content.header.productSize;
  // Product envelope in world axes (beds list W × H × D, case goods W × D × H — both are stored as {W, D, H}).
  const env = size ? { x: size.W, y: size.H, z: size.D } : null;
  const parts = content.parts.map((p): Part => {
    if (!p.axisMap) return p;
    if (p.attrs.axisSource === 'column' || p.attrs.axisSource === 'manual' || p.roleSource === 'manual') return p;
    const e = p.role ? exp[p.role] : undefined;
    if (!e) {
      // Generic: a part longer than the product along an axis, that fits when W/L are swapped.
      if (!env || p.kind === 'packing' || p.kind === 'hardware' || content.family === 'bed') return p;
      // Rails are laid along z while their header lists the length as width.
      if (ix.asm(p)?.role === 'sideRails') return p;
      const cur = worldSize(p.dims, p.axisMap);
      const alt = swapWL(p.axisMap);
      const altS = worldSize(p.dims, alt);
      const over = (v: Vec3) => (['x', 'y', 'z'] as const).some((k) => v[k] > env[k] + 20);
      if (over(cur) && !over(altS)) {
        changes.push({ partId: p.id, from: p.axisMap, to: alt, reason: `${p.originalName}: ${p.dims.W} × ${p.dims.L} does not fit the ${size!.W}×${size!.D}×${size!.H} product this way round — turned` });
        return { ...p, axisMap: alt, attrs: { ...p.attrs, axisSource: 'auto-oriented', axisNote: 'W/L swapped to fit inside the product (check the sheet)' } };
      }
      return p;
    }
    const cur = score(worldSize(p.dims, p.axisMap), e);
    const alt = swapWL(p.axisMap);
    const altScore = score(worldSize(p.dims, alt), e);
    if (cur > 0.15 && altScore < cur * 0.5) {
      changes.push({ partId: p.id, from: p.axisMap, to: alt, reason: `W and L look swapped for a ${p.role}: ${p.dims.W} × ${p.dims.L} fits better turned (error ${(cur * 100).toFixed(0)}% → ${(altScore * 100).toFixed(0)}%)` });
      return { ...p, axisMap: alt, attrs: { ...p.attrs, axisSource: 'auto-oriented', axisNote: 'W/L swapped to fit the product (check the sheet)' } };
    }
    return p;
  });
  return { content: { ...content, parts }, changes };
}
