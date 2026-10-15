'use client';
import { useEffect } from 'react';
import { makeAssembly, makePatch } from '@bom/domain';
import { useEditor, useLiveVersion } from '@/lib/editor';
import { useUi, type Tool } from '@/lib/store';
import { parseCommand } from '@/lib/commands';
import { runCommand } from '@/lib/exec';
import { cameraSetters } from '@/lib/registry';
import { onSummon } from '@bom/collab';
import { TopBar } from './TopBar';
import { Toolbar } from './Toolbar';
import { Board } from './Board';
import { BottomBar } from './BottomBar';
import { Palette } from './Palette';
import { ImportDialog } from './ImportDialog';
import { LeftDock } from './panels/LeftDock';
import { RightDock } from './panels/RightDock';

const KEYS: Record<string, Tool> = { h: 'hand', v: 'select', r: 'rect', d: 'diamond', o: 'ellipse', a: 'arrow', l: 'line', p: 'pencil', t: 'text', n: 'note', e: 'eraser', w: 'move', s: 'resize', m: 'measure', x: 'section' };
const SHIFT_KEYS: Record<string, Tool> = { r: 'rotate', d: 'dimension', x: 'explode', a: 'addPart' };
const VIEW_KEYS: Record<string, string> = { '1': 'FRONT', '3': 'SIDE', '7': 'TOP', '0': 'ISO' };

export function Shell() {
  const { live } = useEditor();
  useKeyboard();
  useFollow();
  return (
    <div className="shell">
      <TopBar />
      <LeftDock />
      <div style={{ gridArea: 'board', position: 'relative', minWidth: 0, minHeight: 0 }}>
        <Board />
        <Toolbar />
      </div>
      <RightDock />
      <BottomBar />
      <Palette />
      <ImportDialog />
      <Toasts />
      {!live && null}
    </div>
  );
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Keyboard map (PRD §6): Excalidraw keys for markup, model keys, numpad views, Ctrl shortcuts. */
function useKeyboard() {
  const { live } = useEditor();
  useEffect(() => {
    const cmd = (c: string) => {
      const r = parseCommand(c);
      if (!r.ok) return;
      try {
        const msg = runCommand(r.command, { live });
        if (/^(Gap|Nothing)/.test(msg)) useUi.getState().toast(msg);
      } catch (e) {
        useUi.getState().toast((e as Error).message, 'error');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUi.getState();
      if (mod && k === 'k') return (e.preventDefault(), useUi.setState({ paletteOpen: true }));
      if (mod && k === 'z') return (e.preventDefault(), cmd(e.shiftKey ? 'REDO' : 'UNDO'));
      if (mod && k === 'y') return (e.preventDefault(), cmd('REDO'));
      if (mod && k === 'm') return (e.preventDefault(), cmd('MIRROR'));
      if (mod && e.shiftKey && k === 'a') {
        e.preventDefault();
        const n = prompt('Array: count, step mm, axis (e.g. 5 76 X)');
        if (n) cmd(`ARRAY ${n}`);
        return;
      }
      if (mod && k === 'g') {
        e.preventDefault();
        const rev = ui.selection.revisionId ? live.revision(ui.selection.revisionId) : null;
        if (!rev?.content || ui.selection.partIds.length < 2) return ui.toast('Select two or more parts to group', 'error');
        const name = prompt('Assembly (L1) name');
        if (!name) return;
        const asm = makeAssembly({ name });
        rev.edit(makePatch([{ op: 'addAssembly', assembly: asm }, ...ui.selection.partIds.map((id) => ({ op: 'setField' as const, partId: id, field: 'assemblyId' as const, value: asm.id }))], `Group as ${name}`));
        return;
      }
      if (e.key === 'F3') return (e.preventDefault(), useUi.setState({ snap: !ui.snap }));
      if (e.key === 'F8') return (e.preventDefault(), useUi.setState({ ortho: !ui.ortho }));
      if (e.key === 'Escape') {
        if (ui.enteredAssembly) return useUi.setState({ enteredAssembly: null });
        if (ui.measure) return useUi.setState({ measure: null });
        return useUi.setState({ selection: { revisionId: null, partIds: [] }, selectedItems: [], tool: ui.toolLocked ? ui.tool : 'select' });
      }
      // Views: numpad 1/3/7/0, Alt+1/3/7/0 on laptops.
      if ((e.code.startsWith('Numpad') && VIEW_KEYS[e.code.slice(6)]) || (e.altKey && VIEW_KEYS[e.key])) {
        e.preventDefault();
        return cmd(`VIEW ${VIEW_KEYS[e.code.startsWith('Numpad') ? e.code.slice(6) : e.key]}`);
      }
      if (e.altKey && e.shiftKey && k === 'h') return cmd('SHOW');
      if (e.altKey && k === 'h') return (e.preventDefault(), cmd('HIDE'));
      if (e.shiftKey && k === 'i') return cmd('ISOLATE');
      if (mod || e.altKey) return;
      if (k === 'f') return cmd('FRAME');
      if (k === 'q') return useUi.setState({ toolLocked: !ui.toolLocked });
      if (e.shiftKey && SHIFT_KEYS[k]) {
        const tool = SHIFT_KEYS[k];
        if (tool === 'explode') {
          const f = ui.activeFrameId;
          if (f) ui.setFrameView(f, { explode: ui.frameView(f).explode > 0 ? 0 : 0.6 });
          return;
        }
        if (tool === 'addPart') {
          useUi.setState({ rightTab: 'properties', rightOpen: true });
          window.dispatchEvent(new CustomEvent('bom:add-part'));
          return;
        }
        return useUi.setState({ tool });
      }
      if (!e.shiftKey && KEYS[k]) useUi.setState({ tool: KEYS[k], measure: KEYS[k] === 'measure' ? null : ui.measure });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live]);
}

/** Follow mode: mirror the followed person's board view and active camera (PRD §9). */
function useFollow() {
  const { live } = useEditor();
  const v = useLiveVersion();
  const following = useUi((s) => s.following);
  useEffect(() => {
    if (!following) return;
    const p = live.peers().find((x) => x.user.id === following);
    if (!p?.view) return;
    const cur = useUi.getState().board;
    const b = p.view.board;
    if (b && (b.x !== cur.x || b.y !== cur.y || b.zoom !== cur.zoom)) useUi.setState({ board: b });
    if (p.view.frameId && p.view.camera) cameraSetters.get(p.view.frameId)?.(p.view.camera);
  }, [v, following, live]);
  // "Bring everyone here": everyone in the meeting jumps to the presenter's view and follows them.
  const meetingId = useUi((s) => s.meetingId);
  useEffect(() => {
    if (!meetingId) return;
    return onSummon(live.boardDoc, meetingId, (s) => {
      const me = live.user.id;
      if (s.by === me) return;
      const v = s.view as { board?: { x: number; y: number; zoom: number }; frameId?: string | null; camera?: { position: [number, number, number]; target: [number, number, number] } | null } | null;
      if (v?.board) useUi.setState({ board: v.board });
      if (v?.frameId && v.camera) cameraSetters.get(v.frameId)?.(v.camera);
      useUi.setState({ following: s.by });
      useUi.getState().toast('The presenter brought everyone here', 'info');
    });
  }, [meetingId, live]);
  // Share my board view so others can follow me.
  const board = useUi((s) => s.board);
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = (live.awareness?.getLocalState() as { view?: { frameId: string | null; camera: unknown } } | null)?.view;
      live.presence({ view: { frameId: cur?.frameId ?? null, camera: (cur?.camera as never) ?? null, board } });
    }, 80);
    return () => clearTimeout(t);
  }, [board, live]);
}
