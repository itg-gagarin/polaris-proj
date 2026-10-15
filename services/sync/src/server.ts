import { Server, type Document } from '@hocuspocus/server';
import { applyPatchToDoc, boardItems, revisionMaps, syncDocTo, Y } from '@bom/collab';
import type { Repository } from '@bom/db';
import type { BoardItem, Patch } from '@bom/domain';
import { contentHash } from '@bom/domain';
import { authorize, parseDocName, type SyncContext, type SyncEnv } from './auth';
import { snapshotRevision, type SnapshotResult } from './snapshot';

export interface SyncServerOptions {
  repo: Repository;
  env?: SyncEnv;
  port?: number;
  /** PRD §11: draft snapshot + server check run. Default 30 s; 0 disables the timer (tests call snapshotAll). */
  snapshotMs?: number;
  /** Raw Yjs state persistence debounce (board_docs). */
  storeDebounceMs?: number;
  storeMaxDebounceMs?: number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface SyncServer {
  server: Server<SyncContext>;
  url: string;
  /** Snapshot every loaded revision document now. */
  snapshotAll(): Promise<SnapshotResult[]>;
  /** Apply a patch to a revision as a server-side edit (REST/AI accept while the document is live). */
  applyServerPatch(revisionId: string, patch: Patch, userId: string): Promise<void>;
  stop(): Promise<void>;
}

const SERVER_ORIGIN = 'server';

export async function startSyncServer(opts: SyncServerOptions): Promise<SyncServer> {
  const { repo } = opts;
  const env = opts.env ?? {};
  const log = opts.log ?? (() => {});
  /** Editors since the last snapshot, per document. */
  const editors = new Map<string, Set<string>>();

  const server = new Server<SyncContext>({
    port: opts.port ?? 1234,
    quiet: true,
    debounce: opts.storeDebounceMs ?? 2000,
    maxDebounce: opts.storeMaxDebounceMs ?? 10_000,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const ctx = await authorize(repo, token, documentName, env);
      connectionConfig.readOnly = ctx.readOnly;
      log('auth', { user: ctx.user.id, doc: documentName, readOnly: ctx.readOnly });
      return ctx;
    },

    async onLoadDocument({ document, documentName }) {
      const ref = parseDocName(documentName);
      const stored = await repo.getBoardDoc(documentName);
      if (stored) Y.applyUpdate(document, stored, SERVER_ORIGIN);
      if (ref.kind === 'board') {
        const items = boardItems(document);
        if (!stored && items.size === 0) {
          const board = await repo.getBoard(ref.id);
          document.transact(() => {
            for (const it of board?.items ?? []) items.set(it.id, it);
          }, SERVER_ORIGIN);
        }
      } else {
        const rev = await repo.getRevision(ref.id);
        if (rev) {
          // The row is authoritative when it changed after the document was last saved (REST edit, restore).
          const meta = revisionMaps(document, ref.id).meta;
          const rowHash = contentHash(rev.content);
          if (meta.get('savedHash') !== rowHash) {
            const writes = syncDocTo(document, ref.id, rev.content, SERVER_ORIGIN);
            document.transact(() => meta.set('savedHash', rowHash), SERVER_ORIGIN);
            if (stored && writes) log('reconciled', { doc: documentName, writes });
          }
        }
      }
      return document;
    },

    async onChange({ documentName, context, transactionOrigin }) {
      if (transactionOrigin === SERVER_ORIGIN || !context?.user) return;
      let s = editors.get(documentName);
      if (!s) editors.set(documentName, (s = new Set()));
      s.add(context.user.id);
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      const ws = (lastContext as SyncContext | undefined)?.workspaceId ?? (await workspaceOf(documentName));
      if (!ws) return;
      await repo.saveBoardDoc(documentName, ws, Y.encodeStateAsUpdate(document));
      const ref = parseDocName(documentName);
      if (ref.kind === 'board') {
        const board = await repo.getBoard(ref.id);
        if (board) await repo.upsertBoard({ ...board, items: [...boardItems(document).values()] as BoardItem[] });
      }
    },

    async beforeUnloadDocument({ documentName, document }) {
      const ref = parseDocName(documentName);
      if (ref.kind === 'revision') await snapshotOne(documentName, document);
    },
  });

  async function workspaceOf(documentName: string): Promise<string | null> {
    const ref = parseDocName(documentName);
    if (ref.kind === 'board') return (await repo.getBoard(ref.id))?.workspaceId ?? null;
    const rev = await repo.getRevision(ref.id);
    return rev ? ((await repo.getProduct(rev.productId))?.workspaceId ?? null) : null;
  }

  async function snapshotOne(documentName: string, document: Y.Doc): Promise<SnapshotResult | null> {
    const ref = parseDocName(documentName);
    if (ref.kind !== 'revision') return null;
    const who = [...(editors.get(documentName) ?? [])];
    const res = await snapshotRevision(repo, document, ref.id, who);
    if (res.status === 'saved') {
      editors.delete(documentName);
      document.transact(() => revisionMaps(document, ref.id).meta.set('savedHash', res.hash), SERVER_ORIGIN);
      log('snapshot', { ...res });
    }
    return res;
  }

  let running = false;
  async function snapshotAll(): Promise<SnapshotResult[]> {
    if (running) return [];
    running = true;
    try {
      const out: SnapshotResult[] = [];
      for (const [name, doc] of server.hocuspocus.documents) {
        try {
          const r = await snapshotOne(name, doc);
          if (r) out.push(r);
        } catch (e) {
          log('snapshot-error', { doc: name, error: (e as Error).message });
        }
      }
      return out;
    } finally {
      running = false;
    }
  }

  async function applyServerPatch(revisionId: string, patch: Patch, userId: string): Promise<void> {
    const name = `revision:${revisionId}`;
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      await conn.transact((doc: Document) => applyPatchToDoc(doc, revisionId, patch, { userId, source: patch.source }));
      let s = editors.get(name);
      if (!s) editors.set(name, (s = new Set()));
      s.add(userId);
    } finally {
      await conn.disconnect();
    }
  }

  await server.listen();
  const ms = opts.snapshotMs ?? 30_000;
  const timer = ms > 0 ? setInterval(() => void snapshotAll(), ms) : null;
  timer?.unref?.();

  return {
    server,
    url: server.webSocketURL,
    snapshotAll,
    applyServerPatch,
    async stop() {
      if (timer) clearInterval(timer);
      await snapshotAll();
      server.hocuspocus.flushPendingStores();
      await server.destroy();
    },
  };
}
