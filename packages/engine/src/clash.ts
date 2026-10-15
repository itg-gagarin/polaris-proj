import type { Joint, JointType, RevisionContent, WorkspaceSettings, Confidence, Vec3 } from '@bom/domain';
import { DEFAULT_SETTINGS, stableId } from '@bom/domain';
import { BoxTree, intersectBoxes, isAxisAligned, obbFrom, obbPenetration, boxCenter, type Box } from './geometry';
import type { Layout, PlacedInstance } from './layout';

export interface ClashPair {
  a: PlacedInstance;
  b: PlacedInstance;
  depth: number;
  volume: number;
  at: Vec3;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function clashable(i: PlacedInstance): boolean {
  return i.source !== 'tray' && i.source !== 'stack' && !i.packing;
}

/** All overlapping instance pairs (no joint filtering). */
export function overlappingPairs(layout: Layout, eps: number, filter?: (i: PlacedInstance) => boolean): ClashPair[] {
  const inst = layout.instances.filter((i) => clashable(i) && (!filter || filter(i)));
  const boxes: Box[] = inst.map((i) => ({ min: i.min, max: i.max }));
  const tree = new BoxTree(boxes);
  const out: ClashPair[] = [];
  for (const [ia, ib] of tree.pairs(eps)) {
    const a = inst[ia];
    const b = inst[ib];
    if (a.partId === b.partId && a.index === b.index) continue;
    const hit = intersectBoxes(boxes[ia], boxes[ib]);
    if (!hit) continue;
    let depth = hit.depth;
    if (!isAxisAligned(a.rotation) || !isAxisAligned(b.rotation)) {
      depth = obbPenetration(obbFrom(boxCenter(boxes[ia]), a.size, a.rotation), obbFrom(boxCenter(boxes[ib]), b.size, b.rotation));
      if (depth <= 0) continue;
    }
    if (depth <= eps) continue;
    out.push({ a, b, depth, volume: hit.volume, at: boxCenter(hit.box) });
  }
  return out;
}

function guessJointType(roleA: string | null, roleB: string | null, depth: number): JointType {
  const r = `${roleA} ${roleB}`;
  if (/block|Block/.test(r)) return 'glue-block';
  if (depth <= 8 && /(back|Bottom|dustPanel|Panel|Skin|Lining)/.test(r)) return 'groove';
  if (/(Rail|Stile|rail|stile)/.test(r)) return 'tenon';
  if (/(slide|runner)/.test(r)) return 'screw';
  return 'contact';
}

/**
 * Template joints: overlaps between static carcass parts (and between parts of the same moving
 * assembly, e.g. a drawer box) as laid out at import are declared intended joinery with their
 * as-designed overlap. Anything that later grows beyond it — and every overlap between a moving
 * part and the carcass — is a clash.
 */
export function deriveTemplateJoints(content: RevisionContent, layout: Layout, settings: WorkspaceSettings = DEFAULT_SETTINGS): Joint[] {
  const tol = settings.thresholds.clashTolerance;
  const best = new Map<string, { a: string; b: string; depth: number; ra: string | null; rb: string | null }>();
  for (const c of overlappingPairs(layout, tol)) {
    const sameRigid = c.a.group === c.b.group;
    const bothStatic = !c.a.moving && !c.b.moving;
    if (!sameRigid && !bothStatic) continue;
    if (c.a.partId === c.b.partId) continue;
    const k = pairKey(c.a.partId, c.b.partId);
    const prev = best.get(k);
    if (!prev || c.depth > prev.depth) best.set(k, { a: c.a.partId, b: c.b.partId, depth: c.depth, ra: c.a.role, rb: c.b.role });
  }
  const userJoints = content.joints.filter((j) => j.source !== 'template');
  const userKeys = new Set(userJoints.map((j) => pairKey(j.partA, j.partB)));
  const joints: Joint[] = [];
  for (const [k, v] of best) {
    if (userKeys.has(k)) continue;
    const [a, b] = v.a < v.b ? [v.a, v.b] : [v.b, v.a];
    joints.push({
      id: stableId('joint', k),
      partA: a,
      partB: b,
      type: guessJointType(v.ra, v.rb, v.depth),
      allowedOverlapMm: Math.ceil(v.depth * 10) / 10,
      source: 'template',
    });
  }
  return [...userJoints, ...joints];
}

export interface ClashResult {
  partA: string;
  partB: string;
  pairs: number;
  depth: number;
  allowed: number;
  at: Vec3;
  confidence: Confidence;
  moving: boolean;
}

/** Clashes = overlaps above tolerance not covered by a declared joint (PRD §7). */
export function detectClashes(content: RevisionContent, layout: Layout, settings: WorkspaceSettings = DEFAULT_SETTINGS, filter?: (i: PlacedInstance) => boolean): ClashResult[] {
  const tol = settings.thresholds.clashTolerance;
  const allowed = new Map<string, number>();
  for (const j of content.joints) allowed.set(pairKey(j.partA, j.partB), Math.max(allowed.get(pairKey(j.partA, j.partB)) ?? 0, j.allowedOverlapMm));
  const out = new Map<string, ClashResult>();
  for (const c of overlappingPairs(layout, tol, filter)) {
    const k = pairKey(c.a.partId, c.b.partId);
    const allow = allowed.get(k) ?? 0;
    if (c.depth <= allow + tol) continue;
    const conf: Confidence = c.a.confidence === 'low' || c.b.confidence === 'low' ? 'low' : c.a.source === 'explicit' && c.b.source === 'explicit' ? 'high' : 'medium';
    const prev = out.get(k);
    if (prev) {
      prev.pairs++;
      if (c.depth > prev.depth) {
        prev.depth = c.depth;
        prev.at = c.at;
      }
      continue;
    }
    const [a, b] = c.a.partId < c.b.partId ? [c.a, c.b] : [c.b, c.a];
    out.set(k, { partA: a.partId, partB: b.partId, pairs: 1, depth: c.depth, allowed: allow, at: c.at, confidence: conf, moving: c.a.moving !== c.b.moving });
  }
  return [...out.values()].sort((x, y) => y.depth - x.depth);
}
