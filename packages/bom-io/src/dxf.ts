/**
 * Minimal ASCII DXF reader for design drawings from AutoCAD (detail drawings attached to parts).
 *
 * Reads LINE, LWPOLYLINE (with bulges), POLYLINE/VERTEX, CIRCLE, ARC, ELLIPSE, SPLINE (control
 * polygon), TEXT, MTEXT, and expands INSERT / DIMENSION blocks with their scale and rotation.
 * Everything is converted to millimetres from $INSUNITS. Binary DXF and DWG are not supported
 * (AutoCAD: Save As → DXF). Hatches, images and 3D solids are skipped and counted.
 */
export type DxfPoint = { x: number; y: number };

export type DxfShape =
  | { kind: 'line'; a: DxfPoint; b: DxfPoint; layer: string }
  | { kind: 'poly'; pts: DxfPoint[]; closed: boolean; layer: string }
  | { kind: 'circle'; c: DxfPoint; r: number; layer: string }
  | { kind: 'arc'; c: DxfPoint; r: number; a0: number; a1: number; layer: string }
  | { kind: 'text'; at: DxfPoint; h: number; text: string; rot: number; layer: string };

export interface DxfDrawing {
  shapes: DxfShape[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Factor applied to get mm (1 when the file is in mm). */
  unitScale: number;
  units: string;
  layers: string[];
  skipped: Record<string, number>;
}

export class DxfError extends Error {}

const UNITS: Record<number, [string, number]> = { 0: ['unitless (read as mm)', 1], 1: ['inches', 25.4], 2: ['feet', 304.8], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000] };

type Pair = [number, string];
interface RawEntity {
  type: string;
  pairs: Pair[];
}
interface Xf {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const ID: Xf = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const apply = (t: Xf, p: DxfPoint): DxfPoint => ({ x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f });
const compose = (t: Xf, u: Xf): Xf => ({ a: t.a * u.a + t.c * u.b, b: t.b * u.a + t.d * u.b, c: t.a * u.c + t.c * u.d, d: t.b * u.c + t.d * u.d, e: t.a * u.e + t.c * u.f + t.e, f: t.b * u.e + t.d * u.f + t.f });
const scaleOf = (t: Xf) => Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
const rotOf = (t: Xf) => (Math.atan2(t.b, t.a) * 180) / Math.PI;

export function parseDxf(text: string): DxfDrawing {
  if (/^AutoCAD Binary DXF/.test(text)) throw new DxfError('This is a binary DXF. In AutoCAD use Save As → DXF (ASCII).');
  if (text.startsWith('AC10')) throw new DxfError('This is a DWG file. In AutoCAD use Save As → DXF.');
  const lines = text.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) throw new DxfError(`Not a DXF file (line ${i + 1})`);
    pairs.push([code, lines[i + 1].trim()]);
  }
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION')) throw new DxfError('Not a DXF file (no SECTION)');

  // Split into sections.
  let insunits = 4;
  let hasUnits = false;
  const blocks = new Map<string, { base: DxfPoint; ents: RawEntity[] }>();
  const entities: RawEntity[] = [];
  let i = 0;
  const readEntities = (stop: string[]): RawEntity[] => {
    const out: RawEntity[] = [];
    let cur: RawEntity | null = null;
    while (i < pairs.length) {
      const [c, v] = pairs[i];
      if (c === 0) {
        if (stop.includes(v)) break;
        cur = { type: v, pairs: [] };
        out.push(cur);
      } else cur?.pairs.push([c, v]);
      i++;
    }
    return out;
  };
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') {
      const name = pairs[i + 1]?.[1];
      i += 2;
      if (name === 'HEADER') {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
          if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS' && pairs[i + 1]) {
            insunits = Number(pairs[i + 1][1]);
            hasUnits = true;
          }
          i++;
        }
      } else if (name === 'BLOCKS') {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) {
          if (pairs[i][0] === 0 && pairs[i][1] === 'BLOCK') {
            i++;
            let bname = '';
            const base = { x: 0, y: 0 };
            while (i < pairs.length && pairs[i][0] !== 0) {
              if (pairs[i][0] === 2) bname = pairs[i][1];
              if (pairs[i][0] === 10) base.x = Number(pairs[i][1]);
              if (pairs[i][0] === 20) base.y = Number(pairs[i][1]);
              i++;
            }
            const ents = readEntities(['ENDBLK']);
            blocks.set(bname, { base, ents });
            i++; // ENDBLK
            while (i < pairs.length && pairs[i][0] !== 0) i++;
          } else i++;
        }
      } else if (name === 'ENTITIES') {
        entities.push(...readEntities(['ENDSEC']));
      } else {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === 'ENDSEC')) i++;
      }
    }
    i++;
  }

  const [units, unitScale] = UNITS[insunits] ?? [`code ${insunits} (read as mm)`, 1];
  const shapes: DxfShape[] = [];
  const skipped: Record<string, number> = {};
  const top: Xf = { ...ID, a: unitScale, d: unitScale };

  const emit = (ents: RawEntity[], t: Xf, depth: number) => {
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      const g = (code: number, d = 0) => {
        const p = e.pairs.find(([c]) => c === code);
        return p ? Number(p[1]) : d;
      };
      const s = (code: number) => e.pairs.find(([c]) => c === code)?.[1] ?? '';
      const layer = s(8) || '0';
      const pt = (cx: number, cy: number) => apply(t, { x: g(cx), y: g(cy) });
      switch (e.type) {
        case 'LINE':
          shapes.push({ kind: 'line', a: pt(10, 20), b: pt(11, 21), layer });
          break;
        case 'LWPOLYLINE': {
          const verts: { p: DxfPoint; bulge: number }[] = [];
          for (const [c, v] of e.pairs) {
            if (c === 10) verts.push({ p: { x: Number(v), y: 0 }, bulge: 0 });
            else if (c === 20 && verts.length) verts[verts.length - 1].p.y = Number(v);
            else if (c === 42 && verts.length) verts[verts.length - 1].bulge = Number(v);
          }
          const closed = (g(70) & 1) === 1;
          shapes.push({ kind: 'poly', pts: bulgePath(verts, closed).map((p) => apply(t, p)), closed, layer });
          break;
        }
        case 'POLYLINE': {
          const verts: { p: DxfPoint; bulge: number }[] = [];
          const closed = (g(70) & 1) === 1;
          while (ents[k + 1]?.type === 'VERTEX') {
            k++;
            const v = ents[k];
            const gv = (code: number) => Number(v.pairs.find(([c]) => c === code)?.[1] ?? 0);
            verts.push({ p: { x: gv(10), y: gv(20) }, bulge: gv(42) });
          }
          if (ents[k + 1]?.type === 'SEQEND') k++;
          shapes.push({ kind: 'poly', pts: bulgePath(verts, closed).map((p) => apply(t, p)), closed, layer });
          break;
        }
        case 'CIRCLE': {
          const c = pt(10, 20);
          const r = g(40) * scaleOf(t);
          shapes.push({ kind: 'circle', c, r, layer });
          break;
        }
        case 'ARC': {
          const c = pt(10, 20);
          const r = g(40) * scaleOf(t);
          const rot = rotOf(t);
          const mirrored = t.a * t.d - t.b * t.c < 0;
          const a0 = g(50) + rot;
          const a1 = g(51) + rot;
          shapes.push(mirrored ? { kind: 'arc', c, r, a0: 180 - a1, a1: 180 - a0, layer } : { kind: 'arc', c, r, a0, a1, layer });
          break;
        }
        case 'ELLIPSE': {
          const cx = g(10);
          const cy = g(20);
          const mx = g(11);
          const my = g(21);
          const ratio = g(40, 1);
          const p0 = g(41, 0);
          let p1 = g(42, Math.PI * 2);
          if (p1 <= p0) p1 += Math.PI * 2;
          const n = 48;
          const pts: DxfPoint[] = [];
          for (let j = 0; j <= n; j++) {
            const a = p0 + ((p1 - p0) * j) / n;
            pts.push(apply(t, { x: cx + mx * Math.cos(a) - my * ratio * Math.sin(a), y: cy + my * Math.cos(a) + mx * ratio * Math.sin(a) }));
          }
          shapes.push({ kind: 'poly', pts, closed: false, layer });
          break;
        }
        case 'SPLINE': {
          const pts: DxfPoint[] = [];
          for (const [c, v] of e.pairs) {
            if (c === 10) pts.push({ x: Number(v), y: 0 });
            else if (c === 20 && pts.length) pts[pts.length - 1].y = Number(v);
          }
          if (pts.length > 1) shapes.push({ kind: 'poly', pts: pts.map((p) => apply(t, p)), closed: false, layer });
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const raw = e.pairs.filter(([c]) => c === 3).map(([, v]) => v).join('') + s(1);
          const text = raw.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
          if (text) shapes.push({ kind: 'text', at: pt(10, 20), h: g(40, 2.5) * scaleOf(t), text, rot: g(50) + rotOf(t), layer });
          break;
        }
        case 'INSERT':
        case 'DIMENSION': {
          const blk = blocks.get(s(2));
          if (!blk || depth > 8) {
            skipped[e.type] = (skipped[e.type] ?? 0) + 1;
            break;
          }
          if (e.type === 'DIMENSION') {
            emit(blk.ents, t, depth + 1);
            break;
          }
          const sx = g(41, 1);
          const sy = g(42, 1);
          const r = (g(50) * Math.PI) / 180;
          const cos = Math.cos(r);
          const sin = Math.sin(r);
          // insert = translate(ins) · rotate · scale · translate(-base)
          const local: Xf = { a: cos * sx, b: sin * sx, c: -sin * sy, d: cos * sy, e: 0, f: 0 };
          const moved: Xf = { ...local, e: g(10) - (local.a * blk.base.x + local.c * blk.base.y), f: g(20) - (local.b * blk.base.x + local.d * blk.base.y) };
          emit(blk.ents, compose(t, moved), depth + 1);
          break;
        }
        default:
          skipped[e.type] = (skipped[e.type] ?? 0) + 1;
      }
    }
  };
  emit(entities, top, 0);
  if (!shapes.length) throw new DxfError('The DXF has no lines, arcs, circles or text to draw');
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sh of shapes) {
    if (sh.kind === 'line') xs.push(sh.a.x, sh.b.x), ys.push(sh.a.y, sh.b.y);
    else if (sh.kind === 'poly') sh.pts.forEach((p) => (xs.push(p.x), ys.push(p.y)));
    else if (sh.kind === 'circle' || sh.kind === 'arc') xs.push(sh.c.x - sh.r, sh.c.x + sh.r), ys.push(sh.c.y - sh.r, sh.c.y + sh.r);
    else xs.push(sh.at.x), ys.push(sh.at.y, sh.at.y + sh.h);
  }
  return {
    shapes,
    bounds: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    unitScale,
    units: hasUnits ? units : 'mm (no $INSUNITS in the file)',
    layers: [...new Set(shapes.map((sh) => sh.layer))],
    skipped,
  };
}

/** Polyline vertices with bulges → points (each bulge segment becomes an arc of ≤ 10° steps). */
function bulgePath(verts: { p: DxfPoint; bulge: number }[], closed: boolean): DxfPoint[] {
  const out: DxfPoint[] = [];
  const n = verts.length;
  for (let k = 0; k < n; k++) {
    const a = verts[k];
    out.push(a.p);
    const b = verts[(k + 1) % n];
    if (k === n - 1 && !closed) break;
    if (!a.bulge) continue;
    // Bulge b = tan(θ/4); θ > 0 turns counter-clockwise. Centre sits on the chord's left normal.
    const bl = a.bulge;
    const theta = 4 * Math.atan(bl);
    const dx = b.p.x - a.p.x;
    const dy = b.p.y - a.p.y;
    const chord = Math.hypot(dx, dy);
    if (!chord) continue;
    const r = (chord * (1 + bl * bl)) / (4 * Math.abs(bl));
    const off = ((chord / 2) * (1 - bl * bl)) / (2 * bl);
    const c = { x: (a.p.x + b.p.x) / 2 - (dy / chord) * off, y: (a.p.y + b.p.y) / 2 + (dx / chord) * off };
    const start = Math.atan2(a.p.y - c.y, a.p.x - c.x);
    const steps = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 18)));
    for (let j = 1; j < steps; j++) {
      const ang = start + (theta * j) / steps;
      out.push({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });
    }
  }
  return out;
}
