'use client';
import { create } from 'zustand';
import type { SuggestedRevision } from '@bom/ai';
import type { Locale } from './i18n';

export type MarkupTool = 'hand' | 'select' | 'rect' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'pencil' | 'text' | 'note' | 'eraser' | 'laser' | 'frame';
export type ModelTool = 'move' | 'rotate' | 'resize' | 'measure' | 'dimension' | 'section' | 'explode' | 'addPart';
export type Tool = MarkupTool | ModelTool;
export type Shading = 'solid' | 'material' | 'wireframe' | 'xray';
export type Lens = 'none' | 'painting' | 'hardware' | 'engineering' | 'packing';
export type ViewName = 'iso' | 'front' | 'back' | 'side' | 'top';
export type LeftTab = 'products' | 'outliner' | 'layers';
export type RightTab = 'properties' | 'comments' | 'review' | 'ai' | 'meeting' | 'history';
export type LayerMode = 'team' | 'material' | 'l1';

export interface FrameView {
  shading: Shading;
  lens: Lens;
  explode: number;
  section: { axis: 'x' | 'y' | 'z'; at: number } | null;
  view: ViewName;
  /** Bumped to ask the frame to re-frame its camera (F, numpad views). */
  frameNonce: number;
  /** Camera shared through presence for follow mode. */
  camera: { position: [number, number, number]; target: [number, number, number] } | null;
}

export const defaultFrameView = (props: Record<string, unknown> = {}): FrameView => ({
  shading: (props.shading as Shading) ?? 'material',
  lens: (props.lens as Lens) ?? 'none',
  explode: 0,
  section: null,
  view: (props.view as ViewName) ?? 'iso',
  frameNonce: 0,
  camera: null,
});

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface Measurement {
  revisionId: string;
  a: { partId: string; point: [number, number, number] };
  b: { partId: string; point: [number, number, number] } | null;
}

interface UiState {
  locale: Locale;
  tool: Tool;
  toolLocked: boolean;
  board: { x: number; y: number; zoom: number };
  activeFrameId: string | null;
  activeRevisionId: string | null;
  /** A selection is shared across all frames (PRD §5). */
  selection: { revisionId: string | null; partIds: string[] };
  /** Entered assembly (double-click), Esc leaves. */
  enteredAssembly: string | null;
  selectedItems: string[];
  hidden: Record<string, string[]>;
  isolated: Record<string, string[] | null>;
  layerHidden: Record<string, boolean>;
  layerMode: LayerMode;
  frameViews: Record<string, FrameView>;
  snap: boolean;
  ortho: boolean;
  gridMm: number;
  cursorMm: [number, number, number] | null;
  leftTab: LeftTab;
  rightTab: RightTab;
  leftOpen: boolean;
  rightOpen: boolean;
  paletteOpen: boolean;
  importOpen: boolean;
  meetingSetupOpen: boolean;
  toasts: Toast[];
  ai: { running: boolean; suggestion: SuggestedRevision | null; accepted: string[]; error: string | null };
  meetingId: string | null;
  following: string | null;
  measure: Measurement | null;
  /** Dimension tool: first picked point, waiting for the second. */
  dimStart: { frameId: string; key: string; offset: [number, number, number] } | null;
  /** Timeline scrub: show an older revision read-only in the active frames. */
  historyRevisionId: string | null;
  saving: number;
  online: boolean;
  /** Bumped whenever a 3D camera moves so pinned markup re-projects. */
  projectionTick: number;
  set: (p: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => void;
  select: (revisionId: string | null, partIds: string[], additive?: boolean) => void;
  frameView: (frameId: string, props?: Record<string, unknown>) => FrameView;
  setFrameView: (frameId: string, p: Partial<FrameView>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  locale: 'en',
  tool: 'select',
  toolLocked: false,
  board: { x: 40, y: 80, zoom: 0.55 },
  activeFrameId: null,
  activeRevisionId: null,
  selection: { revisionId: null, partIds: [] },
  enteredAssembly: null,
  selectedItems: [],
  hidden: {},
  isolated: {},
  layerHidden: {},
  layerMode: 'team',
  frameViews: {},
  snap: true,
  ortho: false,
  gridMm: 5,
  cursorMm: null,
  leftTab: 'outliner',
  rightTab: 'properties',
  leftOpen: true,
  rightOpen: true,
  paletteOpen: false,
  importOpen: false,
  meetingSetupOpen: false,
  toasts: [],
  ai: { running: false, suggestion: null, accepted: [], error: null },
  meetingId: null,
  following: null,
  measure: null,
  dimStart: null,
  historyRevisionId: null,
  saving: 0,
  online: true,
  projectionTick: 0,
  set: (p) => set(typeof p === 'function' ? p(get()) : p),
  select: (revisionId, partIds, additive = false) =>
    set((s) => {
      if (additive && s.selection.revisionId === revisionId) {
        const cur = new Set(s.selection.partIds);
        for (const id of partIds) (cur.has(id) ? cur.delete(id) : cur.add(id));
        return { selection: { revisionId, partIds: [...cur] }, activeRevisionId: revisionId ?? s.activeRevisionId };
      }
      return { selection: { revisionId, partIds }, activeRevisionId: revisionId ?? s.activeRevisionId };
    }),
  frameView: (frameId, props) => get().frameViews[frameId] ?? defaultFrameView(props),
  setFrameView: (frameId, p) => set((s) => ({ frameViews: { ...s.frameViews, [frameId]: { ...(s.frameViews[frameId] ?? defaultFrameView()), ...p } } })),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 4000);
  },
}));
