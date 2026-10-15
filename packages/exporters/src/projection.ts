/**
 * Orthographic projections of the placed model for 2D sheets (front, side, top, section).
 * Pure data — rendered by the web sheet frame (SVG), the PDF writer and the DXF writer alike.
 */
import type { Layout, PlacedInstance } from '@bom/engine';

export type ViewName = 'front' | 'side' | 'top' | 'back';

export interface ProjRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  partId: string;
  key: string;
  role: string | null;
  /** Distance from the viewer (smaller = nearer); used to draw near parts last. */
  depth: number;
  /** Cut by the section plane. */
  cut?: boolean;
}

export interface Projection {
  view: ViewName | `section-${'x' | 'y' | 'z'}`;
  rects: ProjRect[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

export function sheetInstances(layout: Layout, opts: { hardware?: boolean; packing?: boolean } = {}): PlacedInstance[] {
  return layout.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && (opts.packing || !i.packing) && (opts.hardware ?? true ? true : i.kind !== 'hardware'));
}

/** Drawing coordinates: x to the right, y up (mm). */
export function project(instances: PlacedInstance[], view: ViewName, explode = 0): Projection {
  const rects: ProjRect[] = instances.map((i) => {
    const min = { x: i.min.x + i.explode.x * explode, y: i.min.y + i.explode.y * explode, z: i.min.z + i.explode.z * explode };
    const max = { x: i.max.x + i.explode.x * explode, y: i.max.y + i.explode.y * explode, z: i.max.z + i.explode.z * explode };
    const base = { partId: i.partId, key: i.key, role: i.role };
    switch (view) {
      case 'front':
        return { ...base, x0: min.x, x1: max.x, y0: min.y, y1: max.y, depth: -max.z };
      case 'back':
        return { ...base, x0: -max.x, x1: -min.x, y0: min.y, y1: max.y, depth: min.z };
      case 'side': // seen from the right: depth axis runs left (back) → right (front)
        return { ...base, x0: min.z, x1: max.z, y0: min.y, y1: max.y, depth: -max.x };
      case 'top': // seen from above, front at the bottom of the sheet
        return { ...base, x0: min.x, x1: max.x, y0: -max.z, y1: -min.z, depth: -max.y };
    }
  });
  rects.sort((a, b) => b.depth - a.depth);
  return { view, rects, bounds: boundsOf(rects) };
}

/** Section through a plane (e.g. SECTION X 300): parts cut by the plane, seen along the axis. */
export function section(instances: PlacedInstance[], axis: 'x' | 'y' | 'z', at: number): Projection {
  const cut = instances.filter((i) => i.min[axis] < at && i.max[axis] > at);
  const rects: ProjRect[] = cut.map((i) => {
    const base = { partId: i.partId, key: i.key, role: i.role, depth: 0, cut: true };
    if (axis === 'x') return { ...base, x0: i.min.z, x1: i.max.z, y0: i.min.y, y1: i.max.y };
    if (axis === 'z') return { ...base, x0: i.min.x, x1: i.max.x, y0: i.min.y, y1: i.max.y };
    return { ...base, x0: i.min.x, x1: i.max.x, y0: -i.max.z, y1: -i.min.z };
  });
  return { view: `section-${axis}`, rects, bounds: boundsOf(rects) };
}

function boundsOf(rects: ProjRect[]) {
  if (!rects.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    y1: Math.max(...rects.map((r) => r.y1)),
  };
}

/** Pick a standard drawing scale (1:1, 1:2, 1:5, 1:10, 1:20…) that fits the view in the given box (mm on paper). */
export function fitScale(b: Projection['bounds'], boxW: number, boxH: number): number {
  const need = Math.max((b.x1 - b.x0) / boxW, (b.y1 - b.y0) / boxH);
  const std = [1, 2, 2.5, 5, 10, 15, 20, 25, 50, 100];
  return std.find((s) => s >= need) ?? Math.ceil(need);
}
