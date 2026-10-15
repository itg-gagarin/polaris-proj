'use client';
import { memo, useMemo } from 'react';
import rough from 'roughjs';
import type { BoardItem, MarkupItem } from '@bom/domain';
import { projectors } from '@/lib/registry';

const gen = rough.generator();

/** Where a markup item is drawn: pinned items follow their part (projector), others use their rect. */
export function resolveRect(m: MarkupItem): MarkupItem['rect'] {
  if (!m.pin) return m.rect;
  const p = projectors.get(m.pin.frameId)?.(m.pin.partId);
  if (!p) return m.rect;
  return { ...m.rect, x: p.x + m.pin.offset.x, y: p.y + m.pin.offset.y };
}

const center = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function shapePaths(m: MarkupItem, r: MarkupItem['rect'], ends: { a: { x: number; y: number }; b: { x: number; y: number } } | null) {
  const o = { stroke: m.style.stroke, strokeWidth: m.style.strokeWidth, fill: m.style.fill ?? undefined, fillStyle: 'hachure' as const, roughness: m.style.sketchy ? 1.2 : 0, bowing: m.style.sketchy ? 1 : 0, seed: hashSeed(m.id) };
  switch (m.type) {
    case 'rect':
      return gen.toPaths(gen.rectangle(r.x, r.y, r.w, r.h, o));
    case 'ellipse':
      return gen.toPaths(gen.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w), Math.abs(r.h), o));
    case 'diamond':
      return gen.toPaths(gen.polygon([[r.x + r.w / 2, r.y], [r.x + r.w, r.y + r.h / 2], [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h / 2]], o));
    case 'line':
    case 'arrow': {
      const a = ends?.a ?? m.points[0] ?? { x: r.x, y: r.y };
      const b = ends?.b ?? m.points[1] ?? { x: r.x + r.w, y: r.y + r.h };
      const paths = gen.toPaths(gen.line(a.x, a.y, b.x, b.y, { ...o, fill: undefined }));
      if (m.type === 'arrow') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const L = 14 + m.style.strokeWidth * 2;
        const p1 = { x: b.x - L * Math.cos(ang - 0.45), y: b.y - L * Math.sin(ang - 0.45) };
        const p2 = { x: b.x - L * Math.cos(ang + 0.45), y: b.y - L * Math.sin(ang + 0.45) };
        paths.push(...gen.toPaths(gen.linearPath([[p1.x, p1.y], [b.x, b.y], [p2.x, p2.y]], { ...o, fill: undefined })));
      }
      return paths;
    }
    default:
      return [];
  }
}

function hashSeed(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  return h || 1;
}

/** Freehand ink: pressure-aware width (pen tablets). */
export function inkPath(points: { x: number; y: number; p?: number }[]): string {
  if (!points.length) return '';
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

export const MarkupShape = memo(function MarkupShape({ m, selected, items, tick, authorColor, onPointerDown, onDoubleClick }: { m: MarkupItem; selected: boolean; items: Map<string, BoardItem>; tick: number; authorColor?: string; onPointerDown: (e: React.PointerEvent, m: MarkupItem) => void; onDoubleClick: (m: MarkupItem) => void }) {
  void tick;
  const r = resolveRect(m);
  const bound = (id: string | null) => {
    const it = id ? items.get(id) : undefined;
    if (!it) return null;
    return center(it.kind === 'markup' ? resolveRect(it) : it.rect);
  };
  const ends = m.type === 'arrow' || m.type === 'line' ? { a: bound(m.bindStart) ?? m.points[0] ?? { x: r.x, y: r.y }, b: bound(m.bindEnd) ?? m.points[1] ?? { x: r.x + r.w, y: r.y + r.h } } : null;
  const paths = useMemo(() => shapePaths(m, r, ends), [m, r.x, r.y, r.w, r.h, ends?.a.x, ends?.a.y, ends?.b.x, ends?.b.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const common = { 'data-item': m.id, className: 'hit', onPointerDown: (e: React.PointerEvent) => onPointerDown(e, m), onDoubleClick: () => onDoubleClick(m) };
  if (m.type === 'pencil') {
    const pts = m.pin ? m.points.map((p) => ({ x: p.x + r.x - m.rect.x, y: p.y + r.y - m.rect.y, p: p.p })) : m.points;
    const avgP = pts.reduce((s, p) => s + (p.p ?? 0.5), 0) / Math.max(1, pts.length);
    return (
      <g {...common}>
        <path d={inkPath(pts)} fill="none" stroke={m.style.stroke} strokeWidth={m.style.strokeWidth * (0.6 + avgP)} strokeLinecap="round" strokeLinejoin="round" />
        <path d={inkPath(pts)} fill="none" stroke="transparent" strokeWidth={14} />
        {selected && <rect x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} fill="none" stroke="#2563eb" strokeDasharray="4 3" />}
      </g>
    );
  }
  if (m.type === 'note' || m.type === 'text') {
    const isNote = m.type === 'note';
    return (
      <g {...common}>
        {isNote && <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill={m.style.fill ?? '#fef3c7'} stroke={authorColor ?? m.style.stroke} strokeWidth={1.5} />}
        <foreignObject x={r.x + (isNote ? 8 : 0)} y={r.y + (isNote ? 6 : 0)} width={Math.max(40, r.w - (isNote ? 16 : 0))} height={Math.max(24, r.h - (isNote ? 12 : 0))}>
          <div style={{ fontSize: m.style.fontSize ?? 16, color: m.style.stroke, whiteSpace: 'pre-wrap', fontFamily: 'var(--font)', lineHeight: 1.25, overflow: 'hidden', height: '100%' }}>{m.text}</div>
        </foreignObject>
        {m.pin && <circle cx={r.x} cy={r.y} r={5} fill="#2563eb" stroke="#fff" strokeWidth={1.5}><title>Pinned to a part</title></circle>}
        {selected && <rect x={r.x - 4} y={r.y - 4} width={r.w + 8} height={r.h + 8} fill="none" stroke="#2563eb" strokeDasharray="4 3" />}
      </g>
    );
  }
  return (
    <g {...common}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? 'none'} />
      ))}
      {/* Fat invisible hit area */}
      {ends ? <line x1={ends.a.x} y1={ends.a.y} x2={ends.b.x} y2={ends.b.y} stroke="transparent" strokeWidth={14} /> : <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" />}
      {m.pin && <circle cx={r.x} cy={r.y} r={5} fill="#2563eb" stroke="#fff" strokeWidth={1.5} />}
      {selected && <rect x={Math.min(r.x, r.x + r.w) - 4} y={Math.min(r.y, r.y + r.h) - 4} width={Math.abs(r.w) + 8} height={Math.abs(r.h) + 8} fill="none" stroke="#2563eb" strokeDasharray="4 3" />}
    </g>
  );
});
