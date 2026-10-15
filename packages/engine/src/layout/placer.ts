import type { Assembly, Part, Vec3, Confidence, Transform } from '@bom/domain';
import { worldSize, obbFrom, obbToAabb, v3, add, boxCenter, unionBox, type Box } from '../geometry';
import { ContentIndex, isGeometric } from '../model';
import type { Layout, PlacedInstance, Requirement } from './types';

/** Trim allowance: veneered panels are cut up to this much over their finished size. */
export const MAX_TRIM_MM = 20;

export function instanceCount(p: Part): number {
  // Hardware sold in pairs gives two bodies per unit (a slide pair = left + right slide).
  return Math.max(0, Math.round(p.qty)) * (p.unit === 'pair' ? 2 : 1);
}

export interface PutOptions {
  asmInstance?: number;
  group?: string;
  moving?: boolean;
  confidence?: Confidence;
  explode?: Vec3;
  /** Override world size (e.g. computed in the template). */
  size?: Vec3;
  /** Clip the size to this envelope (world extents of the assembly). */
  envelope?: Vec3 | null;
  source?: PlacedInstance['source'];
}

export class Placer {
  readonly instances: PlacedInstance[] = [];
  private placed = new Map<string, Set<number>>();
  readonly unplaced: Layout['unplaced'] = [];
  readonly requirements: Requirement[] = [];
  readonly notes: string[] = [];

  constructor(readonly ix: ContentIndex) {}

  /** World size of a part, clipped to an envelope when the overshoot is a trim allowance. */
  sizeOf(p: Part, envelope?: Vec3 | null): { size: Vec3; trimmed: boolean } {
    const s = worldSize(p.dims, p.axisMap);
    let trimmed = false;
    if (envelope) {
      for (const k of ['x', 'y', 'z'] as const) {
        const over = s[k] - envelope[k];
        if (envelope[k] > 0 && over > 0 && over <= MAX_TRIM_MM) {
          s[k] = envelope[k];
          trimmed = true;
        }
      }
    }
    return { size: s, trimmed };
  }

  asmEnvelope(a: Assembly | undefined, axisMap: Part['axisMap']): Vec3 | null {
    if (!a?.dims) return null;
    return worldSize(a.dims, axisMap);
  }

  isPlaced(p: Part, i: number): boolean {
    return this.placed.get(p.id)?.has(i) ?? false;
  }

  put(p: Part, i: number, min: Vec3, o: PutOptions = {}): PlacedInstance {
    const asm = this.ix.asm(p);
    const { size, trimmed } = o.size ? { size: o.size, trimmed: false } : this.sizeOf(p, o.envelope === undefined ? this.asmEnvelope(asm, p.axisMap) : o.envelope);
    const asmInstance = o.asmInstance ?? 0;
    const inst: PlacedInstance = {
      key: `${p.id}#${i}`,
      partId: p.id,
      index: i,
      assemblyId: p.assemblyId,
      asmInstance,
      group: o.group ?? `${p.assemblyId ?? 'none'}#${asmInstance}`,
      role: p.role,
      min: { ...min },
      max: add(min, size),
      size,
      rotation: v3(),
      moving: o.moving ?? false,
      source: o.source ?? 'template',
      confidence: o.confidence ?? (p.roleSource === 'dictionary' ? 'high' : 'medium'),
      explode: o.explode ?? v3(),
      trimmed,
      kind: p.kind,
      packing: p.kind === 'packing',
    };
    const set = this.placed.get(p.id) ?? new Set<number>();
    set.add(i);
    this.placed.set(p.id, set);
    this.instances.push(inst);
    return inst;
  }

  removeWhere(pred: (inst: PlacedInstance) => boolean): void {
    for (let k = this.instances.length - 1; k >= 0; k--) {
      const inst = this.instances[k];
      if (!pred(inst)) continue;
      this.instances.splice(k, 1);
      this.placed.get(inst.partId)?.delete(inst.index);
    }
  }

  requireCount(r: Requirement): void {
    this.requirements.push(r);
  }

  /** Apply explicit transforms (CAD-style import / moved by hand); they override the template. */
  applyExplicit(): void {
    for (const p of this.ix.parts) {
      for (const [k, t] of Object.entries(p.instanceTransforms ?? {})) {
        const i = Number(k);
        const existing = this.instances.find((x) => x.partId === p.id && x.index === i);
        const size = existing?.size ?? this.sizeOf(p).size;
        const placed = placeExplicit(p, i, size, t);
        if (existing) {
          Object.assign(existing, { min: placed.min, max: placed.max, rotation: placed.rotation, source: 'explicit', confidence: 'high' });
        } else if (isGeometric(p) && i < instanceCount(p)) {
          const inst = this.put(p, i, placed.min, { size, source: 'explicit', confidence: 'high' });
          Object.assign(inst, { max: placed.max, rotation: placed.rotation });
        }
      }
    }
  }

  /** Every geometric instance the template did not place goes to the Unplaced tray. */
  collectUnplaced(defaultReason: (p: Part) => string): void {
    for (const p of this.ix.parts) {
      if (!isGeometric(p)) continue;
      const n = instanceCount(p);
      let missing = 0;
      for (let i = 0; i < n; i++) if (!this.isPlaced(p, i)) missing++;
      if (missing) this.unplaced.push({ partId: p.id, count: missing, reason: defaultReason(p) });
    }
  }

  /** Lay tray instances out beside the model so they stay visible. */
  layoutTray(after: Box): void {
    let x = after.max.x + 300;
    let z = 0;
    let rowDepth = 0;
    const maxRow = Math.max(1500, after.max.x - after.min.x);
    for (const u of this.unplaced) {
      const p = this.ix.byId.get(u.partId)!;
      const { size } = this.sizeOf(p);
      for (let i = 0; i < instanceCount(p); i++) {
        if (this.isPlaced(p, i)) continue;
        if (x + size.x > after.max.x + 300 + maxRow) {
          x = after.max.x + 300;
          z += rowDepth + 50;
          rowDepth = 0;
        }
        this.put(p, i, v3(x, 0, z), { size, source: 'tray', confidence: 'low', group: 'tray' });
        x += size.x + 40;
        rowDepth = Math.max(rowDepth, size.z);
      }
    }
  }

  bounds(): Box {
    const real = this.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && !i.packing);
    return unionBox(real.length ? real : this.instances);
  }
}

function placeExplicit(_p: Part, _i: number, size: Vec3, t: Transform): { min: Vec3; max: Vec3; rotation: Vec3 } {
  const center = add(t.position, { x: size.x / 2, y: size.y / 2, z: size.z / 2 });
  const aabb = obbToAabb(obbFrom(center, size, t.rotation));
  return { min: t.position, max: add(t.position, size), rotation: { ...t.rotation }, ...(t.rotation.x || t.rotation.y || t.rotation.z ? { min: aabb.min, max: aabb.max } : {}) };
}

export { boxCenter };
