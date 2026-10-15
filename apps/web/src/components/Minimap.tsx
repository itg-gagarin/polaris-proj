'use client';
import type { BoardItem } from '@bom/domain';
import { useUi } from '@/lib/store';

/** The whole board, so people never get lost (PRD §5). Click to jump. */
export function Minimap({ items, board, viewport }: { items: BoardItem[]; board: { x: number; y: number; zoom: number }; viewport: { w: number; h: number } }) {
  const W = 200;
  const H = 130;
  const view = { x: -board.x / board.zoom, y: -board.y / board.zoom, w: viewport.w / board.zoom, h: viewport.h / board.zoom };
  const xs = [...items.map((i) => i.rect.x), view.x];
  const ys = [...items.map((i) => i.rect.y), view.y];
  const xe = [...items.map((i) => i.rect.x + Math.abs(i.rect.w)), view.x + view.w];
  const ye = [...items.map((i) => i.rect.y + Math.abs(i.rect.h)), view.y + view.h];
  const b = { x0: Math.min(...xs) - 100, y0: Math.min(...ys) - 100, x1: Math.max(...xe) + 100, y1: Math.max(...ye) + 100 };
  const s = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0));
  const tx = (x: number) => (x - b.x0) * s;
  const ty = (y: number) => (y - b.y0) * s;
  return (
    <svg
      className="minimap"
      width={W}
      height={H}
      aria-label="Minimap"
      onPointerDown={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as SVGElement).getBoundingClientRect();
        const bxp = (e.clientX - r.left) / s + b.x0;
        const byp = (e.clientY - r.top) / s + b.y0;
        useUi.setState({ board: { zoom: board.zoom, x: -(bxp - view.w / 2) * board.zoom, y: -(byp - view.h / 2) * board.zoom } });
      }}
    >
      {items.map((i) => (
        <rect key={i.id} x={tx(Math.min(i.rect.x, i.rect.x + i.rect.w))} y={ty(Math.min(i.rect.y, i.rect.y + i.rect.h))} width={Math.max(1, Math.abs(i.rect.w) * s)} height={Math.max(1, Math.abs(i.rect.h) * s)} fill={i.kind === 'frame' ? 'var(--line-strong)' : '#fbbf24'} rx={1} />
      ))}
      <rect x={tx(view.x)} y={ty(view.y)} width={view.w * s} height={view.h * s} fill="rgba(37,99,235,0.08)" stroke="var(--accent)" />
    </svg>
  );
}
