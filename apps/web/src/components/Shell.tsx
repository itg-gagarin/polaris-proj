'use client';
import { useEffect } from 'react';
import { makeAssembly, makePatch } from '@bom/domain';
import { useEditor, usePresenceVersion } from '@/lib/editor';
import { useUi, FOCUS_FRAME, type Tool } from '@/lib/store';
import { usePrefs } from '@/lib/prefs';
import { zoomFit, zoomIn, zoomOut, zoomReset } from '@/lib/zoom';
import { parseCommand } from '@/lib/commands';
import { runCommand } from '@/lib/exec';
import { cameraSetters } from '@/lib/registry';
import { onSummon } from '@bom/collab';
import { Toolbar } from './Toolbar';
import { Board } from './Board';
import { BottomBar } from './BottomBar';
import { FocusView } from './studio/FocusView';
import { TitleCard, ViewSwitcher, TopActions, SimpleTools, ZoomControl } from './studio/Chrome';
import { SettingsDialog, HelpDialog, AddHardwareDialog, GuideCard } from './studio/Dialogs';
import { FollowBanner } from './studio/Chrome';
import { Palette } from './Palette';
import { ImportDialog } from './ImportDialog';
import { LeftDock } from './panels/LeftDock';
import { RightDock } from './panels/RightDock';

const KEYS: Record<string, Tool> = { h: 'hand', v: 'select', r: 'rect', d: 'diamond', o: 'ellipse', a: 'arrow', l: 'line', p: 'pencil', t: 'text', n: 'note', e: 'eraser', w: 'move', s: 'resize', m: 'measure', x: 'section' };
const SHIFT_KEYS: Record<string, Tool> = { r: 'rotate', d: 'dimension', x: 'explode', a: 'addPart' };
const VIEW_KEYS: Record<string, string> = { '1': 'FRONT', '3': 'SIDE', '7': 'TOP', '0': 'ISO' };

/**
 * Figma-style studio: the canvas fills the window and the tools float over it as light cards.
 * Simple layout (default): one product at a time, few big tools. Advanced: the board with frames,
 * all tools and the command line (PRD §5–6).
 */
export function Shell() {
  useKeyboard();
  useFollow();
  const view = useUi((s) => s.view);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const mode = usePrefs((s) => s.mode);
  const guideOn = usePrefs((s) => !s.guideHidden) && mode === 'simple';
  const advanced = mode === 'advanced';
  return (
    <div className={`studio mode-${mode} ${leftOpen ? 'left-open' : 'left-closed'} ${rightOpen ? 'right-open' : 'right-closed'} view-${view} ${guideOn ? 'guide-on' : ''}`}>
      <div className="canvas">{view === 'board' ? <Board /> : <FocusView />}</div>
      <TitleCard />
      <ViewSwitcher />
      <TopActions />
      <LeftDock />
      <RightDock />
      {view === 'board' ? (
        <>
          <Toolbar />
          <ZoomControl />
        </>
      ) : (
        <SimpleTools />
      )}
      {advanced ? <BottomBar /> : <GuideCard />}
      <FollowBanner />
      <Palette />
      <ImportDialog />
      <SettingsDialog />
      <HelpDialog />
      <AddHardwareDialog />
      <Toasts />
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
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUi.getState();
      // Zoom: Ctrl/⌘ + / − / 0 zoom the view instead of the browser page, even from a text box.
      if (mod && !e.altKey && (k === '=' || k === '+' || e.code === 'NumpadAdd')) return (e.preventDefault(), zoomIn());
      if (mod && !e.altKey && (k === '-' || k === '_' || e.code === 'NumpadSubtract')) return (e.preventDefault(), zoomOut());
      if (mod && !e.altKey && k === '0') return (e.preventDefault(), zoomReset());
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.shiftKey && !mod && e.code === 'Digit1') return (e.preventDefault(), zoomFit(live.items));
      if (e.shiftKey && !mod && e.code === 'Digit0') return (e.preventDefault(), zoomReset());
      if (!mod && !e.altKey && !e.shiftKey && (k === '+' || k === '=')) return zoomIn();
      if (!mod && !e.altKey && !e.shiftKey && k === '-') return zoomOut();
      // The simple layout keeps only the few tools it shows (a stray "e" must not pick the eraser).
      const simple = usePrefs.getState().mode === 'simple';
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
        if (simple && tool !== 'addPart' && tool !== 'explode') return;
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
      if (simple && !['v', 'h', 'm'].includes(k)) return;
      if (!e.shiftKey && KEYS[k]) useUi.setState({ tool: KEYS[k], measure: KEYS[k] === 'measure' ? null : ui.measure });
    };
    // Capture: the zoom keys must win over the browser and over focused canvases.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [live]);
}

/** Follow mode: mirror the followed person's board view and active camera (PRD §9). */
function useFollow() {
  const { live } = useEditor();
  const v = usePresenceVersion();
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
  // Followers see what the person sees: product, view, take-apart, colours and selection (PRD §9 follow mode).
  useEffect(() => {
    if (!following) return;
    const p = live.peers().find((x) => x.user.id === following);
    if (!p) return;
    const ui = useUi.getState();
    const f = p.focus;
    if (f) {
      const patch: Partial<ReturnType<typeof useUi.getState>> = {};
      if (f.mainView && f.mainView !== ui.view) patch.view = f.mainView as never;
      if (f.revisionId && f.revisionId !== ui.activeRevisionId) patch.activeRevisionId = f.revisionId;
      if (Object.keys(patch).length) useUi.setState(patch);
      if (f.frame) {
        const cur = ui.frameViews[FOCUS_FRAME];
        const next = { explode: f.frame.explode, lens: f.frame.lens as never, view: f.frame.view as never, shading: f.frame.shading as never, section: f.frame.section };
        if (!cur || cur.explode !== next.explode || cur.lens !== next.lens || cur.view !== next.view || cur.shading !== next.shading || JSON.stringify(cur.section) !== JSON.stringify(next.section)) ui.setFrameView(FOCUS_FRAME, next);
      }
    }
    const sel = { revisionId: p.selRevisionId ?? null, partIds: p.selection ?? [] };
    if (sel.revisionId !== ui.selection.revisionId || sel.partIds.join() !== ui.selection.partIds.join()) useUi.setState({ selection: sel });
  }, [v, following, live]);
  // Publish what I look at (throttled), so others can follow me and see my selection.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = () => {
      timer = null;
      const s = useUi.getState();
      const fv = s.frameViews[FOCUS_FRAME];
      live.presence({
        selection: s.selection.partIds,
        selRevisionId: s.selection.revisionId,
        focus: { mainView: s.view, revisionId: s.activeRevisionId, frame: fv ? { explode: fv.explode, lens: fv.lens, view: fv.view, shading: fv.shading, section: fv.section } : null },
      });
    };
    publish();
    const unsub = useUi.subscribe((s, prev) => {
      if (s.selection === prev.selection && s.view === prev.view && s.activeRevisionId === prev.activeRevisionId && s.frameViews[FOCUS_FRAME] === prev.frameViews[FOCUS_FRAME]) return;
      if (!timer) timer = setTimeout(publish, 80);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [live]);
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
