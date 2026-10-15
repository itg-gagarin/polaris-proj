'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { FrameItem, Part, RevisionContent } from '@bom/domain';
import { makePatch, TEAMS } from '@bom/domain';
import type { Analysis, PlacedInstance } from '@bom/engine';
import { dimOnAxis } from '@bom/engine';
import { materialColor } from '@bom/exporters/colors';
import { useUi, type FrameView, type ViewName } from '@/lib/store';
import { projectors, pickers, cameraSetters } from '@/lib/registry';
import type { RevisionLive } from '@/lib/live';
import { useEditor } from '@/lib/editor';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const DEG = Math.PI / 180;

function stripeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fca5a5';
  g.fillRect(0, 0, 32, 32);
  g.strokeStyle = '#dc2626';
  g.lineWidth = 6;
  for (let i = -32; i < 64; i += 12) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 32);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function hashColor(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 55%)`;
}

interface Style {
  color: string;
  opacity: number;
  stripes?: boolean;
  hidden?: boolean;
}

/** Colour per instance for the frame's shading + team lens (PRD §5 viewport modes). */
function styleFor(i: PlacedInstance, part: Part | undefined, view: FrameView, failing: Set<string>, clashing: Set<string>, aiChanged: Set<string>): Style {
  const visible = part?.visible ?? true;
  if (i.packing && view.lens !== 'packing') return { color: '#000', opacity: 0, hidden: true };
  if (!part) return { color: '#999', opacity: 1 };
  if (aiChanged.has(part.id)) return { color: '#10b981', opacity: 0.95 };
  const base = view.shading === 'solid' ? (part.kind === 'hardware' ? '#7b8494' : '#cfd3d8') : materialColor(part);
  switch (view.lens) {
    case 'painting':
      if (part.kind === 'hardware') return { color: '#9ca3af', opacity: 0.25 };
      if (!part.finishCode) return visible ? { color: '#fca5a5', opacity: 1, stripes: true } : { color: '#d1d5db', opacity: 0.35 };
      return { color: hashColor(part.finishCode), opacity: 1 };
    case 'hardware':
      return part.kind === 'hardware' ? { color: TEAMS.hardware.color, opacity: 1 } : { color: '#c7cdd4', opacity: 0.12 };
    case 'engineering':
      if (clashing.has(part.id)) return { color: '#ef4444', opacity: 1 };
      return { color: TEAMS[part.teamOwner]?.color ?? '#9ca3af', opacity: 0.55 };
    case 'packing':
      return i.packing ? { color: '#b45309', opacity: 1 } : { color: '#c7cdd4', opacity: 0.18 };
    default:
      return { color: failing.has(part.id) ? base : base, opacity: view.shading === 'xray' ? 0.22 : 1 };
  }
}

interface DimDef {
  id: string;
  a: { key: string; offset: [number, number, number] };
  b: { key: string; offset: [number, number, number] };
}

interface Props {
  frame: FrameItem;
  rev: RevisionLive;
  content: RevisionContent;
  analysis: Analysis;
  view: FrameView;
  readOnly: boolean;
  revisionId: string;
}

export function Viewport3D(p: Props) {
  const bg = typeof window !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? '#1b2027' : '#f3f4f6';
  return (
    <Canvas
      camera={{ fov: 32, near: 5, far: 60000, position: [2500, 1800, 3000] }}
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, localClippingEnabled: true }}
      onCreated={({ gl }) => (gl.localClippingEnabled = true)}
      style={{ position: 'absolute', inset: 0 }}
      data-testid={`viewport-${p.frame.id}`}
    >
      <color attach="background" args={[bg]} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2000, 3000, 2500]} intensity={1.1} />
      <directionalLight position={[-2000, 1000, -1500]} intensity={0.35} />
      <Scene {...p} />
    </Canvas>
  );
}

function Scene({ frame, rev, content, analysis, view, readOnly, revisionId }: Props) {
  const { camera, invalidate, size, raycaster, scene } = useThree();
  const controls = useRef<any>(null);
  const ui = useUi();
  const { live } = useEditor();
  const parts = useMemo(() => new Map(content.parts.map((x) => [x.id, x])), [content]);
  const selected = new Set(ui.selection.revisionId === revisionId ? ui.selection.partIds : []);
  const hidden = new Set(ui.hidden[revisionId] ?? []);
  const isolated = ui.isolated[revisionId] ? new Set(ui.isolated[revisionId]!) : null;
  const layerOff = (pt: Part | undefined) => {
    if (!pt) return false;
    const key = ui.layerMode === 'team' ? `team:${pt.teamOwner}` : ui.layerMode === 'material' ? `mat:${pt.material ?? pt.kind}` : `l1:${pt.l1 ?? '—'}`;
    return !!ui.layerHidden[key];
  };
  const failing = useMemo(() => new Set(analysis.findings.filter((f) => f.severity === 'fail' && !f.waived).flatMap((f) => f.partIds)), [analysis]);
  const clashing = useMemo(() => new Set(analysis.clashes.flatMap((c) => [c.partA, c.partB])), [analysis]);
  const aiChanges = ui.ai.suggestion?.revisionId === revisionId ? ui.ai.suggestion.changes.filter((c) => ui.ai.accepted.includes(c.id)) : [];
  const aiChanged = useMemo(() => new Set(aiChanges.flatMap((c) => c.patch.ops.map((o) => ('partId' in o ? o.partId : '')))), [aiChanges]);
  const [hover, setHover] = useState<{ key: string; point: THREE.Vector3 } | null>(null);

  const center = useMemo(() => {
    const b = analysis.layout.bounds;
    return new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  }, [analysis.layout.bounds]);
  const radius = useMemo(() => {
    const b = analysis.layout.bounds;
    return Math.max(400, Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2);
  }, [analysis.layout.bounds]);

  const shown = useMemo(
    () =>
      analysis.layout.instances.filter((i) => {
        if (i.source === 'tray') return false;
        if (hidden.has(i.partId)) return false;
        if (isolated && !isolated.has(i.partId)) return false;
        if (layerOff(parts.get(i.partId))) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysis, ui.hidden, ui.isolated, ui.layerHidden, ui.layerMode, revisionId, parts],
  );

  // Instance transforms (explode applied).
  const placed = useMemo(
    () =>
      shown.map((i) => {
        const e = view.explode;
        const c = new THREE.Vector3((i.min.x + i.max.x) / 2 + i.explode.x * e, (i.min.y + i.max.y) / 2 + i.explode.y * e, (i.min.z + i.max.z) / 2 + i.explode.z * e);
        return { i, center: c, part: parts.get(i.partId), style: styleFor(i, parts.get(i.partId), view, failing, clashing, aiChanged) };
      }),
    [shown, view, parts, failing, clashing, aiChanged],
  );

  // Group by (colour, opacity, stripes) → one InstancedMesh each: 1,000 parts stay at a handful of draw calls.
  const groups = useMemo(() => {
    const m = new Map<string, typeof placed>();
    for (const x of placed) {
      if (x.style.hidden) continue;
      const k = `${x.style.color}|${x.style.opacity}|${x.style.stripes ? 1 : 0}`;
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return [...m.entries()];
  }, [placed]);

  const clip = useMemo(() => {
    if (!view.section) return [];
    const n = new THREE.Vector3(view.section.axis === 'x' ? -1 : 0, view.section.axis === 'y' ? -1 : 0, view.section.axis === 'z' ? -1 : 0);
    return [new THREE.Plane(n, view.section.at)];
  }, [view.section]);

  // Camera: views and frame selection.
  const fit = (v: ViewName, targetCenter = center, r = radius) => {
    const dir = { iso: [1, 0.75, 1.25], front: [0, 0, 1], back: [0, 0, -1], side: [1, 0, 0], top: [0, 1, 0.0001] }[v];
    const d = (r / Math.sin((32 * DEG) / 2)) * 1.05;
    const n = new THREE.Vector3(...(dir as [number, number, number])).normalize();
    camera.position.copy(targetCenter.clone().add(n.multiplyScalar(d)));
    camera.lookAt(targetCenter);
    if (controls.current) {
      controls.current.target.copy(targetCenter);
      controls.current.update();
    }
    invalidate();
  };
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current) {
      fit(view.view);
      fitted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, radius]);
  useEffect(() => {
    if (!view.frameNonce) return;
    const sel = placed.filter((x) => selected.has(x.i.partId));
    if (sel.length && ui.activeFrameId === frame.id) {
      const box = new THREE.Box3();
      for (const x of sel) box.expandByPoint(new THREE.Vector3(x.i.min.x, x.i.min.y, x.i.min.z)).expandByPoint(new THREE.Vector3(x.i.max.x, x.i.max.y, x.i.max.z));
      const c = box.getCenter(new THREE.Vector3());
      fit(view.view, c, Math.max(150, box.getSize(new THREE.Vector3()).length() / 2));
    } else fit(view.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.frameNonce, view.view]);

  useEffect(() => invalidate(), [placed, ui.selection, view, invalidate, hover]);

  // Register projector / picker / camera setter for markup pins, follow mode and meetings.
  useEffect(() => {
    const centers = new Map<string, THREE.Vector3>();
    for (const x of placed) if (!centers.has(x.i.partId)) centers.set(x.i.partId, x.center);
    projectors.set(frame.id, (partId) => {
      const c = centers.get(partId);
      if (!c) return null;
      const v = c.clone().project(camera);
      if (v.z > 1) return null;
      const zoom = useUi.getState().board.zoom;
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      return { x: frame.rect.x + sx / zoom, y: frame.rect.y + 28 + sy / zoom };
    });
    pickers.set(frame.id, (bp) => {
      const zoom = useUi.getState().board.zoom;
      const sx = (bp.x - frame.rect.x) * zoom;
      const sy = (bp.y - frame.rect.y - 28) * zoom;
      if (sx < 0 || sy < 0 || sx > size.width || sy > size.height) return null;
      raycaster.setFromCamera(new THREE.Vector2((sx / size.width) * 2 - 1, -(sy / size.height) * 2 + 1), camera);
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        const keys = (hit.object.userData as { keys?: string[] }).keys;
        if (keys && hit.instanceId !== undefined) return { partId: keys[hit.instanceId].split('#')[0], revisionId };
      }
      return null;
    });
    cameraSetters.set(frame.id, (cam) => {
      camera.position.set(...cam.position);
      controls.current?.target.set(...cam.target);
      controls.current?.update();
      invalidate();
    });
    return () => {
      projectors.delete(frame.id);
      pickers.delete(frame.id);
      cameraSetters.delete(frame.id);
    };
  }, [placed, camera, size, frame.id, frame.rect, raycaster, scene, revisionId, invalidate]);

  const onCameraChange = () => {
    invalidate();
    const t = controls.current?.target as THREE.Vector3 | undefined;
    if (t && ui.activeFrameId === frame.id) {
      const cam = { position: camera.position.toArray() as [number, number, number], target: t.toArray() as [number, number, number] };
      live.presence({ view: { frameId: frame.id, camera: cam, board: useUi.getState().board } });
    }
    useUi.setState((s) => ({ projectionTick: s.projectionTick + 1 }));
  };

  const keyOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const keys = (e.object.userData as { keys?: string[] }).keys;
    return keys && e.instanceId !== undefined ? keys[e.instanceId] : null;
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const key = keyOf(e);
    if (!key) return;
    const inst = analysis.layout.instances.find((i) => i.key === key);
    if (!inst) return;
    const tool = useUi.getState().tool;
    if (tool === 'measure') {
      const m = useUi.getState().measure;
      const pt = { partId: inst.partId, point: e.point.toArray() as [number, number, number] };
      useUi.setState({ measure: !m || m.b || m.revisionId !== revisionId ? { revisionId, a: pt, b: null } : { ...m, b: pt } });
      return;
    }
    if (tool === 'dimension') {
      // Persistent dimension, stored on the frame and anchored to instances (it follows resizes and moves).
      const c = placed.find((x) => x.i.key === key)?.center ?? e.point;
      const pt = { key, offset: e.point.clone().sub(c).toArray() as [number, number, number] };
      const start = useUi.getState().dimStart;
      if (!start || start.frameId !== frame.id) {
        useUi.setState({ dimStart: { frameId: frame.id, ...pt } });
        return;
      }
      const dims = ((frame.props.dimensions as unknown[]) ?? []).concat([{ id: `dim_${Date.now().toString(36)}`, a: { key: start.key, offset: start.offset }, b: pt }]);
      live.writeItems((m) => m.set(frame.id, { ...frame, props: { ...frame.props, dimensions: dims } }));
      useUi.setState({ dimStart: null });
      return;
    }
    if (tool === 'section') {
      const n = e.face?.normal.clone().transformDirection(e.object.matrixWorld) ?? new THREE.Vector3(1, 0, 0);
      const axis = Math.abs(n.x) > 0.5 ? 'x' : Math.abs(n.y) > 0.5 ? 'y' : 'z';
      useUi.getState().setFrameView(frame.id, { section: { axis, at: Math.round(e.point[axis]) } });
      return;
    }
    // Alt-click picks the whole assembly; double-click enters it (Figma-style).
    const ids = e.altKey && inst.assemblyId ? [...new Set(analysis.layout.instances.filter((i) => i.assemblyId === inst.assemblyId).map((i) => i.partId))] : [inst.partId];
    useUi.getState().select(revisionId, ids, e.shiftKey);
    useUi.setState({ activeFrameId: frame.id });
    live.presence({ selection: ids });
  };

  // Gizmo for move / rotate / resize on the first selected instance.
  const gizmoTool = ui.tool === 'move' || ui.tool === 'rotate' || ui.tool === 'resize' ? ui.tool : null;
  const target = gizmoTool && !readOnly && ui.activeFrameId === frame.id ? placed.find((x) => selected.has(x.i.partId)) : undefined;
  const proxy = useRef<THREE.Mesh>(null);

  const commitGizmo = () => {
    if (!target || !proxy.current || !target.part) return;
    const o = proxy.current;
    const inst = target.i;
    const part = target.part;
    if (gizmoTool === 'resize') {
      const s = o.scale;
      const ops = (['x', 'y', 'z'] as const)
        .map((ax) => {
          const dim = dimOnAxis(part.axisMap, ax);
          const v = Math.round(s[ax] * 10) / 10;
          return Math.abs(v - part.dims[dim]) >= 0.1 ? { op: 'setDim' as const, partId: part.id, dim, value: v } : null;
        })
        .filter(Boolean) as { op: 'setDim'; partId: string; dim: 'T' | 'W' | 'L'; value: number }[];
      if (ops.length) rev.edit(makePatch(ops, `Resize ${part.name}`));
    } else {
      const base = part.instanceTransforms[inst.index];
      const pos = o.position;
      const minPos = { x: Math.round(pos.x - inst.size.x / 2), y: Math.round(pos.y - inst.size.y / 2), z: Math.round(pos.z - inst.size.z / 2) };
      const rot = { x: Math.round(o.rotation.x / DEG), y: Math.round(o.rotation.y / DEG), z: Math.round(o.rotation.z / DEG) };
      rev.edit(makePatch([{ op: 'setTransform', partId: part.id, instance: inst.index, transform: { position: gizmoTool === 'move' ? minPos : (base?.position ?? { x: inst.min.x, y: inst.min.y, z: inst.min.z }), rotation: rot } }], `${gizmoTool === 'move' ? 'Move' : 'Rotate'} ${part.name}`));
    }
  };

  const measure = ui.measure?.revisionId === revisionId ? ui.measure : null;
  const hoverInst = hover ? analysis.layout.instances.find((i) => i.key === hover.key) : null;
  const hoverPart = hoverInst ? parts.get(hoverInst.partId) : null;
  const edgesFor = view.shading === 'wireframe' || view.shading === 'xray' ? placed.filter((x) => !x.style.hidden) : placed.filter((x) => selected.has(x.i.partId) || (view.lens === 'none' && failing.has(x.i.partId)));

  return (
    <>
      <OrbitControls ref={controls} makeDefault enableDamping={false} onChange={onCameraChange} />
      {view.shading !== 'wireframe' &&
        groups.map(([k, xs]) => <InstGroup key={k} items={xs} clip={clip} onClick={onClick} onHover={(key, point) => setHover(key ? { key, point } : null)} keyOf={keyOf} />)}
      <EdgeLines items={edgesFor} selected={selected} failing={failing} clip={clip} />
      {view.section && <SectionCap axis={view.section.axis} at={view.section.at} bounds={analysis.layout.bounds} />}
      {view.lens === 'engineering' &&
        analysis.clashes.map((c, n) => (
          <mesh key={n} position={[c.at.x, c.at.y, c.at.z]}>
            <sphereGeometry args={[Math.max(8, radius / 80), 12, 12]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
        ))}
      {aiChanges.flatMap((c) =>
        c.patch.ops
          .filter((o) => o.op === 'setDim')
          .map((o, n) => {
            const x = placed.find((pp) => 'partId' in o && pp.i.partId === o.partId);
            if (!x || o.op !== 'setDim') return null;
            const before = x.part?.dims[o.dim];
            return (
              <Html key={`${c.id}-${n}`} position={[x.center.x, x.i.max.y + 20, x.center.z]} center zIndexRange={[20, 10]}>
                <div className="chip ok" style={{ whiteSpace: 'nowrap' }}>{`${o.dim} ${before} → ${o.value}`}</div>
              </Html>
            );
          }),
      )}
      {hoverPart && hover && ui.tool !== 'measure' && (
        <Html position={hover.point} zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
          <div className="chip" style={{ background: 'var(--panel)', transform: 'translate(10px,10px)' }}>
            {hoverPart.name} · {hoverPart.stdCode ?? 'no code'} · {hoverPart.dims.T}×{hoverPart.dims.W}×{hoverPart.dims.L}
          </div>
        </Html>
      )}
      {measure && <MeasureLine m={measure} analysis={analysis} />}
      {((frame.props.dimensions as DimDef[] | undefined) ?? []).map((d) => {
        const ca = placed.find((x) => x.i.key === d.a.key)?.center;
        const cb = placed.find((x) => x.i.key === d.b.key)?.center;
        if (!ca || !cb) return null;
        const a = ca.clone().add(new THREE.Vector3(...d.a.offset));
        const b = cb.clone().add(new THREE.Vector3(...d.b.offset));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: '#0f766e' }));
        return (
          <group key={d.id}>
            <primitive object={line} raycast={() => null} />
            <Html position={a.clone().add(b).multiplyScalar(0.5)} center>
              <div className="chip" style={{ background: 'var(--panel)', borderColor: '#0f766e' }}>
                {a.distanceTo(b).toFixed(1)} mm
                {!readOnly && (
                  <button className="btn small ghost" style={{ padding: 0 }} aria-label="Remove dimension" onClick={() => live.writeItems((m) => m.set(frame.id, { ...frame, props: { ...frame.props, dimensions: ((frame.props.dimensions as DimDef[]) ?? []).filter((x) => x.id !== d.id) } }))}>
                    ✕
                  </button>
                )}
              </div>
            </Html>
          </group>
        );
      })}
      {target && (
        <TransformControls
          mode={gizmoTool === 'move' ? 'translate' : gizmoTool === 'rotate' ? 'rotate' : 'scale'}
          translationSnap={ui.snap ? ui.gridMm : null}
          rotationSnap={ui.snap ? 90 * DEG : null}
          scaleSnap={null}
          onMouseUp={commitGizmo}
          onObjectChange={() => invalidate()}
        >
          <mesh ref={proxy} position={[(target.i.min.x + target.i.max.x) / 2, (target.i.min.y + target.i.max.y) / 2, (target.i.min.z + target.i.max.z) / 2]} rotation={[target.i.rotation.x * DEG, target.i.rotation.y * DEG, target.i.rotation.z * DEG]} scale={gizmoTool === 'resize' ? [target.i.size.x, target.i.size.y, target.i.size.z] : [1, 1, 1]}>
            <boxGeometry args={gizmoTool === 'resize' ? [1, 1, 1] : [target.i.size.x, target.i.size.y, target.i.size.z]} />
            <meshBasicMaterial color="#2563eb" transparent opacity={0.15} depthWrite={false} />
          </mesh>
        </TransformControls>
      )}
    </>
  );
}

function InstGroup({ items, clip, onClick, onHover, keyOf }: { items: { i: PlacedInstance; center: THREE.Vector3; style: Style }[]; clip: THREE.Plane[]; onClick: (e: ThreeEvent<MouseEvent>) => void; onHover: (key: string | null, p: THREE.Vector3) => void; keyOf: (e: ThreeEvent<PointerEvent>) => string | null }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const style = items[0].style;
  const tex = useMemo(() => (style.stripes ? stripeTexture() : null), [style.stripes]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((x, n) => {
      o.position.copy(x.center);
      o.rotation.set(x.i.rotation.x * DEG, x.i.rotation.y * DEG, x.i.rotation.z * DEG);
      o.scale.set(Math.max(0.5, x.i.size.x), Math.max(0.5, x.i.size.y), Math.max(0.5, x.i.size.z));
      o.updateMatrix();
      m.setMatrixAt(n, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.userData.keys = items.map((x) => x.i.key);
  }, [items]);
  return (
    <instancedMesh
      ref={ref}
      args={[UNIT_BOX, undefined, items.length]}
      onClick={onClick}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(keyOf(e), e.point.clone());
      }}
      onPointerOut={() => onHover(null, new THREE.Vector3())}
    >
      <meshStandardMaterial color={style.color} map={tex} transparent={style.opacity < 1} opacity={style.opacity} depthWrite={style.opacity >= 1} roughness={0.75} metalness={0.05} clippingPlanes={clip} clipShadows />
    </instancedMesh>
  );
}

const BOX_EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];

/** All edges in one LineSegments: wireframe/X-ray, selection outline, failing-part outline (colour is never the only signal). */
function EdgeLines({ items, selected, failing, clip }: { items: { i: PlacedInstance; center: THREE.Vector3 }[]; selected: Set<string>; failing: Set<string>; clip: THREE.Plane[] }) {
  const geom = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const cSel = new THREE.Color('#2563eb');
    const cFail = new THREE.Color('#dc2626');
    const cEdge = new THREE.Color('#475569');
    for (const x of items) {
      const h = { x: x.i.size.x / 2, y: x.i.size.y / 2, z: x.i.size.z / 2 };
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x.i.rotation.x * DEG, x.i.rotation.y * DEG, x.i.rotation.z * DEG));
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? h.x : -h.x, k & 2 ? h.y : -h.y, k & 4 ? h.z : -h.z).applyQuaternion(q).add(x.center));
      const c = selected.has(x.i.partId) ? cSel : failing.has(x.i.partId) ? cFail : cEdge;
      for (const [a, b] of BOX_EDGES) {
        pos.push(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [items, selected, failing]);
  return (
    <lineSegments geometry={geom} raycast={() => null}>
      <lineBasicMaterial vertexColors clippingPlanes={clip} />
    </lineSegments>
  );
}

function SectionCap({ axis, at, bounds }: { axis: 'x' | 'y' | 'z'; at: number; bounds: Analysis['layout']['bounds'] }) {
  const sx = bounds.max.x - bounds.min.x + 200;
  const sy = bounds.max.y - bounds.min.y + 200;
  const sz = bounds.max.z - bounds.min.z + 200;
  const c = [(bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2] as [number, number, number];
  const pos: [number, number, number] = axis === 'x' ? [at, c[1], c[2]] : axis === 'y' ? [c[0], at, c[2]] : [c[0], c[1], at];
  const rot: [number, number, number] = axis === 'x' ? [0, Math.PI / 2, 0] : axis === 'y' ? [-Math.PI / 2, 0, 0] : [0, 0, 0];
  const args: [number, number] = axis === 'x' ? [sz, sy] : axis === 'y' ? [sx, sz] : [sx, sy];
  return (
    <mesh position={pos} rotation={rot} raycast={() => null}>
      <planeGeometry args={args} />
      <meshBasicMaterial color="#2563eb" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function MeasureLine({ m, analysis }: { m: NonNullable<ReturnType<typeof useUi.getState>['measure']>; analysis: Analysis }) {
  const a = new THREE.Vector3(...m.a.point);
  if (!m.b) {
    return (
      <mesh position={a} raycast={() => null}>
        <sphereGeometry args={[6, 10, 10]} />
        <meshBasicMaterial color="#2563eb" />
      </mesh>
    );
  }
  const b = new THREE.Vector3(...m.b.point);
  const d = a.distanceTo(b);
  // Clear gap between the two parts' boxes (face-to-face).
  const box = (pid: string) => {
    const bb = new THREE.Box3();
    for (const i of analysis.layout.instances) if (i.partId === pid) bb.union(new THREE.Box3(new THREE.Vector3(i.min.x, i.min.y, i.min.z), new THREE.Vector3(i.max.x, i.max.y, i.max.z)));
    return bb;
  };
  const ba = box(m.a.partId);
  const bb = box(m.b.partId);
  const gap = (['x', 'y', 'z'] as const).map((ax) => Math.max(0, Math.max(ba.min[ax], bb.min[ax]) - Math.min(ba.max[ax], bb.max[ax])));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: '#2563eb' }));
  return (
    <>
      <primitive object={line} raycast={() => null} />
      <Html position={a.clone().add(b).multiplyScalar(0.5)} center>
        <div className="chip info" style={{ background: 'var(--panel)' }}>
          {d.toFixed(1)} mm · gap {gap.map((g, n) => `${'XYZ'[n]} ${g.toFixed(1)}`).join(' ')}
        </div>
      </Html>
    </>
  );
}
