/**
 * STEP AP214 export of the placed parts as B-rep solids (one closed box shell per instance, planar faces).
 * Phase-6 spike result: box parts need no CAD kernel; profiles (tapered legs, turned knobs) will
 * need an OpenCascade-based writer. Verified by re-importing with OpenCascade (occt-import-js).
 */
import type { RevisionContent, Vec3 } from '@bom/domain';
import type { Layout } from '@bom/engine';
import { obbFrom } from '@bom/engine';

const f = (n: number) => {
  const s = n.toFixed(4).replace(/0+$/, '');
  return s.endsWith('.') ? s : s.includes('.') ? s : `${s}.`;
};
const esc = (s: string) => s.replace(/'/g, "''").replace(/[^\x20-\x7E]/g, '?');

export function stepExport(content: RevisionContent, layout: Layout, info: { name: string; code: string }): string {
  const parts = new Map(content.parts.map((p) => [p.id, p]));
  const lines: string[] = [];
  let id = 0;
  const add = (s: string) => {
    id++;
    lines.push(`#${id}=${s};`);
    return id;
  };
  const appCtx = add(`APPLICATION_CONTEXT('core data for automotive mechanical design processes')`);
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  const prodCtx = add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const product = add(`PRODUCT('${esc(info.code)}','${esc(info.name)}','',(#${prodCtx}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const pdc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',#${pdf},#${pdc})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
  const lu = add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const au = add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const su = add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),#${lu},'distance_accuracy_value','')`);
  const geoCtx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lu},#${au},#${su}))REPRESENTATION_CONTEXT('',''))`);
  const origin = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const dz = add(`DIRECTION('',(0.,0.,1.))`);
  const dx = add(`DIRECTION('',(1.,0.,0.))`);
  const placement = add(`AXIS2_PLACEMENT_3D('',#${origin},#${dz},#${dx})`);

  const solids: number[] = [];
  const inst = layout.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && !i.packing);
  for (const i of inst) {
    const p = parts.get(i.partId);
    if (!p) continue;
    const c = { x: (i.min.x + i.max.x) / 2, y: (i.min.y + i.max.y) / 2, z: (i.min.z + i.max.z) / 2 };
    const o = obbFrom(c, i.size, i.rotation);
    const corners: Vec3[] = [];
    for (let k = 0; k < 8; k++) {
      const sx = k & 1 ? 1 : -1;
      const sy = k & 2 ? 1 : -1;
      const sz = k & 4 ? 1 : -1;
      corners.push({
        x: o.c.x + sx * o.h.x * o.axes[0].x + sy * o.h.y * o.axes[1].x + sz * o.h.z * o.axes[2].x,
        y: o.c.y + sx * o.h.x * o.axes[0].y + sy * o.h.y * o.axes[1].y + sz * o.h.z * o.axes[2].y,
        z: o.c.z + sx * o.h.x * o.axes[0].z + sy * o.h.y * o.axes[1].z + sz * o.h.z * o.axes[2].z,
      });
    }
    const pts = corners.map((v) => add(`CARTESIAN_POINT('',(${f(v.x)},${f(v.y)},${f(v.z)}))`));
    const verts = pts.map((pt) => add(`VERTEX_POINT('',#${pt})`));
    // Faces with outward normals (corner index bits: x=1, y=2, z=4), counter-clockwise seen from outside.
    const quads: [number[], Vec3][] = [
      [[0, 4, 6, 2], o.axes[0]], // -x
      [[1, 3, 7, 5], o.axes[0]], // +x
      [[0, 1, 5, 4], o.axes[1]], // -y
      [[2, 6, 7, 3], o.axes[1]], // +y
      [[0, 2, 3, 1], o.axes[2]], // -z
      [[4, 5, 7, 6], o.axes[2]], // +z
    ];
    const edges = new Map<string, number>();
    const edgeOf = (a: number, b: number): { id: number; same: boolean } => {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const k = `${lo}-${hi}`;
      let e = edges.get(k);
      if (!e) {
        const pa = corners[lo];
        const pb = corners[hi];
        const len = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z) || 1;
        const dir = add(`DIRECTION('',(${f((pb.x - pa.x) / len)},${f((pb.y - pa.y) / len)},${f((pb.z - pa.z) / len)}))`);
        const vec = add(`VECTOR('',#${dir},${f(len)})`);
        const ln = add(`LINE('',#${pts[lo]},#${vec})`);
        e = add(`EDGE_CURVE('',#${verts[lo]},#${verts[hi]},#${ln},.T.)`);
        edges.set(k, e);
      }
      return { id: e, same: a < b };
    };
    const faces = quads.map(([q, axis], fi) => {
      const sign = fi % 2 === 0 ? -1 : 1;
      const oes = q.map((a, k) => {
        const e = edgeOf(a, q[(k + 1) % 4]);
        return add(`ORIENTED_EDGE('',*,*,#${e.id},${e.same ? '.T.' : '.F.'})`);
      });
      const loop = add(`EDGE_LOOP('',(${oes.map((x) => `#${x}`).join(',')}))`);
      const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      const n = add(`DIRECTION('',(${f(sign * axis.x)},${f(sign * axis.y)},${f(sign * axis.z)}))`);
      const a0 = corners[q[0]];
      const a1 = corners[q[1]];
      const l = Math.hypot(a1.x - a0.x, a1.y - a0.y, a1.z - a0.z) || 1;
      const ref = add(`DIRECTION('',(${f((a1.x - a0.x) / l)},${f((a1.y - a0.y) / l)},${f((a1.z - a0.z) / l)}))`);
      const ax = add(`AXIS2_PLACEMENT_3D('',#${pts[q[0]]},#${n},#${ref})`);
      const plane = add(`PLANE('',#${ax})`);
      return add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`);
    });
    const shell = add(`CLOSED_SHELL('',(${faces.map((x) => `#${x}`).join(',')}))`);
    solids.push(add(`MANIFOLD_SOLID_BREP('${esc(`${p.originalName} #${i.index + 1}`)}',#${shell})`));
  }
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION('${esc(info.name)}',(#${placement}${solids.map((s) => `,#${s}`).join('')}),#${geoCtx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${rep})`);
  const now = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('Furniture BOM Studio export'),'2;1');",
    `FILE_NAME('${esc(info.code)}.stp','${now}',('Furniture BOM Studio'),(''),'','Furniture BOM Studio','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
