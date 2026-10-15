'use client';
import { useEffect, useMemo } from 'react';
import type { FrameItem, Product, Revision, RevisionContent } from '@bom/domain';
import type { Analysis } from '@bom/engine';
import { project, section, sheetInstances, type Projection, type ViewName } from '@bom/exporters/projection';
import { materialColor } from '@bom/exporters/colors';
import { useUi } from '@/lib/store';
import { projectors, pickers } from '@/lib/registry';

interface Props {
  frame: FrameItem;
  content: RevisionContent;
  analysis: Analysis;
  revision: Revision;
  product: Product;
  revisionId: string;
  explode: number;
  sectionPlane: { axis: 'x' | 'y' | 'z'; at: number } | null;
  /** Red/green overlay against another revision (PRD §9 diff on sheets). */
  diff?: { added: Set<string>; removed: Projection['rects']; changed: Set<string> } | null;
}

const VIEWS: ViewName[] = ['front', 'side', 'top'];
const TITLE_H = 56;
const PAD = 40;

/**
 * 2D drawing sheet (PRD §5): front, side, top (+ section when a plane is set), overall dimensions
 * and a title block. Updates live with the model; click a part to select it everywhere.
 */
export function Sheet({ frame, content, analysis, revision, product, revisionId, explode, sectionPlane, diff }: Props) {
  const ui = useUi();
  const parts = useMemo(() => new Map(content.parts.map((p) => [p.id, p])), [content]);
  const inst = useMemo(() => sheetInstances(analysis.layout, { hardware: true }), [analysis]);
  const projections = useMemo(() => {
    const v: { title: string; p: Projection }[] = VIEWS.map((name) => ({ title: name.toUpperCase(), p: project(inst, name, explode) }));
    if (sectionPlane) v.push({ title: `SECTION ${sectionPlane.axis.toUpperCase()} ${sectionPlane.at}`, p: section(inst, sectionPlane.axis, sectionPlane.at) });
    return v;
  }, [inst, explode, sectionPlane]);

  const W = frame.rect.w;
  const H = frame.rect.h - 28;
  // Lay the views out on a grid in mm, then fit that into the frame.
  const cells = projections.map((v) => ({ ...v, w: v.p.bounds.x1 - v.p.bounds.x0, h: v.p.bounds.y1 - v.p.bounds.y0 }));
  const cols = cells.length > 3 ? 2 : 2;
  const gapMm = 220;
  const colW = [0, 1].map((c) => Math.max(1, ...cells.filter((_, i) => i % cols === c).map((x) => x.w)));
  const rowH = [0, 1].map((r) => Math.max(1, ...cells.filter((_, i) => Math.floor(i / cols) === r).map((x) => x.h)));
  const totalW = colW[0] + colW[1] + gapMm * 3;
  const totalH = rowH[0] + rowH[1] + gapMm * 3;
  const scale = Math.min((W - PAD) / totalW, (H - TITLE_H - PAD) / totalH);
  const origin = cells.map((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gapMm + (col ? colW[0] + gapMm : 0);
    const y = gapMm + (row ? rowH[0] + gapMm : 0);
    return { x: x * scale + PAD / 2, y: y * scale + PAD / 2, cw: colW[col] * scale, ch: rowH[row] * scale };
  });
  const toPx = (ci: number, x: number, y: number) => {
    const c = cells[ci];
    const o = origin[ci];
    return { x: o.x + (x - c.p.bounds.x0) * scale, y: o.y + o.ch - (y - c.p.bounds.y0) * scale };
  };
  const selected = new Set(ui.selection.revisionId === revisionId ? ui.selection.partIds : []);

  // Pins + picking in board coordinates (frame body starts 28 px below the frame top).
  useEffect(() => {
    projectors.set(frame.id, (partId) => {
      const r = cells[0]?.p.rects.find((x) => x.partId === partId);
      if (!r) return null;
      const p = toPx(0, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      return { x: frame.rect.x + p.x, y: frame.rect.y + 28 + p.y };
    });
    pickers.set(frame.id, (bp) => {
      const lx = bp.x - frame.rect.x;
      const ly = bp.y - frame.rect.y - 28;
      for (let ci = 0; ci < cells.length; ci++) {
        const hits = cells[ci].p.rects.filter((r) => {
          const a = toPx(ci, r.x0, r.y1);
          const b = toPx(ci, r.x1, r.y0);
          return lx >= a.x && lx <= b.x && ly >= a.y && ly <= b.y;
        });
        if (hits.length) return { partId: hits.sort((a, b) => a.depth - b.depth)[0].partId, revisionId };
      }
      return null;
    });
    return () => {
      projectors.delete(frame.id);
      pickers.delete(frame.id);
    };
  });

  const b = analysis.layout.bounds;
  const overall = { W: Math.round(b.max.x - b.min.x), H: Math.round(b.max.y - b.min.y), D: Math.round(b.max.z - b.min.z) };

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', background: '#fff' }} data-testid={`sheet-${frame.id}`}>
      {cells.map((c, ci) => {
        const sorted = [...c.p.rects].sort((a, b2) => b2.depth - a.depth);
        const o = origin[ci];
        const p0 = toPx(ci, c.p.bounds.x0, c.p.bounds.y0);
        const p1 = toPx(ci, c.p.bounds.x1, c.p.bounds.y1);
        return (
          <g key={c.title}>
            <text x={o.x} y={o.y - 8} fontSize={11} fill="#334155" fontWeight={600}>
              {c.title}
            </text>
            {sorted.map((r) => {
              const a = toPx(ci, r.x0, r.y1);
              const z = toPx(ci, r.x1, r.y0);
              const part = parts.get(r.partId);
              const sel = selected.has(r.partId);
              const color = diff?.added.has(r.partId) ? '#16a34a' : diff?.changed.has(r.partId) ? '#d97706' : part ? materialColor(part) : '#ccc';
              return (
                <rect
                  key={r.key}
                  x={a.x}
                  y={a.y}
                  width={Math.max(0.5, z.x - a.x)}
                  height={Math.max(0.5, z.y - a.y)}
                  fill={r.cut ? '#94a3b8' : color}
                  fillOpacity={r.cut ? 0.9 : diff ? 0.35 : 0.18}
                  stroke={sel ? '#2563eb' : diff?.added.has(r.partId) ? '#16a34a' : '#1f2937'}
                  strokeWidth={sel ? 1.6 : 0.6}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    useUi.getState().select(revisionId, [r.partId], e.shiftKey);
                    useUi.setState({ activeFrameId: frame.id });
                  }}
                >
                  <title>{`${part?.name ?? r.partId} ${part ? `${part.dims.T}×${part.dims.W}×${part.dims.L}` : ''}`}</title>
                </rect>
              );
            })}
            {ci === 0 && diff?.removed.map((r) => {
              const a = toPx(0, r.x0, r.y1);
              const z = toPx(0, r.x1, r.y0);
              return <rect key={`rm-${r.key}`} x={a.x} y={a.y} width={z.x - a.x} height={z.y - a.y} fill="none" stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1} />;
            })}
            {/* Overall dimensions under/right of each view */}
            <Dim x1={p0.x} y1={p0.y + 14} x2={p1.x} y2={p0.y + 14} label={`${Math.round(c.w)}`} />
            <Dim x1={p1.x + 14} y1={p0.y} x2={p1.x + 14} y2={p1.y} label={`${Math.round(c.h)}`} vertical />
          </g>
        );
      })}
      {/* Title block */}
      <g transform={`translate(${W - 360}, ${H - TITLE_H - 6})`}>
        <rect width={354} height={TITLE_H} fill="#fff" stroke="#1f2937" />
        <line x1={0} y1={20} x2={354} y2={20} stroke="#1f2937" />
        <text x={6} y={14} fontSize={11} fontWeight={700} fill="#111827">{`${product.code} · ${product.name}`.slice(0, 54)}</text>
        <text x={6} y={34} fontSize={10} fill="#334155">{`Rev ${revision.label} · ${revision.state.replace('_', ' ')} · ${new Date(revision.updatedAt).toISOString().slice(0, 10)}`}</text>
        <text x={6} y={48} fontSize={10} fill="#334155">{`Overall W ${overall.W} × D ${overall.D} × H ${overall.H} mm · units mm · scale 1:${Math.round(1 / scale)}`}</text>
      </g>
    </svg>
  );
}

function Dim({ x1, y1, x2, y2, label, vertical }: { x1: number; y1: number; x2: number; y2: number; label: string; vertical?: boolean }) {
  return (
    <g stroke="#64748b" fill="#334155" fontSize={10}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={0.6} markerStart="none" />
      <line x1={x1} y1={y1 - 3} x2={x1} y2={y1 + 3} strokeWidth={0.6} transform={vertical ? `rotate(90 ${x1} ${y1})` : undefined} />
      <line x1={x2} y1={y2 - 3} x2={x2} y2={y2 + 3} strokeWidth={0.6} transform={vertical ? `rotate(90 ${x2} ${y2})` : undefined} />
      <text x={(x1 + x2) / 2 + (vertical ? 4 : 0)} y={(y1 + y2) / 2 + (vertical ? 0 : 12)} stroke="none" textAnchor={vertical ? 'start' : 'middle'}>
        {label}
      </text>
    </g>
  );
}
