'use client';
/**
 * Live workspace: the board document (frames, markup, presence) and one document per open revision.
 *
 * Sync modes
 *   local  (default): BroadcastChannel between tabs on this machine; every local history step is
 *          sent to the API as a patch (the API re-checks permissions, resets lanes, audits).
 *   server (NEXT_PUBLIC_SYNC_URL set): Hocuspocus; the sync server persists and snapshots every 30 s,
 *          so the client does not post patches (suggestions still go to the API).
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  Y, Awareness, ChannelProvider, broadcastChannel, attachOfflinePersistence, applyPatchToDoc, boardItems, createUserUndo, initRevision, readRevision, revisionMaps, syncDocTo, watchLostWrites,
  acquireLock, releaseLocks, allLocks, activeLock, setPresence, peers, type PresenceState, type PartLock,
} from '@bom/collab';
import type { BoardItem, Patch, RevisionContent, User, WorkspaceSettings } from '@bom/domain';
import { classifyPatch, contentHash, diffToPatch, makePatch } from '@bom/domain';
import { analyze, type Analysis } from '@bom/engine';
import { api, ApiError, postPatch, type RevisionBundle } from './api';

/** Local-mode offline queue: patches not yet acknowledged by the API, per revision and browser. */
const pendingKey = (revisionId: string, userId: string) => `bom:pending:${userId}:${revisionId}`;
function readPending(revisionId: string, userId: string): Patch[] {
  try {
    return JSON.parse(localStorage.getItem(pendingKey(revisionId, userId)) ?? '[]') as Patch[];
  } catch {
    return [];
  }
}
function writePending(revisionId: string, userId: string, ps: Patch[]) {
  try {
    if (ps.length) localStorage.setItem(pendingKey(revisionId, userId), JSON.stringify(ps));
    else localStorage.removeItem(pendingKey(revisionId, userId));
  } catch {
    /* storage full or disabled */
  }
}

type Listener = () => void;

class Emitter {
  private ls = new Set<Listener>();
  version = 0;
  subscribe = (l: Listener) => {
    this.ls.add(l);
    return () => this.ls.delete(l);
  };
  emit() {
    this.version++;
    for (const l of this.ls) l();
  }
}

interface Provider {
  awareness: Awareness;
  destroy(): void;
  whenSynced: Promise<void>;
  readOnly(): boolean;
}

function makeProvider(name: string, doc: Y.Doc, syncUrl: string | null, userId: string): Provider {
  if (syncUrl) {
    let resolve!: () => void;
    const whenSynced = new Promise<void>((r) => (resolve = r));
    const p = new HocuspocusProvider({ url: syncUrl, name, document: doc, token: `dev:${userId}`, onSynced: ({ state }) => state && resolve() });
    return { awareness: p.awareness!, destroy: () => p.destroy(), whenSynced, readOnly: () => p.authorizedScope === 'readonly' };
  }
  const p = new ChannelProvider(doc, broadcastChannel(`bom:${name}`));
  // Peers answer within a tick; with no peer the doc starts from the server row.
  const whenSynced = new Promise<void>((r) => setTimeout(r, 120));
  return { awareness: p.awareness, destroy: () => p.destroy(), whenSynced, readOnly: () => false };
}

export class RevisionLive extends Emitter {
  readonly doc = new Y.Doc();
  provider: Provider | null = null;
  undo: Y.UndoManager | null = null;
  bundle: RevisionBundle | null = null;
  content: RevisionContent | null = null;
  analysis: Analysis | null = null;
  error: string | null = null;
  locks: PartLock[] = [];
  private lastContent: RevisionContent | null = null;
  private analyzeTimer: ReturnType<typeof setTimeout> | null = null;
  private persistQueue: Promise<unknown> = Promise.resolve();
  private offs: (() => void)[] = [];

  constructor(readonly id: string, private ws: LiveWorkspace) {
    super();
  }

  get readOnly(): boolean {
    const r = this.bundle?.revision;
    return !r || r.state === 'released' || this.ws.user.external || this.ws.user.role === 'viewer' || this.ws.user.role === 'reviewer' || !!this.provider?.readOnly();
  }

  async load(): Promise<void> {
    try {
      this.bundle = await api<RevisionBundle>(`/api/revisions/${this.id}`);
    } catch (e) {
      this.error = (e as Error).message;
      this.emit();
      return;
    }
    const name = `revision:${this.id}`;
    // Offline queue (PRD §12): edits made without a connection live in IndexedDB and merge on reconnect.
    try {
      const idb = await attachOfflinePersistence(this.doc, `bom-${name}`);
      this.offs.push(idb.destroy);
      await Promise.race([idb.whenSynced, new Promise((r) => setTimeout(r, 500))]);
    } catch {
      /* private mode: no IndexedDB */
    }
    this.provider = makeProvider(name, this.doc, this.ws.syncUrl, this.ws.user.id);
    await this.provider.whenSynced;
    const meta = revisionMaps(this.doc, this.id).meta;
    if (!meta.get('initialised')) initRevision(this.doc, this.id, this.bundle.revision.content, 'server');
    else if (!this.ws.syncUrl && meta.get('savedHash') !== contentHash(this.bundle.revision.content)) {
      // The row moved on while this browser was away (another user, the AI, a restore): reconcile field by field.
      syncDocTo(this.doc, this.id, this.bundle.revision.content, 'server');
    }
    this.doc.transact(() => meta.set('savedHash', contentHash(this.bundle!.revision.content)), 'server');
    const pending = this.ws.syncUrl ? [] : readPending(this.id, this.ws.user.id);
    if (pending.length) {
      // Edits made offline: start from the server row, replay them, and send them again.
      syncDocTo(this.doc, this.id, this.bundle.revision.content, 'server');
      writePending(this.id, this.ws.user.id, []);
      for (const p of pending) {
        try {
          applyPatchToDoc(this.doc, this.id, p, 'replay');
          this.persist(p);
        } catch {
          /* the part it touched is gone */
        }
      }
      this.ws.toast(`Re-sent ${pending.length} offline edit(s)`, 'info');
    }
    this.undo = createUserUndo(this.doc, [this.id], this.ws.origin);
    this.lastContent = readRevision(this.doc, this.id);
    this.content = this.lastContent;
    this.recompute(true);

    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      const next = readRevision(this.doc, this.id);
      if (!next) return;
      const prev = this.lastContent;
      this.lastContent = next;
      this.content = next;
      this.locks = allLocks(this.doc);
      const local = origin === this.ws.origin || origin === this.undo;
      if (local && prev && !this.ws.syncUrl) this.persist(diffToPatch(prev, next, origin === this.undo ? 'Undo / redo' : this.pendingReason ?? 'Edit'));
      this.pendingReason = null;
      this.recompute(false);
    };
    this.doc.on('update', onUpdate);
    this.offs.push(() => this.doc.off('update', onUpdate));
    this.offs.push(watchLostWrites(this.doc, this.id, this.ws.origin, (l) => this.ws.onLostWrite?.(this, l)));
    this.locks = allLocks(this.doc);
    this.emit();
  }

  private pendingReason: string | null = null;

  private recompute(now: boolean) {
    const run = () => {
      if (!this.content) return;
      this.analysis = analyze(this.content, this.ws.settings);
      this.emit();
    };
    if (this.analyzeTimer) clearTimeout(this.analyzeTimer);
    if (now) run();
    else {
      this.emit();
      this.analyzeTimer = setTimeout(run, 16);
    }
  }

  private persist(patch: Patch) {
    if (!patch.ops.length) return;
    writePending(this.id, this.ws.user.id, [...readPending(this.id, this.ws.user.id), patch]);
    this.ws.setSaving(+1);
    const done = () => writePending(this.id, this.ws.user.id, readPending(this.id, this.ws.user.id).filter((p) => p.id !== patch.id));
    this.persistQueue = this.persistQueue
      .then(() => postPatch(this.id, patch))
      .then((r) => {
        done();
        this.ws.setOnline(true);
        if (this.bundle) this.bundle = { ...this.bundle, revision: { ...this.bundle.revision, state: r.revision.state, updatedAt: r.revision.updatedAt }, reviews: r.reviews };
        this.doc.transact(() => revisionMaps(this.doc, this.id).meta.set('savedHash', contentHash(r.revision.content)), 'server');
        if (r.resetLanes.length) this.ws.toast(`Review lanes reset: ${r.resetLanes.join(', ')}`, 'info');
        this.emit();
      })
      .catch(async (e: Error) => {
        if (e instanceof ApiError) {
          // The server refused it (permissions, released, conflict): drop it and show the saved state.
          done();
          this.ws.toast(e.message, 'error');
          await this.refresh(true).catch(() => {});
        } else {
          // Network: keep it queued; it is sent again on reconnect or reload.
          this.ws.setOnline(false);
        }
      })
      .finally(() => this.ws.setSaving(-1));
  }

  /** Send queued offline patches (called when the browser comes back online). */
  flushPending() {
    if (this.ws.syncUrl) return;
    const pending = readPending(this.id, this.ws.user.id);
    writePending(this.id, this.ws.user.id, []);
    for (const p of pending) this.persist(p);
  }

  /**
   * Edit as the current user. Ops outside the user's scope become suggestions for the owning team
   * (API), denied ops are refused before they reach the shared document.
   */
  edit(patch: Patch): { applied: number; suggested: number; denied: string[] } {
    if (!this.content || !this.bundle) return { applied: 0, suggested: 0, denied: ['Not loaded'] };
    if (this.readOnly) {
      this.ws.toast(this.bundle.revision.state === 'released' ? 'Released revisions are read-only. Start the next draft to edit.' : 'You cannot edit this revision', 'error');
      return { applied: 0, suggested: 0, denied: ['read-only'] };
    }
    const cls = classifyPatch(this.ws.user, this.content, patch, this.ws.settings, this.bundle.revision.state);
    const lockedByOthers = cls.direct.filter((op) => 'partId' in op && activeLock(this.doc, op.partId) && activeLock(this.doc, op.partId)!.userId !== this.ws.user.id);
    if (lockedByOthers.length) {
      const l = activeLock(this.doc, (lockedByOthers[0] as { partId: string }).partId)!;
      this.ws.toast(`Locked by ${l.userName}`, 'error');
      return { applied: 0, suggested: 0, denied: ['locked'] };
    }
    if (cls.denied.length) {
      this.ws.toast(cls.denied[0].reason, 'error');
      return { applied: 0, suggested: 0, denied: cls.denied.map((d) => d.reason) };
    }
    if (cls.direct.length) {
      this.pendingReason = patch.reason;
      applyPatchToDoc(this.doc, this.id, makePatch(cls.direct, patch.reason, patch.source, { ruleId: patch.ruleId, confidence: patch.confidence }), this.ws.origin);
      if (this.ws.syncUrl) this.ws.setSaving(0);
    }
    const suggestedOps = cls.suggestions.flatMap((s) => s.ops);
    if (suggestedOps.length) {
      void postPatch(this.id, makePatch(suggestedOps, patch.reason, patch.source))
        .then((r) => {
          this.ws.toast(`Saved as a suggestion for ${cls.suggestions.map((s) => s.team).join(', ')}`, 'info');
          if (this.bundle) this.bundle = { ...this.bundle, threads: [...this.bundle.threads, ...r.suggestions] };
          this.emit();
        })
        .catch((e: Error) => this.ws.toast(e.message, 'error'));
    }
    return { applied: cls.direct.length, suggested: suggestedOps.length, denied: [] };
  }

  /** Apply content the server already saved (AI accept, suggestion accept) without re-posting it. */
  applyServerContent(content: RevisionContent) {
    syncDocTo(this.doc, this.id, content, 'server');
    this.doc.transact(() => revisionMaps(this.doc, this.id).meta.set('savedHash', contentHash(content)), 'server');
  }

  async refresh(resetContent = false) {
    this.bundle = await api<RevisionBundle>(`/api/revisions/${this.id}`);
    if (resetContent) this.applyServerContent(this.bundle.revision.content);
    this.emit();
  }

  setBundle(b: RevisionBundle) {
    this.bundle = b;
    this.emit();
  }

  lock(partIds: string[]) {
    const r = acquireLock(this.doc, partIds, this.ws.user);
    if (r.blocked.length) this.ws.toast(`Locked by ${r.blocked[0].userName}`, 'error');
    this.locks = allLocks(this.doc);
    this.emit();
  }

  unlock(partIds?: string[]) {
    releaseLocks(this.doc, this.ws.user.id, partIds);
    this.locks = allLocks(this.doc);
    this.emit();
  }

  destroy() {
    for (const f of this.offs) f();
    this.undo?.destroy();
    this.provider?.destroy();
    this.doc.destroy();
  }
}

export class LiveWorkspace extends Emitter {
  /** Transaction origin for this user's edits (per-user undo tracks only this). */
  readonly origin = { kind: 'user' };
  readonly boardDoc = new Y.Doc();
  boardProvider: Provider | null = null;
  boardUndo: Y.UndoManager | null = null;
  items: BoardItem[] = [];
  revisions = new Map<string, RevisionLive>();
  saving = 0;
  onLostWrite: ((r: RevisionLive, l: { partId: string; field: string; yours: unknown; theirs: unknown }) => void) | null = null;
  toast: (text: string, kind?: 'info' | 'error' | 'success') => void = () => {};
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly boardId: string, readonly user: User, public settings: WorkspaceSettings, readonly syncUrl: string | null, initialItems: BoardItem[]) {
    super();
    this.items = initialItems;
  }

  get awareness(): Awareness | null {
    return this.boardProvider?.awareness ?? null;
  }

  async connect() {
    const name = `board:${this.boardId}`;
    this.boardProvider = makeProvider(name, this.boardDoc, this.syncUrl, this.user.id);
    await this.boardProvider.whenSynced;
    const map = boardItems(this.boardDoc);
    if (map.size === 0 && this.items.length) this.boardDoc.transact(() => this.items.forEach((it) => map.set(it.id, it)), 'server');
    this.boardUndo = createUserUndo(this.boardDoc, [], this.origin);
    const read = () => {
      this.items = [...map.values()].sort((a, b) => a.z - b.z);
      this.emit();
    };
    map.observe((_e, tr) => {
      read();
      if (tr.origin === this.origin || tr.origin === this.boardUndo) this.scheduleBoardSave();
    });
    read();
    setPresence(this.boardProvider.awareness, { user: { id: this.user.id, name: this.user.name, color: this.user.color, team: this.user.teams[0] ?? 'design' }, cursor: null, selection: [], view: null, presenting: null, following: null, laser: null, ink: null } as PresenceState);
    this.boardProvider.awareness.on('change', () => this.emit());
  }

  /** Send a pending board save now (tab close): keepalive lets the request outlive the page. */
  flushBoardSave() {
    if (!this.saveTimer || this.syncUrl) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void fetch(`/api/boards/${this.boardId}`, { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: this.items }) }).catch(() => {});
  }

  private scheduleBoardSave() {
    if (this.syncUrl) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.setSaving(+1);
      api(`/api/boards/${this.boardId}`, { method: 'PUT', json: { items: this.items } })
        .catch((e: Error) => this.toast(e.message, 'error'))
        .finally(() => this.setSaving(-1));
    }, 600);
  }

  online = true;

  setOnline(v: boolean) {
    if (this.online === v) return;
    this.online = v;
    this.emit();
  }

  flushPending() {
    for (const r of this.revisions.values()) r.flushPending();
  }

  setSaving(d: number) {
    this.saving = Math.max(0, this.saving + d);
    this.emit();
  }

  /** Board writes go through here so per-user undo sees them. */
  writeItems(fn: (m: Y.Map<BoardItem>) => void) {
    this.boardDoc.transact(() => fn(boardItems(this.boardDoc)), this.origin);
  }

  revision(id: string): RevisionLive {
    let r = this.revisions.get(id);
    if (!r) {
      r = new RevisionLive(id, this);
      this.revisions.set(id, r);
      r.subscribe(() => this.emit());
      void r.load();
    }
    return r;
  }

  presence(patch: Partial<PresenceState>) {
    if (this.awareness) setPresence(this.awareness, patch);
  }

  peers() {
    return this.awareness ? peers(this.awareness) : [];
  }

  destroy() {
    for (const r of this.revisions.values()) r.destroy();
    this.boardUndo?.destroy();
    this.boardProvider?.destroy();
    this.boardDoc.destroy();
  }
}
