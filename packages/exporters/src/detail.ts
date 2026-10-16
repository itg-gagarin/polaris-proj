/**
 * Detail drawings: one part on its own (three views, its corners with the parts around them, the
 * joints it makes) and one assembly at a time with balloons — the sheets a meeting walks through.
 * Pure data from the placed layout; the web Detail view renders it as SVG.
 */
import type { JointType, RevisionContent } from '@bom/domain';
import type { Layout, PlacedInstance } from '@bom/engine';
import { contact, worldSize } from '@bom/engine';
import { project, sheetInstances, type Projection, type ViewName } from './projection';

export interface Box2 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetailRect extends Box2 {
  partId: string;
  key: string;
  role: string | null;
  depth: number;
  /** The part the detail is about. */
  focus: boolean;
}

export interface CornerDetail {
  label: 'A' | 'B' | 'C' | 'D';
  /** Drawing window (mm, same coordinates as the face view). */
  window: Box2;
  corner: { x: number; y: number };
  rects: DetailRect[];
  /** Other parts that meet the focus part in this corner. */
  neighbours: string[];
}

export interface JointDetail {
  partId: string;
  type: JointType | null;
  /** Size of the shared face (mm). */
  face: { w: number; h: number };
  /** Which corner(s) of the face view it shows up in. */
  corners: CornerDetail['label'][];
}

export interface PartDetail {
  key: string;
  /** Drawn longer in the model than its cut size (front-frame corners), mm per end; views show the cut size. */
  stretched: number | null;
  /** The part alone in front, side and top view. */
  views: { view: ViewName; rect: Box2 }[];
  /** View that shows the part's largest face; corners are drawn in it. */
  faceView: ViewName;
  corners: CornerDetail[];
  joints: JointDetail[];
}

const AXIS: Record<ViewName, 'x' | 'y' | 'z'> = { front: 'z', back: 'z', side: 'x', top: 'y' };
const area = (b: Box2) => (b.x1 - b.x0) * (b.y1 - b.y0);
const clip = (r: Box2, w: Box2): Box2 | null => {
  const b = { x0: Math.max(r.x0, w.x0), y0: Math.max(r.y0, w.y0), x1: Math.min(r.x1, w.x1), y1: Math.min(r.y1, w.y1) };
  return b.x1 - b.x0 > 0.01 && b.y1 - b.y0 > 0.01 ? b : null;
};

/** Everything needed to draw one part's detail sheet, or null when the part is not placed. */
export function partDetail(layout: Layout, content: RevisionContent, partId: string): PartDetail | null {
  const all = sheetInstances(layout);
  const inst = all.find((i) => i.partId === partId);
  if (!inst) return null;
  // Views show the cut size from the BOM (not the drawn size when the model stretches the part).
  const part = content.parts.find((p) => p.id === partId)!;
  const cut = worldSize(part.dims, part.axisMap);
  const unrotated = !inst.rotation.x && !inst.rotation.y && !inst.rotation.z;
  const cutInst: PlacedInstance = unrotated ? { ...inst, max: { x: inst.min.x + cut.x, y: inst.min.y + cut.y, z: inst.min.z + cut.z }, size: cut } : inst;
  const views = (['front', 'side', 'top'] as ViewName[]).map((view) => {
    const r = project([cutInst], view).rects[0];
    return { view, rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 } };
  });
  const face = views.reduce((m, v) => (area(v.rect) > area(m.rect) ? v : m));
  // Corners are where the part sits in the model (drawn size), so neighbours line up.
  const placedFace = project([inst], face.view).rects[0];
  const ax = AXIS[face.view];
  // Parts near the focus part in depth (±40 mm): what you would see around its corners.
  const band = all.filter((i) => i.min[ax] <= inst.max[ax] + 40 && i.max[ax] >= inst.min[ax] - 40);
  const proj = project(band, face.view);
  const r = placedFace;
  const s = Math.min(160, Math.max(50, 0.4 * Math.min(r.x1 - r.x0, r.y1 - r.y0) + 30));
  const pts: [CornerDetail['label'], number, number][] = [
    ['A', r.x0, r.y1],
    ['B', r.x1, r.y1],
    ['C', r.x1, r.y0],
    ['D', r.x0, r.y0],
  ];
  const corners: CornerDetail[] = pts.map(([label, x, y]) => {
    const window = { x0: x - s / 2, y0: y - s / 2, x1: x + s / 2, y1: y + s / 2 };
    const rects: DetailRect[] = [];
    for (const pr of proj.rects) {
      const c = clip(pr, window);
      if (c) rects.push({ ...c, partId: pr.partId, key: pr.key, role: pr.role, depth: pr.depth, focus: pr.key === inst.key });
    }
    const neighbours = [...new Set(rects.filter((x) => x.partId !== partId).map((x) => x.partId))];
    return { label, window, corner: { x, y }, rects, neighbours };
  });
  // Joints: parts whose boxes touch the focus instance.
  const joints = new Map<string, JointDetail>();
  for (const other of all) {
    if (other.key === inst.key || other.partId === partId) continue;
    const c = contact(inst, other);
    if (!c) continue;
    const ext = (k: 'x' | 'y' | 'z') => Math.min(inst.max[k], other.max[k]) - Math.max(inst.min[k], other.min[k]);
    const [u, v] = (['x', 'y', 'z'] as const).filter((k) => k !== c.axis);
    const j = content.joints.find((jj) => (jj.partA === partId && jj.partB === other.partId) || (jj.partB === partId && jj.partA === other.partId));
    const prev = joints.get(other.partId);
    const faceSize = { w: Math.round(ext(u) * 10) / 10, h: Math.round(ext(v) * 10) / 10 };
    if (!prev || faceSize.w * faceSize.h > prev.face.w * prev.face.h) joints.set(other.partId, { partId: other.partId, type: j?.type ?? null, face: faceSize, corners: corners.filter((cd) => cd.neighbours.includes(other.partId)).map((cd) => cd.label) });
  }
  return { key: inst.key, stretched: inst.stretched ?? null, views, faceView: face.view, corners, joints: [...joints.values()].sort((a, b) => b.face.w * b.face.h - a.face.w * a.face.h) };
}

export interface AssemblyItem {
  no: number;
  partId: string;
  /** Pieces in one assembly (BOM qty ÷ assembly qty). */
  qty: number;
}

export interface AssemblySheet {
  assemblyId: string | null;
  name: string;
  /** How many of this assembly the product has (drawn once). */
  count: number;
  views: Projection[];
  items: AssemblyItem[];
  /** Balloon per item: the view and the point it points at. */
  balloons: { no: number; view: ViewName; x: number; y: number }[];
}

/** One assembly (L1) drawn on its own, one copy, with numbered balloons for a meeting walk-through. */
export function assemblySheet(layout: Layout, content: RevisionContent, assemblyId: string | null): AssemblySheet | null {
  const asm = assemblyId ? content.assemblies.find((a) => a.id === assemblyId) : null;
  const inst: PlacedInstance[] = sheetInstances(layout).filter((i) => (assemblyId ? i.assemblyId === assemblyId : !i.assemblyId) && i.asmInstance === 0);
  if (!inst.length) return null;
  const count = asm?.qty ?? 1;
  const partsIn = content.parts.filter((p) => inst.some((i) => i.partId === p.id));
  const items = partsIn.map((p, n) => ({ no: n + 1, partId: p.id, qty: Math.max(1, Math.round(p.qty / count)) }));
  const views = (['front', 'side', 'top'] as ViewName[]).map((v) => project(inst, v));
  const balloons = items.map((it) => {
    // The view where the part shows biggest (front preferred on ties): balloon at its middle.
    let best: { view: ViewName; r: Box2; a: number } | null = null;
    for (const pv of views) {
      const rs = pv.rects.filter((r) => r.partId === it.partId);
      for (const r of rs) {
        const a = area(r) * (pv.view === 'front' ? 1.15 : 1);
        if (!best || a > best.a) best = { view: pv.view as ViewName, r, a };
      }
    }
    return { no: it.no, view: best!.view, x: (best!.r.x0 + best!.r.x1) / 2, y: (best!.r.y0 + best!.r.y1) / 2 };
  });
  return { assemblyId, name: asm?.name ?? 'Loose parts', count, views, items, balloons };
}
