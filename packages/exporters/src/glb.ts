/** GLB (binary glTF 2.0) export of the placed model: one shared unit cube, one node per part instance. */
import type { RevisionContent, Vec3 } from '@bom/domain';
import type { Layout } from '@bom/engine';
import { materialColor, hexToRgb } from './colors';

function quatFromEuler(r: Vec3): [number, number, number, number] {
  const d = Math.PI / 360; // half-angle in radians per degree
  const [cx, sx] = [Math.cos(r.x * d), Math.sin(r.x * d)];
  const [cy, sy] = [Math.cos(r.y * d), Math.sin(r.y * d)];
  const [cz, sz] = [Math.cos(r.z * d), Math.sin(r.z * d)];
  // XYZ order (matches three.js / geometry.ts)
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}

function cube(): { pos: Float32Array; nrm: Float32Array; idx: Uint16Array } {
  const faces: [number[], number[][]][] = [
    [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  faces.forEach(([n, vs], f) => {
    for (const v of vs) {
      pos.push(...v);
      nrm.push(...n);
    }
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx: new Uint16Array(idx) };
}

const pad4 = (n: number) => (n + 3) & ~3;

export function glbExport(content: RevisionContent, layout: Layout, opts: { name?: string; includePacking?: boolean } = {}): Uint8Array {
  const parts = new Map(content.parts.map((p) => [p.id, p]));
  const inst = layout.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && (opts.includePacking || !i.packing));
  const { pos, nrm, idx } = cube();
  const bin = new Uint8Array(pad4(pos.byteLength) + pad4(nrm.byteLength) + pad4(idx.byteLength));
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(nrm.buffer), pad4(pos.byteLength));
  bin.set(new Uint8Array(idx.buffer), pad4(pos.byteLength) + pad4(nrm.byteLength));

  const colorIndex = new Map<string, number>();
  const materials: unknown[] = [];
  const meshes: unknown[] = [];
  const nodes: unknown[] = [];
  for (const i of inst) {
    const p = parts.get(i.partId);
    if (!p) continue;
    const hex = materialColor(p);
    let m = colorIndex.get(hex);
    if (m === undefined) {
      m = materials.length;
      colorIndex.set(hex, m);
      materials.push({ name: hex, pbrMetallicRoughness: { baseColorFactor: [...hexToRgb(hex), 1], metallicFactor: p.kind === 'hardware' ? 0.6 : 0, roughnessFactor: 0.7 } });
      meshes.push({ name: `box-${hex}`, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: m }] });
    }
    // glTF is metres, Y up — same axes as the engine; centre + scale of the unit cube.
    const c = { x: (i.min.x + i.max.x) / 2000, y: (i.min.y + i.max.y) / 2000, z: (i.min.z + i.max.z) / 2000 };
    nodes.push({
      name: `${p.originalName} #${i.index + 1}`,
      mesh: m,
      translation: [c.x, c.y, c.z],
      scale: [i.size.x / 1000, i.size.y / 1000, i.size.z / 1000],
      ...(i.rotation.x || i.rotation.y || i.rotation.z ? { rotation: quatFromEuler(i.rotation) } : {}),
      extras: { partId: p.id, stdCode: p.stdCode, role: p.role, instance: i.index },
    });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'Furniture BOM Studio' },
    scene: 0,
    scenes: [{ name: opts.name ?? 'product', nodes: nodes.map((_, k) => k) }],
    nodes,
    meshes,
    materials,
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pad4(pos.byteLength), byteLength: nrm.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pad4(pos.byteLength) + pad4(nrm.byteLength), byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadded = new Uint8Array(pad4(json.byteLength)).fill(0x20);
  jsonPadded.set(json);
  json = jsonPadded;
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(json, 20);
  dv.setUint32(20 + json.byteLength, bin.byteLength, true);
  dv.setUint32(24 + json.byteLength, 0x004e4942, true); // "BIN\0"
  out.set(bin, 28 + json.byteLength);
  return out;
}
