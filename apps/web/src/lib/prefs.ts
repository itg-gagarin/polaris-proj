'use client';
import { create } from 'zustand';

/**
 * Personal preferences, kept in this browser (each person sets their own). Workspace-wide settings
 * (check thresholds) live on the server and are edited by leads in Settings → Workspace.
 */
export type UiMode = 'simple' | 'advanced';
export type TextSize = 'normal' | 'large' | 'xl';
export type Theme = 'light' | 'dark' | 'system';
export type Quality = 'high' | 'fast';
export type GuideStep = 'pick' | 'edit' | 'checks' | 'review';

export interface Prefs {
  mode: UiMode;
  textSize: TextSize;
  theme: Theme;
  quality: Quality;
  /** Hover explanations on buttons. */
  hints: boolean;
  guideHidden: boolean;
  guideDone: GuideStep[];
  showFasteners: boolean;
}

const KEY = 'bom.prefs.v1';
export const DEFAULT_PREFS: Prefs = { mode: 'simple', textSize: 'normal', theme: 'light', quality: 'high', hints: true, guideHidden: false, guideDone: [], showFasteners: false };

function load(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

interface PrefsState extends Prefs {
  setPrefs: (p: Partial<Prefs>) => void;
  markGuide: (s: GuideStep) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...DEFAULT_PREFS,
  setPrefs: (p) => {
    set(p);
    save(get());
  },
  markGuide: (s) => {
    if (get().guideDone.includes(s)) return;
    set({ guideDone: [...get().guideDone, s] });
    save(get());
  },
}));

function save(s: Prefs) {
  try {
    const { mode, textSize, theme, quality, hints, guideHidden, guideDone, showFasteners } = s;
    localStorage.setItem(KEY, JSON.stringify({ mode, textSize, theme, quality, hints, guideHidden, guideDone, showFasteners }));
  } catch {
    /* private window or blocked storage: preferences last for this visit only */
  }
}

/** Read stored preferences once on the client (after hydration) and apply theme + text size. */
export function hydratePrefs(): void {
  usePrefs.setState(load());
  applyPrefs(usePrefs.getState());
  usePrefs.subscribe((s) => applyPrefs(s));
}

const ZOOM: Record<TextSize, number> = { normal: 1, large: 1.15, xl: 1.3 };

export function applyPrefs(p: Prefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (p.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', p.theme);
  root.style.setProperty('--ui-zoom', String(ZOOM[p.textSize]));
  root.dataset.mode = p.mode;
}
