'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Product, StdPart, User } from '@bom/domain';
import { api, type Bootstrap, type RevisionSummary } from './api';
import { LiveWorkspace, type RevisionLive } from './live';
import { translate, type MsgKey } from './i18n';
import { useUi } from './store';

export interface EditorCtx {
  boot: Bootstrap;
  setBoot: (b: Bootstrap) => void;
  live: LiveWorkspace;
  me: User;
  users: Map<string, User>;
  products: Map<string, Product>;
  revisions: Map<string, RevisionSummary>;
  dictionary: StdPart[] | null;
  loadDictionary: () => Promise<StdPart[]>;
  reloadBoot: () => Promise<void>;
}

const Ctx = createContext<EditorCtx | null>(null);

export function EditorProvider({ boot: initial, boardId, children }: { boot: Bootstrap; boardId: string; children: ReactNode }) {
  const [boot, setBoot] = useState(initial);
  const board = initial.boards.find((b) => b.id === boardId);
  const [live] = useState(() => new LiveWorkspace(boardId, initial.user, initial.workspace.settings, initial.syncUrl, board?.items ?? []));
  const [dictionary, setDictionary] = useState<StdPart[] | null>(null);
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    live.toast = toast;
    live.onLostWrite = (_r, l) => toast(`Your ${l.field} was overwritten by another editor (you had ${JSON.stringify(l.yours)}, now ${JSON.stringify(l.theirs)})`, 'info');
    void live.connect();
    const online = () => {
      live.setOnline(true);
      live.flushPending();
    };
    const offline = () => live.setOnline(false);
    const hide = () => live.flushBoardSave();
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      live.destroy();
    };
  }, [live, toast]);

  useEffect(() => {
    useUi.setState({ locale: boot.user.locale ?? 'en' });
  }, [boot.user.locale]);

  const loadDictionary = useCallback(async () => {
    if (dictionary) return dictionary;
    const r = await api<{ entries: StdPart[] }>('/api/dictionary');
    setDictionary(r.entries);
    return r.entries;
  }, [dictionary]);

  const reloadBoot = useCallback(async () => setBoot(await api<Bootstrap>('/api/bootstrap')), []);

  const value = useMemo<EditorCtx>(
    () => ({
      boot,
      setBoot,
      live,
      me: boot.user,
      users: new Map(boot.users.map((u) => [u.id, u])),
      products: new Map(boot.products.map((p) => [p.id, p])),
      revisions: new Map(boot.revisions.map((r) => [r.id, r])),
      dictionary,
      loadDictionary,
      reloadBoot,
    }),
    [boot, live, dictionary, loadDictionary, reloadBoot],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditor(): EditorCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEditor outside EditorProvider');
  return c;
}

/** Re-render on any live change (board items, presence, revision content). */
export function useLiveVersion(): number {
  const { live } = useEditor();
  return useSyncExternalStore(live.subscribe, () => live.version, () => 0);
}

/** Re-render on presence changes (cursors, people here, follow). */
export function usePresenceVersion(): number {
  const { live } = useEditor();
  return useSyncExternalStore(live.presenceBus.subscribe, () => live.presenceBus.version, () => 0);
}

export function useRevision(id: string | null | undefined): RevisionLive | null {
  const { live } = useEditor();
  const rev = id ? live.revision(id) : null;
  useSyncExternalStore(rev ? rev.subscribe : noopSub, () => rev?.version ?? 0, () => 0);
  return rev;
}

const noopSub = () => () => {};

export function useT() {
  const locale = useUi((s) => s.locale);
  return useCallback((k: MsgKey, vars?: Record<string, string | number>) => translate(locale, k, vars), [locale]);
}
