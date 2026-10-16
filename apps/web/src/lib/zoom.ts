'use client';
import { useUi, FOCUS_FRAME } from './store';
import { zoomers } from './registry';
import type { BoardItem } from '@bom/domain';

/** One zoom for every view: the zoom control, Ctrl + / Ctrl − / Shift+1 and Ctrl+wheel all come here. */
export const ZOOM_STEP = 1.25;
const BOARD_MIN = 0.08;
const BOARD_MAX = 4;
const FOCUS_MIN = 0.25;
const FOCUS_MAX = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function boardRect(): DOMRect | null {
  return document.querySelector('[data-testid="board"]')?.getBoundingClientRect() ?? null;
}

/** Zoom the board about a screen point (default: the middle of the board). */
export function zoomBoardAt(factor: number, cx?: number, cy?: number): void {
  const r = boardRect();
  const s = useUi.getState().board;
  const z = clamp(s.zoom * factor, BOARD_MIN, BOARD_MAX);
  const px = cx !== undefined && r ? cx - r.left : (r?.width ?? 1200) / 2;
  const py = cy !== undefined && r ? cy - r.top : (r?.height ?? 800) / 2;
  useUi.setState({ board: { zoom: z, x: px - ((px - s.x) / s.zoom) * z, y: py - ((py - s.y) / s.zoom) * z } });
}

export function fitBoard(items: BoardItem[]): void {
  const r = boardRect();
  if (!r || !items.length) return;
  const xs = items.flatMap((i) => [i.rect.x, i.rect.x + Math.abs(i.rect.w)]);
  const ys = items.flatMap((i) => [i.rect.y, i.rect.y + Math.abs(i.rect.h)]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  const zoom = clamp(Math.min((r.width - 120) / w, (r.height - 160) / h), BOARD_MIN, BOARD_MAX);
  useUi.setState({ board: { zoom, x: (r.width - w * zoom) / 2 - x0 * zoom, y: (r.height - h * zoom) / 2 - y0 * zoom } });
}

export function zoomBy(factor: number, at?: { x: number; y: number }): void {
  const ui = useUi.getState();
  if (ui.view === 'board') return zoomBoardAt(factor, at?.x, at?.y);
  if (ui.view === 'model') return zoomers.get(FOCUS_FRAME)?.zoomBy(factor);
  useUi.setState({ focusZoom: clamp(ui.focusZoom * factor, FOCUS_MIN, FOCUS_MAX) });
}

export const zoomIn = () => zoomBy(ZOOM_STEP);
export const zoomOut = () => zoomBy(1 / ZOOM_STEP);

export function zoomFit(items: BoardItem[]): void {
  const ui = useUi.getState();
  if (ui.view === 'board') return fitBoard(items);
  if (ui.view === 'model') return zoomers.get(FOCUS_FRAME)?.fit();
  useUi.setState({ focusZoom: 1 });
}

export function zoomReset(): void {
  const ui = useUi.getState();
  if (ui.view === 'board') return zoomBoardAt(1 / ui.board.zoom);
  if (ui.view === 'model') return zoomers.get(FOCUS_FRAME)?.reset();
  useUi.setState({ focusZoom: 1 });
}

/** Current zoom of the visible view, as a percentage. */
export function zoomPercent(s: { view: string; board: { zoom: number }; focusZoom: number; zoom3d: number }): number {
  return Math.round((s.view === 'board' ? s.board.zoom : s.view === 'model' ? s.zoom3d : s.focusZoom) * 100);
}
