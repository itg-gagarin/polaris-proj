'use client';
import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { RevisionContent, WorkspaceSettings } from '@bom/domain';
import { analyze, diffRevisions, type PlacedInstance } from '@bom/engine';
import { materialColor } from '@bom/exporters/colors';

const DEG = Math.PI / 180;

/**
 * Compare frame (PRD §5, §8, §9): two revisions in one scene with one camera (synced by construction),
 * a before/after slider (clipping plane), a ghost of the old parts and the diff list.
 */
export function Compare({ before, after, beforeLabel, afterLabel, settings, onSelect }: { before: RevisionContent; after: RevisionContent; beforeLabel: string; afterLabel: string; settings: WorkspaceSettings; onSelect?: (partIds: string[]) => void }) {
  const [split, setSplit] = useState(0.5);
  const [ghost, setGhost] = useState(true);
  const a = useMemo(() => analyze(before, settings), [before, settings]);
  const b = useMemo(() => analyze(after, settings), [after, settings]);
  const diff = useMemo(() => diffRevisions(before, after), [before, after]);
  const changed = useMemo(() => new Set(diff.changed.map((c) => c.partId)), [diff]);
  const added = useMemo(() => new Set(diff.added.map((p) => p.id)), [diff]);
  const bounds = b.layout.bounds;
  const cx = bounds.min.x + (bounds.max.x - bounds.min.x) * split;
  const center = new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2);
  const r = Math.max(400, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) / 2);
  const clipAfter = useMemo(() => [new THREE.Plane(new THREE.Vector3(1, 0, 0), -cx)], [cx]);
  const clipBefore = useMemo(() => [new THREE.Plane(new THREE.Vector3(-1, 0, 0), cx)], [cx]);
  const bParts = new Map(after.parts.map((p) => [p.id, p]));
  const aParts = new Map(before.parts.map((p) => [p.id, p]));
  const shownA = a.layout.instances.filter((i) => i.source !== 'tray' && !i.packing);
  const shownB = b.layout.instances.filter((i) => i.source !== 'tray' && !i.packing);
  const colorB = (i: PlacedInstance) => (added.has(i.partId) ? '#16a34a' : changed.has(i.partId) ? '#d97706' : materialColor(bParts.get(i.partId) ?? { material: null, kind: 'panel', role: null }));
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 260px' }} data-testid="compare">
      <div style={{ position: 'relative' }}>
        <Canvas camera={{ fov: 32, near: 5, far: 60000, position: center.clone().add(new THREE.Vector3(1, 0.75, 1.25).normalize().multiplyScalar(r * 3.6)).toArray() }} gl={{ localClippingEnabled: true }} frameloop="demand" style={{ position: 'absolute', inset: 0 }}>
          <color attach="background" args={['#f3f4f6']} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[2000, 3000, 2500]} intensity={1} />
          <OrbitControls makeDefault target={center} />
          {shownB.map((i) => (
            <Box key={`b-${i.key}`} i={i} color={colorB(i)} clip={clipAfter} opacity={1} />
          ))}
          {shownA.map((i) => (
            <Box key={`a-${i.key}`} i={i} color={materialColor(aParts.get(i.partId) ?? { material: null, kind: 'panel', role: null })} clip={clipBefore} opacity={1} />
          ))}
          {ghost && shownA.filter((i) => changed.has(i.partId) || !bParts.has(i.partId)).map((i) => <Box key={`g-${i.key}`} i={i} color={bParts.has(i.partId) ? '#94a3b8' : '#dc2626'} clip={[]} opacity={0.18} />)}
        </Canvas>
        <div className="frame-toolbar" style={{ left: 8, right: 8 }}>
          <span className="chip">{beforeLabel}</span>
          <input type="range" min={0} max={1} step={0.01} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Before/after slider" style={{ flex: 1 }} />
          <span className="chip ok">{afterLabel}</span>
          <label className="chip">
            <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} /> ghost
          </label>
        </div>
      </div>
      <div style={{ overflow: 'auto', borderLeft: '1px solid var(--line)', padding: 8, fontSize: 12 }}>
        <div className="section-title">Diff</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="chip ok">+{diff.added.length}</span>
          <span className="chip fail">−{diff.removed.length}</span>
          <span className="chip warn">~{diff.changed.length}</span>
          <span className="chip">checks {a.summary.fail}→{b.summary.fail} fail</span>
        </div>
        {diff.changed.map((c) => (
          <div key={c.partId} className="change" style={{ cursor: 'pointer' }} onClick={() => onSelect?.([c.partId])}>
            <strong>{c.name}</strong>
            {c.changes.map((x, n) => (
              <div key={n} className="mono">
                {x.field}: {fmt(x.before)} → {fmt(x.after)}
              </div>
            ))}
          </div>
        ))}
        {diff.added.map((p) => (
          <div key={p.id} className="change" style={{ borderColor: '#16a34a' }}>
            + {p.originalName}
          </div>
        ))}
        {diff.removed.map((p) => (
          <div key={p.id} className="change" style={{ borderColor: '#dc2626' }}>
            − {p.originalName}
          </div>
        ))}
        {[...diff.parameters, ...diff.assumptions, ...diff.header].map((x, n) => (
          <div key={`p${n}`} className="mono">
            {x.field}: {fmt(x.before)} → {fmt(x.after)}
          </div>
        ))}
      </div>
    </div>
  );
}

const fmt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Box({ i, color, clip, opacity }: { i: PlacedInstance; color: string; clip: THREE.Plane[]; opacity: number }) {
  return (
    <mesh position={[(i.min.x + i.max.x) / 2, (i.min.y + i.max.y) / 2, (i.min.z + i.max.z) / 2]} rotation={[i.rotation.x * DEG, i.rotation.y * DEG, i.rotation.z * DEG]}>
      <boxGeometry args={[Math.max(0.5, i.size.x), Math.max(0.5, i.size.y), Math.max(0.5, i.size.z)]} />
      <meshStandardMaterial color={color} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
    </mesh>
  );
}
