'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardItem, FrameItem, MarkupItem, MarkupType, NoteAnchor } from '@bom/domain';
import { newId, TEAMS } from '@bom/domain';
import { meetingInk } from '@bom/collab';
import { useShallow } from 'zustand/react/shallow';
import { useEditor, useLiveVersion, usePresenceVersion } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { pickers } from '@/lib/registry';
import { api } from '@/lib/api';
import { FrameHost } from './FrameHost';
import { MarkupShape, inkPath, resolveRect } from './Markup';
import { Minimap } from './Minimap';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; bx: number; by: number }
  | { kind: 'frame'; id: string; sx: number; sy: number; rect: FrameItem['rect'] }
  | { kind: 'resize'; id: string; sx: number; sy: number; rect: FrameItem['rect'] }
  | { kind: 'create'; item: MarkupItem; ox: number; oy: number }
  | { kind: 'move'; ids: string[]; sx: number; sy: number; start: Map<string, MarkupItem> }
  | { kind: 'box'; sx: number; sy: number; x: number; y: number }
  | { kind: 'erase' };

const SHAPES: MarkupType[] = ['rect', 'diamond', 'ellipse', 'arrow', 'line', 'pencil'];

export function Board() {
  const { live, me, users } = useEditor();
  useLiveVersion();
  // Only what the board draws: a camera move or a hover elsewhere must not re-render every frame.
  const ui = useUi(useShallow((s) => ({ board: s.board, tool: s.tool, snap: s.snap, ortho: s.ortho, toolLocked: s.toolLocked, selectedItems: s.selectedItems, meetingId: s.meetingId, projectionTick: s.projectionTick })));
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<MarkupItem | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const lastCursor = useRef(0);
  const pendingEdit = useRef<string | null>(null);
  const { x: bx, y: by, zoom } = ui.board;
  const items = live.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const frames = items.filter((i): i is FrameItem => i.kind === 'frame');
  const markups = items.filter((i): i is MarkupItem => i.kind === 'markup');
  const toBoard = useCallback((cx: number, cy: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (cx - r.left - bx) / zoom, y: (cy - r.top - by) / zoom };
  }, [bx, by, zoom]);
  const snap = (v: number) => (ui.snap ? Math.round(v / 10) * 10 : v);

  // First time on the board this visit: start clear of the floating left panel.
  useEffect(() => {
    const b = useUi.getState().board;
    if (b.x === 40 && b.y === 80) useUi.setState({ board: { ...b, x: 340, y: 90 } });
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Space = temporary hand tool (PRD §6).
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select') && setSpace(true);
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Wheel: pan; Ctrl/⌘ + wheel or pinch: zoom at the cursor. 3D frames keep the wheel for orbit zoom.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.frame[data-type="viewport"] .frame-body, .frame[data-type="compare"] .frame-body, .frame-scaled')) return;
      e.preventDefault();
      const s = useUi.getState().board;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const z = Math.min(4, Math.max(0.08, s.zoom * Math.exp(-e.deltaY * 0.0015)));
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        useUi.setState({ board: { zoom: z, x: px - ((px - s.x) / s.zoom) * z, y: py - ((py - s.y) / s.zoom) * z } });
      } else useUi.setState({ board: { ...s, x: s.x - e.deltaX, y: s.y - e.deltaY } });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const writeItem = (it: BoardItem) => live.writeItems((m) => m.set(it.id, it));
  const removeItems = (ids: string[]) => live.writeItems((m) => ids.forEach((id) => m.delete(id)));
  const nextZ = () => Math.max(1, ...items.map((i) => i.z)) + 1;

  const pinAt = (p: { x: number; y: number }): MarkupItem['pin'] => {
    for (const f of [...frames].reverse()) {
      if (p.x < f.rect.x || p.y < f.rect.y || p.x > f.rect.x + f.rect.w || p.y > f.rect.y + f.rect.h) continue;
      const hit = pickers.get(f.id)?.(p);
      if (hit) return { frameId: f.id, partId: hit.partId, offset: { x: 0, y: 0 } };
    }
    return null;
  };

  const tool = space ? 'hand' : ui.tool;
  // Frames are memoised: their drag handlers read the current tool through a ref.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const meetingLive = !!ui.meetingId;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.frame, .toolbar, .minimap, foreignObject textarea')) return;
    const p = toBoard(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'hand' || e.button === 1) return setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, bx, by });
    if (tool === 'eraser') return setDrag({ kind: 'erase' });
    if (tool === 'laser') return;
    if (tool === 'select') {
      useUi.setState({ selectedItems: [] });
      if (!e.shiftKey) useUi.getState().select(null, []);
      return setDrag({ kind: 'box', sx: p.x, sy: p.y, x: p.x, y: p.y });
    }
    if (tool === 'text' || tool === 'note') {
      const isNote = tool === 'note';
      const team = me.teams[0] ?? 'design';
      const item: MarkupItem = { id: newId('mk'), kind: 'markup', type: tool, points: [], rect: { x: snap(p.x), y: snap(p.y), w: isNote ? 220 : 260, h: isNote ? 140 : 40 }, text: '', style: { stroke: isNote ? '#1f2937' : '#1f2937', fill: isNote ? `${TEAMS[team].color}33` : null, strokeWidth: 1, sketchy: false, fontSize: isNote ? 16 : 20 }, z: nextZ(), authorId: me.id, bindStart: null, bindEnd: null, pin: pinAt(p), team: isNote ? team : null };
      writeItem(item);
      // Open the editor after pointerup: the browser's mousedown focus change would blur it immediately.
      pendingEdit.current = item.id;
      if (!ui.toolLocked) useUi.setState({ tool: 'select' });
      return;
    }
    if (SHAPES.includes(tool as MarkupType)) {
      const type = tool as MarkupType;
      const sp = type === 'pencil' ? p : { x: snap(p.x), y: snap(p.y) };
      const item: MarkupItem = { id: newId('mk'), kind: 'markup', type, points: type === 'pencil' ? [{ x: p.x, y: p.y, p: e.pressure || 0.5 }] : [sp, sp], rect: { x: sp.x, y: sp.y, w: 0, h: 0 }, text: '', style: { stroke: meetingLive && type === 'pencil' ? me.color : '#1f2937', fill: null, strokeWidth: type === 'pencil' ? 2 : 1.5, sketchy: true }, z: nextZ(), authorId: me.id, bindStart: type === 'arrow' || type === 'line' ? (hitItem(sp)?.id ?? null) : null, bindEnd: null, pin: null, team: me.teams[0] ?? null };
      setDraft(item);
      setDrag({ kind: 'create', item, ox: sp.x, oy: sp.y });
    }
  };

  const hitItem = (p: { x: number; y: number }): BoardItem | null => {
    const sorted = [...items].sort((a, b) => b.z - a.z);
    for (const it of sorted) {
      const r = it.kind === 'markup' ? resolveRect(it) : it.rect;
      const x0 = Math.min(r.x, r.x + r.w);
      const y0 = Math.min(r.y, r.y + r.h);
      if (p.x >= x0 && p.y >= y0 && p.x <= x0 + Math.abs(r.w) && p.y <= y0 + Math.abs(r.h)) return it;
    }
    return null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toBoard(e.clientX, e.clientY);
    const now = performance.now();
    if (now - lastCursor.current > 33) {
      lastCursor.current = now;
      live.presence({ cursor: p, laser: tool === 'laser' && e.buttons ? p : null });
    }
    if (!drag) return;
    switch (drag.kind) {
      case 'pan':
        useUi.setState({ board: { zoom, x: drag.bx + e.clientX - drag.sx, y: drag.by + e.clientY - drag.sy } });
        break;
      case 'frame': {
        const f = byId.get(drag.id) as FrameItem;
        writeItem({ ...f, rect: { ...drag.rect, x: snap(drag.rect.x + (e.clientX - drag.sx) / zoom), y: snap(drag.rect.y + (e.clientY - drag.sy) / zoom) } });
        break;
      }
      case 'resize': {
        const f = byId.get(drag.id) as FrameItem;
        writeItem({ ...f, rect: { ...drag.rect, w: Math.max(280, snap(drag.rect.w + (e.clientX - drag.sx) / zoom)), h: Math.max(200, snap(drag.rect.h + (e.clientY - drag.sy) / zoom)) } });
        break;
      }
      case 'create': {
        const it = drag.item;
        if (it.type === 'pencil') {
          const pts = [...(draft?.points ?? it.points), { x: p.x, y: p.y, p: e.pressure || 0.5 }];
          const xs = pts.map((q) => q.x);
          const ys = pts.map((q) => q.y);
          setDraft({ ...it, points: pts, rect: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } });
          if (meetingLive) live.presence({ ink: { points: pts.slice(-200).map((q) => [q.x, q.y, q.p ?? 0.5]), color: me.color } });
        } else {
          let ex = snap(p.x);
          let ey = snap(p.y);
          if (e.shiftKey || ui.ortho) {
            if (it.type === 'line' || it.type === 'arrow') Math.abs(ex - drag.ox) > Math.abs(ey - drag.oy) ? (ey = drag.oy) : (ex = drag.ox);
            else {
              const d = Math.max(Math.abs(ex - drag.ox), Math.abs(ey - drag.oy));
              ex = drag.ox + Math.sign(ex - drag.ox || 1) * d;
              ey = drag.oy + Math.sign(ey - drag.oy || 1) * d;
            }
          }
          const rect = it.type === 'line' || it.type === 'arrow' ? { x: drag.ox, y: drag.oy, w: ex - drag.ox, h: ey - drag.oy } : { x: Math.min(drag.ox, ex), y: Math.min(drag.oy, ey), w: Math.abs(ex - drag.ox), h: Math.abs(ey - drag.oy) };
          setDraft({ ...it, rect, points: [{ x: drag.ox, y: drag.oy }, { x: ex, y: ey }] });
        }
        break;
      }
      case 'move': {
        const dx = (e.clientX - drag.sx) / zoom;
        const dy = (e.clientY - drag.sy) / zoom;
        live.writeItems((m) => {
          for (const id of drag.ids) {
            const s = drag.start.get(id)!;
            const moved: MarkupItem = s.pin ? { ...s, pin: { ...s.pin, offset: { x: s.pin.offset.x + dx, y: s.pin.offset.y + dy } } } : { ...s, rect: { ...s.rect, x: snap(s.rect.x + dx), y: snap(s.rect.y + dy) }, points: s.points.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) };
            m.set(id, moved);
          }
        });
        break;
      }
      case 'box':
        setBox({ x: Math.min(drag.sx, p.x), y: Math.min(drag.sy, p.y), w: Math.abs(p.x - drag.sx), h: Math.abs(p.y - drag.sy) });
        break;
      case 'erase': {
        const hit = hitItem(p);
        if (hit && hit.kind === 'markup') removeItems([hit.id]); // Eraser never touches model parts or frames.
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pendingEdit.current) {
      const id = pendingEdit.current;
      pendingEdit.current = null;
      setTimeout(() => setEditing(id), 0);
    }
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === 'create' && draft) {
      const p = toBoard(e.clientX, e.clientY);
      const tiny = draft.type !== 'pencil' && Math.abs(draft.rect.w) < 4 && Math.abs(draft.rect.h) < 4;
      if (!tiny) {
        const end = draft.type === 'arrow' || draft.type === 'line' ? hitItem(p) : null;
        // Ink and shapes that land on a part pin to it (they move with the part).
        const anchor = draft.type === 'pencil' ? draft.points[0] : { x: draft.rect.x, y: draft.rect.y };
        const pin = draft.type === 'arrow' || draft.type === 'line' ? null : pinAt(anchor);
        const pinned = pin ? (() => {
          const at = (resolveRect({ ...draft, pin: { ...pin, offset: { x: 0, y: 0 } } }));
          return { ...pin, offset: { x: draft.rect.x - at.x, y: draft.rect.y - at.y } };
        })() : null;
        const final: MarkupItem = { ...draft, bindEnd: end && end.id !== draft.id ? end.id : null, pin: pinned };
        if (meetingLive && final.type === 'pencil') void saveMeetingInk(final, pin);
        else writeItem(final);
      }
      setDraft(null);
      live.presence({ ink: null });
      if (!ui.toolLocked && draft.type !== 'pencil') useUi.setState({ tool: 'select' });
    }
    if (d.kind === 'box' && box) {
      const ids = markups.filter((m) => {
        const r = resolveRect(m);
        return r.x >= box.x && r.y >= box.y && r.x + Math.abs(r.w) <= box.x + box.w && r.y + Math.abs(r.h) <= box.y + box.h;
      }).map((m) => m.id);
      useUi.setState({ selectedItems: ids });
      setBox(null);
    }
  };

  /** Meeting mode: ink goes to the person's private layer (a meeting note), pinned to the part it lands on. */
  const saveMeetingInk = async (m: MarkupItem, pin: MarkupItem['pin']) => {
    const meetingId = useUi.getState().meetingId!;
    const anchor: NoteAnchor = pin ? { kind: 'part', partId: pin.partId, stdCode: null, position: null } : { kind: 'sheet', sheetId: 'board', x: m.rect.x, y: m.rect.y };
    const presenting = live.peers().length >= 0 && (live.awareness?.getLocalState() as { presenting?: unknown } | null)?.presenting;
    try {
      await api(`/api/meetings/${meetingId}`, { method: 'POST', json: { action: 'note', team: me.teams[0] ?? 'design', anchor, kind: 'ink', ink: [{ points: m.points.map((q) => ({ x: q.x, y: q.y, p: q.p ?? 0.5 })), color: m.style.stroke, width: m.style.strokeWidth }], share: !!presenting, clientId: m.id } });
      if (presenting) live.boardDoc.transact(() => meetingInk(live.boardDoc, meetingId).push([{ id: m.id, userId: me.id, partId: pin?.partId ?? null, points: m.points.map((q) => [q.x, q.y, q.p ?? 0.5]), color: m.style.stroke, at: Date.now() }]), live.origin);
      useUi.setState((s) => ({ projectionTick: s.projectionTick + 1 }));
      window.dispatchEvent(new CustomEvent('bom:meeting-refresh'));
    } catch (err) {
      useUi.getState().toast((err as Error).message, 'error');
    }
  };

  const onItemPointerDown = (e: React.PointerEvent, m: MarkupItem) => {
    if (tool === 'eraser') {
      e.stopPropagation();
      removeItems([m.id]);
      return;
    }
    if (tool !== 'select') return;
    e.stopPropagation();
    const sel = e.shiftKey ? [...new Set([...ui.selectedItems, m.id])] : ui.selectedItems.includes(m.id) ? ui.selectedItems : [m.id];
    useUi.setState({ selectedItems: sel });
    let ids = sel;
    let startMap: Map<string, MarkupItem>;
    // Alt-drag duplicates (PRD §6).
    if (e.altKey) {
      const copies = sel.map((id) => byId.get(id)).filter((x): x is MarkupItem => x?.kind === 'markup').map((x) => ({ ...x, id: newId('mk'), z: nextZ() }));
      live.writeItems((mm) => copies.forEach((c) => mm.set(c.id, c)));
      ids = copies.map((c) => c.id);
      startMap = new Map(copies.map((c) => [c.id, c]));
      useUi.setState({ selectedItems: ids });
    } else startMap = new Map(sel.map((id) => byId.get(id)).filter((x): x is MarkupItem => x?.kind === 'markup').map((x) => [x.id, x]));
    const start = startMap;
    (wrap.current as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ kind: 'move', ids, sx: e.clientX, sy: e.clientY, start });
  };

  // Keyboard: delete selected markup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && useUi.getState().selectedItems.length) {
        removeItems(useUi.getState().selectedItems);
        useUi.setState({ selectedItems: [] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const authorColor = (id: string) => users.get(id)?.color;
  const sharedInk = ui.meetingId ? meetingInk(live.boardDoc, ui.meetingId).toArray() : [];
  const gridStep = 40 * zoom;

  return (
    <div
      ref={wrap}
      className="boardwrap"
      style={{ cursor: tool === 'hand' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => live.presence({ cursor: null })}
      data-testid="board"
    >
      <svg className="boardgrid" width="100%" height="100%">
        <defs>
          <pattern id="grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse" x={bx % gridStep} y={by % gridStep}>
            <circle cx={1} cy={1} r={1} fill="var(--grid)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="frames">
        {frames.map((f) => (
          <FrameHost
            key={f.id}
            item={f}
            screen={{ x: bx + f.rect.x * zoom, y: by + f.rect.y * zoom, w: f.rect.w * zoom, h: f.rect.h * zoom, zoom }}
            onStartDrag={(e) => {
              if (toolRef.current !== 'select' && toolRef.current !== 'hand') return;
              e.stopPropagation();
              (wrap.current as HTMLElement).setPointerCapture(e.pointerId);
              setDrag({ kind: 'frame', id: f.id, sx: e.clientX, sy: e.clientY, rect: f.rect });
            }}
            onStartResize={(e) => {
              e.stopPropagation();
              (wrap.current as HTMLElement).setPointerCapture(e.pointerId);
              setDrag({ kind: 'resize', id: f.id, sx: e.clientX, sy: e.clientY, rect: f.rect });
            }}
            onRemove={() => removeItems([f.id])}
          />
        ))}
      </div>
      <svg className={`markup ${tool !== 'select' && tool !== 'hand' && tool !== 'eraser' && tool !== 'laser' ? '' : ''}`} style={{ pointerEvents: 'none' }}>
        <g transform={`translate(${bx} ${by}) scale(${zoom})`}>
          {markups.map((m) => (
            <MarkupShape key={m.id} m={m} selected={ui.selectedItems.includes(m.id)} items={byId} tick={ui.projectionTick} authorColor={authorColor(m.authorId)} onPointerDown={onItemPointerDown} onDoubleClick={(mm) => (mm.type === 'text' || mm.type === 'note') && setEditing(mm.id)} />
          ))}
          {sharedInk.map((s) => (
            <path key={s.id} d={inkPath(s.points.map(([x, y]) => ({ x, y })))} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinecap="round" />
          ))}
          {draft && draft.type === 'pencil' && <path d={inkPath(draft.points)} fill="none" stroke={draft.style.stroke} strokeWidth={2.5} strokeLinecap="round" />}
          {draft && draft.type !== 'pencil' && <MarkupShape m={draft} selected={false} items={byId} tick={0} onPointerDown={() => {}} onDoubleClick={() => {}} />}
          {box && <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="rgba(37,99,235,0.08)" stroke="#2563eb" strokeDasharray="4 3" />}
        </g>
      </svg>
      {editing && <TextEditor item={byId.get(editing) as MarkupItem | undefined} screen={{ bx, by, zoom }} onDone={(text) => {
        const it = byId.get(editing) as MarkupItem | undefined;
        setEditing(null);
        if (!it) return;
        if (!text.trim()) removeItems([it.id]);
        else writeItem({ ...it, text });
      }} />}
      <Peers bx={bx} by={by} zoom={zoom} />
      <Minimap items={items} board={ui.board} viewport={size} />
    </div>
  );
}

/** Other people's cursors, laser and live ink: re-renders on presence only. */
function Peers({ bx, by, zoom }: { bx: number; by: number; zoom: number }) {
  const { live } = useEditor();
  usePresenceVersion();
  const peersList = live.peers();
  return (
    <>
      <svg className="markup" style={{ pointerEvents: 'none' }}>
        <g transform={`translate(${bx} ${by}) scale(${zoom})`}>
          {peersList.map((p) => p.ink && <path key={`ink-${p.clientId}`} d={inkPath(p.ink.points.map(([x, y]) => ({ x, y })))} fill="none" stroke={p.ink.color} strokeWidth={2.5} opacity={0.8} />)}
        </g>
      </svg>
      {peersList.map((p) =>
        p.cursor ? (
          <div key={p.clientId} className="cursor-peer" style={{ left: bx + p.cursor.x * zoom, top: by + p.cursor.y * zoom }}>
            <svg width={14} height={14} viewBox="0 0 14 14" style={{ position: 'absolute' }}>
              <path d="M0 0 L12 5 L6 6 L4 12 Z" fill={p.user.color} stroke="#fff" strokeWidth={1} />
            </svg>
            <span className="label" style={{ background: p.user.color }}>{p.user.name.split(' ')[0]}</span>
          </div>
        ) : null,
      )}
      {peersList.map((p) => p.laser && <div key={`laser-${p.clientId}`} style={{ position: 'absolute', left: bx + p.laser.x * zoom - 6, top: by + p.laser.y * zoom - 6, width: 12, height: 12, borderRadius: 6, background: '#ef4444', boxShadow: '0 0 12px 4px rgba(239,68,68,.6)', pointerEvents: 'none', zIndex: 41 }} />)}
    </>
  );
}

function TextEditor({ item, screen, onDone }: { item: MarkupItem | undefined; screen: { bx: number; by: number; zoom: number }; onDone: (t: string) => void }) {
  const [v, setV] = useState(item?.text ?? '');
  if (!item) return null;
  const r = resolveRect(item);
  return (
    <textarea
      autoFocus
      className="input"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) onDone(v);
        e.stopPropagation();
      }}
      style={{ position: 'absolute', left: screen.bx + r.x * screen.zoom, top: screen.by + r.y * screen.zoom, width: Math.max(160, r.w * screen.zoom), height: Math.max(40, r.h * screen.zoom), zIndex: 45, fontSize: (item.style.fontSize ?? 16) * screen.zoom }}
      placeholder={item.type === 'note' ? 'Note…' : 'Text…'}
    />
  );
}
