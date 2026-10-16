'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, Html, ContactShadows, AdaptiveDpr } from '@react-three/drei';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';
import type { FrameItem, Part, RevisionContent } from '@bom/domain';
import { makePatch, TEAMS } from '@bom/domain';
import type { Analysis, PlacedInstance } from '@bom/engine';
import { dimOnAxis, type FastenerMark } from '@bom/engine';
import { materialColor } from '@bom/exporters/colors';
import { useUi, FOCUS_FRAME, type FrameView, type ViewName } from '@/lib/store';
import { projectors, pickers, cameraSetters, zoomers } from '@/lib/registry';
import { usePrefs } from '@/lib/prefs';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { RevisionLive } from '@/lib/live';
import { useEditor, usePresenceVersion } from '@/lib/editor';

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
  /** Procedural wood grain along the part's length. */
  wood?: boolean;
  /** Brushed metal (hardware in the finished look). */
  metal?: boolean;
}

/** Finished look: one honey-teak finish like the catalogue renders; veneered panels a shade lighter. */
const FINISH_SOLID = '#9c6b3c';
const FINISH_PANEL = '#ad7e4c';

/** Colour per instance for the frame's shading + team lens (PRD §5 viewport modes). */
function styleFor(i: PlacedInstance, part: Part | undefined, view: FrameView, failing: Set<string>, clashing: Set<string>, aiChanged: Set<string>): Style {
  const visible = part?.visible ?? true;
  if (i.packing && view.lens !== 'packing') return { color: '#000', opacity: 0, hidden: true };
  if (!part) return { color: '#999', opacity: 1 };
  if (aiChanged.has(part.id)) return { color: '#10b981', opacity: 0.95 };
  const base = view.shading === 'solid' ? (part.kind === 'hardware' ? '#7b8494' : '#cfd3d8') : materialColor(part);
  switch (view.lens) {
    case 'finished':
      if (part.kind === 'hardware') return { color: '#55585e', opacity: 1, metal: true };
      return { color: part.kind === 'panel' || part.kind === 'veneer' ? FINISH_PANEL : FINISH_SOLID, opacity: view.shading === 'xray' ? 0.22 : 1, wood: view.shading !== 'solid' };
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
      return { color: base, opacity: view.shading === 'xray' ? 0.22 : 1, wood: view.shading === 'material' && part.kind !== 'hardware' };
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
  /** The single focused view (simple mode): ground shadow, screws & bolts, zoom control. */
  focus?: boolean;
  /** Suggested fastener positions to draw (screws & bolts toggle). */
  fasteners?: FastenerMark[] | null;
}

function isDark(): boolean {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
}

export function Viewport3D(p: Props) {
  const quality = usePrefs((s) => s.quality);
  const theme = usePrefs((s) => s.theme);
  const bg = useMemo(() => (isDark() ? '#1b2027' : p.focus ? '#f5f5f4' : '#f3f4f6'), [theme, p.focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const fast = quality === 'fast';
  // Hover tooltip is plain DOM over the canvas: moving the mouse never re-draws the 3D scene.
  const tip = useRef<HTMLDivElement>(null);
  const showTip = useCallback((text: string | null, x = 0, y = 0) => {
    const el = tip.current;
    if (!el) return;
    if (!text) {
      el.style.display = 'none';
      return;
    }
    if (el.textContent !== text) el.textContent = text;
    el.style.display = 'block';
    el.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
  }, []);
  // Note pins are DOM over the canvas (projected from 3D), not 3D-portal elements.
  const [pins, setPins] = useState<NotePin[]>([]);
  return (
    <>
    <Canvas
      key={quality}
      // near 20 mm keeps depth precision fine enough that flush faces of touching parts don't flicker.
      camera={{ fov: 32, near: 20, far: 60000, position: [2500, 1800, 3000] }}
      frameloop="demand"
      dpr={fast ? 1 : [1, 2]}
      // While turning or zooming, draw at lower resolution; full resolution again when the mouse stops.
      performance={{ min: 0.5, debounce: 400 }}
      gl={{ antialias: !fast, localClippingEnabled: true, powerPreference: fast ? 'low-power' : 'high-performance' }}
      onCreated={({ gl }) => (gl.localClippingEnabled = true)}
      style={{ position: 'absolute', inset: 0 }}
      data-testid={`viewport-${p.frame.id}`}
    >
      <color attach="background" args={[bg]} />
      <hemisphereLight args={['#ffffff', '#d6d3cd', 0.7]} />
      <directionalLight position={[2000, 3200, 2600]} intensity={1.05} />
      <directionalLight position={[-2200, 1200, -1600]} intensity={0.3} />
      <directionalLight position={[-600, 900, 3000]} intensity={0.25} />
      <StudioLight enabled={!fast} />
      <AdaptiveDpr />
      <Scene {...p} fast={fast} showTip={showTip} onPins={p.focus ? setPins : undefined} />
    </Canvas>
    <div ref={tip} className="v3d-tip" style={{ display: 'none' }} />
    {pins.map((pin) => (
      <button key={pin.partId} className="note-pin" style={{ position: 'absolute', left: pin.x, top: pin.y, transform: 'translate(-50%, -100%)', zIndex: 4 }} title={pin.title} onClick={() => useUi.getState().select(p.revisionId, [pin.partId])} data-testid="note-pin">
        💬 {pin.n}
      </button>
    ))}
    </>
  );
}

/** Soft studio reflections (a procedural room, no download) for the detailed quality. */
function StudioLight({ enabled }: { enabled: boolean }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    if (!enabled) return;
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.4;
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [enabled, gl, scene, invalidate]);
  return null;
}

interface NotePin {
  partId: string;
  n: number;
  x: number;
  y: number;
  title: string;
}

function Scene({ frame, rev, content, analysis, view, readOnly, revisionId, focus, fast, fasteners: fastenersProp, showTip, onPins }: Props & { fast: boolean; showTip: (text: string | null, x?: number, y?: number) => void; onPins?: (pins: NotePin[]) => void }) {
  const { camera, invalidate, size, raycaster, scene } = useThree();
  const controls = useRef<any>(null);
  // Subscribe to what the scene draws only (not camera ticks, toasts, other frames…).
  const ui = useUi(
    useShallow((s) => ({
      selection: s.selection,
      hidden: s.hidden,
      isolated: s.isolated,
      layerHidden: s.layerHidden,
      layerMode: s.layerMode,
      ai: s.ai,
      tool: s.tool,
      activeFrameId: s.activeFrameId,
      measure: s.measure,
      snap: s.snap,
      gridMm: s.gridMm,
    })),
  );
  const fasteners = focus && fastenersProp?.length ? fastenersProp : null;
  const showFasteners = !!fasteners;
  const { live } = useEditor();
  // Other people's selections on this product, outlined in their colour.
  const pv = usePresenceVersion();
  const peerSel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of live.peers()) if (p.selRevisionId === revisionId) for (const id of p.selection ?? []) m.set(id, p.user.color);
    return m;
  }, [pv, live, revisionId]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Parts with open team notes (threads anchored to the part).
  const threads = rev.bundle?.threads;
  const noteOn = useMemo(() => {
    const m = new Map<string, number>();
    for (const th of threads ?? []) if (th.status === 'open' && th.anchor.kind === 'part') m.set(th.anchor.partId, (m.get(th.anchor.partId) ?? 0) + 1);
    return [...m.entries()];
  }, [threads]);
  const tipFor = (key: string) => {
    const inst = analysis.layout.instances.find((i) => i.key === key);
    const pt = inst ? parts.get(inst.partId) : null;
    return pt ? `${pt.name} · ${pt.stdCode ?? 'no code'} · ${pt.dims.T}×${pt.dims.W}×${pt.dims.L}` : null;
  };

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
        const st = styleFor(i, parts.get(i.partId), view, failing, clashing, aiChanged);
        // Screws & bolts on: ghost the wood so the fasteners inside the joints show.
        const style = showFasteners && i.kind !== 'hardware' && !st.hidden ? { ...st, opacity: Math.min(st.opacity, 0.28) } : st;
        return { i, center: c, part: parts.get(i.partId), style };
      }),
    [shown, view, parts, failing, clashing, aiChanged, showFasteners],
  );

  // Group by (colour, opacity, stripes) → one InstancedMesh each: 1,000 parts stay at a handful of draw calls.
  const groups = useMemo(() => {
    const m = new Map<string, typeof placed>();
    for (const x of placed) {
      if (x.style.hidden) continue;
      const k = `${x.style.color}|${x.style.opacity}|${x.style.stripes ? 1 : 0}|${x.style.wood ? 1 : 0}|${x.style.metal ? 1 : 0}`;
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
  const fitDist = useRef(1);
  const fit = (v: ViewName, targetCenter = center, r = radius) => {
    const dir = { iso: [1, 0.75, 1.25], front: [0, 0, 1], back: [0, 0, -1], side: [1, 0, 0], top: [0, 1, 0.0001] }[v];
    // Fit the bounding sphere to the narrower side of the view.
    const aspect = size.width / Math.max(1, size.height);
    const half = Math.min(16 * DEG, Math.atan(Math.tan(16 * DEG) * aspect));
    const d = (r / Math.sin(half)) * 1.02;
    if (targetCenter === center) fitDist.current = d;
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

  useEffect(() => invalidate(), [placed, ui.selection, view, invalidate]);

  // Screen positions of note pins (top centre of the part), refreshed when the camera or model moves.
  const pinFrame = useRef(0);
  const lastPins = useRef('');
  const updatePins = () => {
    if (!onPins) return;
    cancelAnimationFrame(pinFrame.current);
    pinFrame.current = requestAnimationFrame(() => {
      const out: NotePin[] = [];
      for (const [partId, n] of noteOn) {
        const at = placed.find((x) => x.i.partId === partId);
        if (!at) continue;
        const v = new THREE.Vector3(at.center.x, at.i.max.y + at.i.explode.y * view.explode, at.center.z).project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
        out.push({ partId, n, x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, title: at.part?.name ?? '' });
      }
      // Only when something moved (≥ 1 px), so updating the overlay never loops.
      const sig = out.map((q) => `${q.partId}:${Math.round(q.x)}:${Math.round(q.y)}:${q.n}`).join('|');
      if (sig === lastPins.current) return;
      lastPins.current = sig;
      onPins(out);
    });
  };
  useEffect(() => {
    updatePins();
    return () => cancelAnimationFrame(pinFrame.current);
  }); // every render: cheap (a handful of notes)

  // Zoom control / keyboard (focused view only): 100 % = the whole model fits.
  const reportZoom = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishZoom = () => {
    if (!focus || !controls.current) return;
    if (reportZoom.current) return;
    reportZoom.current = setTimeout(() => {
      reportZoom.current = null;
      const dist = camera.position.distanceTo(controls.current.target as THREE.Vector3);
      useUi.setState({ zoom3d: fitDist.current / Math.max(1, dist) });
    }, 120);
  };
  useEffect(() => {
    if (!focus) return;
    zoomers.set(FOCUS_FRAME, {
      zoomBy: (f) => {
        const t = controls.current?.target as THREE.Vector3 | undefined;
        if (!t) return;
        const offset = camera.position.clone().sub(t).divideScalar(f);
        const len = Math.min(fitDist.current * 8, Math.max(60, offset.length()));
        camera.position.copy(t.clone().add(offset.setLength(len)));
        controls.current.update();
        invalidate();
        publishZoom();
      },
      fit: () => {
        fit(view.view);
        publishZoom();
      },
      reset: () => {
        fit(view.view);
        publishZoom();
      },
    });
    return () => {
      zoomers.delete(FOCUS_FRAME);
    };
  });

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
    publishZoom();
    updatePins();
    const t = controls.current?.target as THREE.Vector3 | undefined;
    if (t && ui.activeFrameId === frame.id) {
      const cam = { position: camera.position.toArray() as [number, number, number], target: t.toArray() as [number, number, number] };
      live.presence({ view: { frameId: frame.id, camera: cam, board: useUi.getState().board } });
    }
    // Markup pinned to parts re-projects on the board; the focused view has no board markup.
    if (!focus) useUi.setState((s) => ({ projectionTick: s.projectionTick + 1 }));
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
  // The finished look is seamless (no drawn outlines); material colours keep soft outlines.
  const allEdges = view.shading === 'wireframe' || view.shading === 'xray' || (!fast && view.lens === 'none' && !showFasteners);
  const edgesFor = allEdges ? placed.filter((x) => !x.style.hidden) : placed.filter((x) => selected.has(x.i.partId) || peerSel.has(x.i.partId) || (view.lens === 'none' && failing.has(x.i.partId)));

  return (
    <>
      <OrbitControls ref={controls} makeDefault enableDamping={false} onChange={onCameraChange} minDistance={80} maxDistance={40000} regress />
      {view.shading !== 'wireframe' &&
        groups.map(([k, xs]) => <InstGroup key={k} items={xs} clip={clip} onClick={onClick} onHover={(key, x, y) => showTip(key && useUi.getState().tool !== 'measure' ? tipFor(key) : null, x, y)} keyOf={keyOf} />)}
      <EdgeLines items={edgesFor} selected={selected} failing={failing} clip={clip} soft={allEdges && view.shading !== 'wireframe'} peerSel={peerSel} />
      {focus && !fast && (
        <ContactShadows position={[center.x, analysis.layout.bounds.min.y - 0.5, center.z]} scale={radius * 3.2} blur={2.4} opacity={0.32} far={Math.max(400, analysis.layout.bounds.max.y - analysis.layout.bounds.min.y)} resolution={512} frames={1} key={`${analysis.layout.bounds.min.y}:${radius}:${view.explode}`} />
      )}
      {fasteners && <FastenerLayer marks={fasteners} explode={view.explode} instances={analysis.layout.instances} parts={parts} showTip={showTip} />}
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

/**
 * Part material: standard PBR plus, in the shader,
 * - wood grain running along the part's longest side (rings across, pores along), varied per piece;
 * - a soft light edge (≈1.5 mm), so pieces read as eased-edge solid wood instead of sharp boxes;
 * - a tiny per-part depth tie-break (≤ 0.4 mm, smaller parts in front, constant in mm at any
 *   distance): faces of touching parts that lie in one plane never flicker, and no gap is left
 *   between them (the old size inset showed as hairline seams).
 */
function partMaterial(style: Style, clip: THREE.Plane[], tex: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: style.color,
    map: tex,
    transparent: style.opacity < 1,
    opacity: style.opacity,
    depthWrite: style.opacity >= 1,
    roughness: style.metal ? 0.35 : style.wood ? 0.62 : 0.75,
    metalness: style.metal ? 0.75 : 0.02,
    clippingPlanes: clip,
    clipShadows: true,
  });
  const wood = !!style.wood;
  m.onBeforeCompile = (sh) => {
    sh.defines = { ...(sh.defines ?? {}), ...(wood ? { WOOD: '' } : {}) };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vPartPos;
varying vec3 vPartSize;
varying vec3 vPartSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 psz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vPartSeed = instanceMatrix[3].xyz;
#else
  vec3 psz = vec3(1.0);
  vPartSeed = vec3(0.0);
#endif
  vPartSize = psz;
  vPartPos = position * psz;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  // Depth tie-break in mm (2·near·Δ/w in clip space keeps Δ constant with distance; near = 20 mm).
  float pvol = log(psz.x * psz.y * psz.z + 1.0);
  float rank = 1.0 - clamp(pvol / 22.0, 0.0, 1.0);
  gl_Position.z -= 2.0 * 20.0 * (0.4 * rank) / max(gl_Position.w, 1.0);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vPartPos;
varying vec3 vPartSize;
varying vec3 vPartSeed;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec3 dEdge = vPartSize * 0.5 - abs(vPartPos);
  float e1 = min(dEdge.x, min(dEdge.y, dEdge.z));
  float e3 = max(dEdge.x, max(dEdge.y, dEdge.z));
  float e2 = dEdge.x + dEdge.y + dEdge.z - e1 - e3;
#ifdef WOOD
  vec3 sz = vPartSize;
  vec3 wp = vPartPos + vPartSeed * 0.731;
  float along; float ca; float cb;
  if (sz.x >= sz.y && sz.x >= sz.z) { along = wp.x; ca = wp.y; cb = wp.z; }
  else if (sz.y >= sz.z) { along = wp.y; ca = wp.x; cb = wp.z; }
  else { along = wp.z; ca = wp.x; cb = wp.y; }
  float warp = wNoise(vec2(along * 0.005, ca * 0.015 + cb * 0.01)) * 16.0 + wNoise(vec2(along * 0.028, cb * 0.04)) * 3.0;
  float ring = ca * 0.55 + cb * 0.85 + warp;
  float g = fract(ring * 0.06);
  float late = smoothstep(0.55, 0.92, g) * (1.0 - smoothstep(0.92, 1.0, g));
  float pores = wNoise(vec2(along * 0.22, ring * 1.7));
  float streak = wNoise(vec2(along * 0.0015, ring * 0.04));
  float piece = 0.95 + 0.08 * wHash(vPartSeed.xz * 0.013 + vPartSeed.y * 0.007);
  diffuseColor.rgb *= piece * (1.0 - 0.09 * late - 0.035 * pores + 0.05 * (streak - 0.5));
#endif
  // Eased edge: a soft highlight within ~1.5 mm of an edge.
  float ease = 1.0 - smoothstep(0.0, 1.6, e2);
  diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * 1.22 + 0.025, vec3(1.0)), ease * 0.55);`,
      );
  };
  m.customProgramCacheKey = () => (wood ? 'part-wood' : 'part-plain');
  return m;
}

function InstGroup({ items, clip, onClick, onHover, keyOf }: { items: { i: PlacedInstance; center: THREE.Vector3; style: Style }[]; clip: THREE.Plane[]; onClick: (e: ThreeEvent<MouseEvent>) => void; onHover: (key: string | null, x: number, y: number) => void; keyOf: (e: ThreeEvent<PointerEvent>) => string | null }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const style = items[0].style;
  const tex = useMemo(() => (style.stripes ? stripeTexture() : null), [style.stripes]);
  const material = useMemo(() => partMaterial(style, clip, tex), [style.color, style.opacity, style.wood, style.metal, clip, tex]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => material.dispose(), [material]);
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
      args={[UNIT_BOX, material, items.length]}
      material={material}
      onClick={onClick}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(keyOf(e), e.nativeEvent.offsetX, e.nativeEvent.offsetY);
      }}
      onPointerOut={() => onHover(null, 0, 0)}
    />
  );
}

const BOX_EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];

/** All edges in one LineSegments: wireframe/X-ray, selection outline, failing-part outline (colour is never the only signal). */
function EdgeLines({ items, selected, failing, clip, soft, peerSel }: { items: { i: PlacedInstance; center: THREE.Vector3 }[]; selected: Set<string>; failing: Set<string>; clip: THREE.Plane[]; soft?: boolean; peerSel?: Map<string, string> }) {
  const geom = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const cSel = new THREE.Color('#2563eb');
    const cFail = new THREE.Color('#dc2626');
    const cEdge = new THREE.Color(soft ? '#5b4636' : '#475569');
    for (const x of items) {
      const h = { x: x.i.size.x / 2, y: x.i.size.y / 2, z: x.i.size.z / 2 };
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x.i.rotation.x * DEG, x.i.rotation.y * DEG, x.i.rotation.z * DEG));
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => new THREE.Vector3(k & 1 ? h.x : -h.x, k & 2 ? h.y : -h.y, k & 4 ? h.z : -h.z).applyQuaternion(q).add(x.center));
      const peer = peerSel?.get(x.i.partId);
      const c = selected.has(x.i.partId) ? cSel : peer ? new THREE.Color(peer) : failing.has(x.i.partId) ? cFail : cEdge;
      for (const [a, b] of BOX_EDGES) {
        pos.push(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [items, selected, failing, soft, peerSel]);
  return (
    <lineSegments geometry={geom} raycast={() => null}>
      <lineBasicMaterial vertexColors clippingPlanes={clip} transparent={soft} opacity={soft ? 0.38 : 1} />
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

const FASTENER_COLOR: Record<string, string> = { screw: '#9ca3af', connectorBolt: '#374151', hangerBolt: '#4b5563', insertNut: '#b7791f', tNut: '#a16207', capNut: '#6b7280', other: '#6b7280', tool: '#6b7280' };
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

/**
 * Screws, bolts and nuts at their suggested positions: real size (Ø × length along the drive axis)
 * plus a dot that stays visible at any zoom. Positions follow the part they sit in when exploded.
 */
function FastenerLayer({ marks, explode, instances, parts, showTip }: { marks: FastenerMark[]; explode: number; instances: PlacedInstance[]; parts: Map<string, Part>; showTip: (text: string | null, x?: number, y?: number) => void }) {
  const byKey = useMemo(() => new Map(instances.map((i) => [i.key, i])), [instances]);
  const kinds = useMemo(() => {
    const m = new Map<string, FastenerMark[]>();
    for (const x of marks) m.set(x.kind, [...(m.get(x.kind) ?? []), x]);
    return [...m.entries()];
  }, [marks]);
  const posOf = useCallback((m: FastenerMark) => {
    const host = m.hosts.map((k) => byKey.get(k)).find(Boolean);
    const e = host ? host.explode : { x: 0, y: 0, z: 0 };
    // Centre of the shank: half its length into the part along the drive direction.
    const half = (m.length / 2) * m.dir;
    return new THREE.Vector3(m.at.x + e.x * explode + (m.axis === 'x' ? half : 0), m.at.y + e.y * explode + (m.axis === 'y' ? half : 0), m.at.z + e.z * explode + (m.axis === 'z' ? half : 0));
  }, [byKey, explode]);
  const nameOf = (k: string) => parts.get(byKey.get(k)?.partId ?? '')?.name ?? k;
  return (
    <>
      {kinds.map(([kind, xs]) => (
        <FastenerGroup key={kind} kind={kind} marks={xs} posOf={posOf} onHover={(m, x, y) => showTip(m ? `${parts.get(m.partId)?.name} · ${m.hosts.map(nameOf).join(' + ')} · ~` : null, x, y)} />
      ))}
    </>
  );
}

function FastenerGroup({ kind, marks, posOf, onHover }: { kind: string; marks: FastenerMark[]; posOf: (m: FastenerMark) => THREE.Vector3; onHover: (m: FastenerMark | null, x: number, y: number) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dots = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(marks.flatMap((m) => posOf(m).toArray()), 3));
    return g;
  }, [marks, posOf]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    marks.forEach((m, n) => {
      o.position.copy(posOf(m));
      o.rotation.set(m.axis === 'z' ? Math.PI / 2 : 0, 0, m.axis === 'x' ? Math.PI / 2 : 0);
      o.scale.set(m.diameter, m.length, m.diameter);
      o.updateMatrix();
      mesh.setMatrixAt(n, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [marks, posOf]);
  const color = FASTENER_COLOR[kind] ?? '#6b7280';
  return (
    <>
      <instancedMesh
        ref={ref}
        args={[CYL, undefined, marks.length]}
        onPointerMove={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onHover(marks[e.instanceId], e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        }}
        onPointerOut={() => onHover(null, 0, 0)}
      >
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.35} />
      </instancedMesh>
      <points geometry={dots} raycast={() => null}>
        <pointsMaterial color={kind === 'screw' ? '#2563eb' : kind === 'insertNut' || kind === 'tNut' ? '#d97706' : '#7c3aed'} size={7} sizeAttenuation={false} depthTest={false} transparent opacity={0.9} />
      </points>
    </>
  );
}
