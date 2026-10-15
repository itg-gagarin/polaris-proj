/** Pure geometry for box parts. No three.js, no DOM: runs in browser, worker, server and AI service alike. */
import type { AxisMap, Dims, Vec3, Axis } from '@bom/domain';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const DEFAULT_AXIS_MAP: AxisMap = { T: 'y', W: 'z', L: 'x' };

/** World extents of a part from its cut size and axis map. */
export function worldSize(dims: Dims, axisMap: AxisMap | null | undefined): Vec3 {
  const m = axisMap ?? DEFAULT_AXIS_MAP;
  const out = v3();
  (['T', 'W', 'L'] as const).forEach((k) => {
    out[m[k]] = dims[k];
  });
  return out;
}

/** Which cut dimension runs along a world axis. */
export function dimOnAxis(axisMap: AxisMap | null | undefined, axis: Axis): 'T' | 'W' | 'L' {
  const m = axisMap ?? DEFAULT_AXIS_MAP;
  return (['T', 'W', 'L'] as const).find((k) => m[k] === axis)!;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

export const boxFrom = (min: Vec3, size: Vec3): Box => ({ min, max: add(min, size) });
export const boxSize = (b: Box): Vec3 => sub(b.max, b.min);
export const boxCenter = (b: Box): Vec3 => scale(add(b.min, b.max), 0.5);

export function unionBox(boxes: Box[]): Box {
  if (!boxes.length) return { min: v3(), max: v3() };
  const min = { ...boxes[0].min };
  const max = { ...boxes[0].max };
  for (const b of boxes) {
    min.x = Math.min(min.x, b.min.x);
    min.y = Math.min(min.y, b.min.y);
    min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x);
    max.y = Math.max(max.y, b.max.y);
    max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

/** Overlap box of two AABBs, or null. Penetration depth = smallest extent of the overlap. */
export function intersectBoxes(a: Box, b: Box): { box: Box; depth: number; volume: number } | null {
  const min = { x: Math.max(a.min.x, b.min.x), y: Math.max(a.min.y, b.min.y), z: Math.max(a.min.z, b.min.z) };
  const max = { x: Math.min(a.max.x, b.max.x), y: Math.min(a.max.y, b.max.y), z: Math.min(a.max.z, b.max.z) };
  const dx = max.x - min.x;
  const dy = max.y - min.y;
  const dz = max.z - min.z;
  if (dx <= 0 || dy <= 0 || dz <= 0) return null;
  return { box: { min, max }, depth: Math.min(dx, dy, dz), volume: dx * dy * dz };
}

/* ------------------------------------------------------------------ */
/* Rotations                                                           */
/* ------------------------------------------------------------------ */

type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

/** Rotation matrix for XYZ Euler angles in degrees (same order as three.js default). */
export function rotationMatrix(r: Vec3): Mat3 {
  const [a, b, c] = [r.x * DEG, r.y * DEG, r.z * DEG];
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rx * Ry * Rz  (three.js 'XYZ')
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ];
}

export const isAxisAligned = (r: Vec3) => [r.x, r.y, r.z].every((d) => Math.abs(((d % 90) + 90) % 90) < 1e-6);

/** Oriented box: centre, half extents and axes (columns of the rotation matrix). */
export interface Obb {
  c: Vec3;
  h: Vec3;
  axes: [Vec3, Vec3, Vec3];
}

export function obbFrom(center: Vec3, size: Vec3, rotation: Vec3): Obb {
  const m = rotationMatrix(rotation);
  return {
    c: center,
    h: scale(size, 0.5),
    axes: [v3(m[0], m[3], m[6]), v3(m[1], m[4], m[7]), v3(m[2], m[5], m[8])],
  };
}

/** World AABB of a rotated box. */
export function obbToAabb(o: Obb): Box {
  const e = v3();
  for (const k of ['x', 'y', 'z'] as const) {
    e[k] = Math.abs(o.axes[0][k]) * o.h.x + Math.abs(o.axes[1][k]) * o.h.y + Math.abs(o.axes[2][k]) * o.h.z;
  }
  return { min: sub(o.c, e), max: add(o.c, e) };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** Separating-axis test; returns the minimum penetration depth (> 0 when overlapping) or 0. */
export function obbPenetration(a: Obb, b: Obb): number {
  const t = sub(b.c, a.c);
  const axes: Vec3[] = [...a.axes, ...b.axes];
  for (const ua of a.axes) for (const ub of b.axes) {
    const c = cross(ua, ub);
    if (dot(c, c) > 1e-10) axes.push(scale(c, 1 / Math.sqrt(dot(c, c))));
  }
  let minPen = Infinity;
  const ha = [a.h.x, a.h.y, a.h.z];
  const hb = [b.h.x, b.h.y, b.h.z];
  for (const L of axes) {
    const ra = a.axes.reduce((s, u, i) => s + ha[i] * Math.abs(dot(u, L)), 0);
    const rb = b.axes.reduce((s, u, i) => s + hb[i] * Math.abs(dot(u, L)), 0);
    const pen = ra + rb - Math.abs(dot(t, L));
    if (pen <= 0) return 0;
    minPen = Math.min(minPen, pen);
  }
  return minPen;
}

/* ------------------------------------------------------------------ */
/* Broad phase: axis-aligned box tree (BVH)                            */
/* ------------------------------------------------------------------ */

interface BvhNode {
  box: Box;
  left?: BvhNode;
  right?: BvhNode;
  items?: number[];
}

export class BoxTree {
  private root: BvhNode | null;
  constructor(private boxes: Box[], private leafSize = 6) {
    const idx = boxes.map((_, i) => i);
    this.root = idx.length ? this.build(idx) : null;
  }

  private build(idx: number[]): BvhNode {
    const box = unionBox(idx.map((i) => this.boxes[i]));
    if (idx.length <= this.leafSize) return { box, items: idx };
    const s = boxSize(box);
    const axis: 'x' | 'y' | 'z' = s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z';
    const sorted = [...idx].sort((a, b) => this.boxes[a].min[axis] + this.boxes[a].max[axis] - (this.boxes[b].min[axis] + this.boxes[b].max[axis]));
    const mid = sorted.length >> 1;
    return { box, left: this.build(sorted.slice(0, mid)), right: this.build(sorted.slice(mid)) };
  }

  /** Indices whose box overlaps `q` by more than `eps` on every axis. */
  query(q: Box, eps = 0): number[] {
    const out: number[] = [];
    const visit = (n: BvhNode | undefined) => {
      if (!n || !overlaps(n.box, q, eps)) return;
      if (n.items) {
        for (const i of n.items) if (overlaps(this.boxes[i], q, eps)) out.push(i);
        return;
      }
      visit(n.left);
      visit(n.right);
    };
    visit(this.root ?? undefined);
    return out;
  }

  /** All overlapping pairs (i < j). */
  pairs(eps = 0): [number, number][] {
    const out: [number, number][] = [];
    this.boxes.forEach((b, i) => {
      for (const j of this.query(b, eps)) if (j > i) out.push([i, j]);
    });
    return out;
  }
}

function overlaps(a: Box, b: Box, eps: number): boolean {
  return a.min.x < b.max.x - eps && a.max.x > b.min.x + eps && a.min.y < b.max.y - eps && a.max.y > b.min.y + eps && a.min.z < b.max.z - eps && a.max.z > b.min.z + eps;
}
