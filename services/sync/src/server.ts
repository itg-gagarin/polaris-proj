import { Server, type Document } from '@hocuspocus/server';
import { applyPatchToDoc, boardItems, revisionMaps, syncDocTo, Y } from '@bom/collab';
import type { Repository } from '@bom/db';
import type { BoardItem, Patch } from '@bom/domain';
import { contentHash } from '@bom/domain';
import { authorize, parseDocName, verifyInternalToken, type SyncContext, type SyncEnv } from './auth';
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
  /**
   * A patch the web API already saved to the revision row: apply it on top of the live document (if open)
   * so unsaved live edits and the API change both survive; the next snapshot writes the combination.
   */
  applyApiPatch(revisionId: string, patch: Patch, userId: string): Promise<'applied' | 'not-open' | 'skipped'>;
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

    /**
     * HTTP on the same port: GET …/health, and POST …/internal/revisions/:id/patch from the web app
     * (signed with SYNC_TOKEN_SECRET). Matched by suffix so a public path prefix (/sync) does not matter.
     */
    async onRequest({ request, response }) {
      const url = new URL(request.url ?? '/', 'http://sync.local');
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.method === 'GET' && url.pathname.endsWith('/health')) {
        reply(200, { ok: true, documents: server.hocuspocus.getDocumentsCount(), connections: server.hocuspocus.getConnectionsCount() });
        throw null; // handled: stop the default response
      }
      const m = /\/internal\/revisions\/([A-Za-z0-9_.-]{1,128})\/patch$/.exec(url.pathname);
      if (request.method === 'POST' && m) {
        if (!verifyInternalToken(request.headers.authorization, env.SYNC_TOKEN_SECRET)) {
          reply(401, { error: 'unauthorized' });
          throw null;
        }
        let body: { patch?: Patch; userId?: string };
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const c of request) {
            size += (c as Buffer).length;
            if (size > 2_000_000) throw new Error('too large');
            chunks.push(c as Buffer);
          }
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          reply(400, { error: 'bad body' });
          throw null;
        }
        if (!body.patch?.ops || typeof body.userId !== 'string') {
          reply(400, { error: 'patch and userId required' });
          throw null;
        }
        reply(200, { result: await applyApiPatch(m[1], body.patch, body.userId) });
        throw null;
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

  async function applyApiPatch(revisionId: string, patch: Patch, userId: string): Promise<'applied' | 'not-open' | 'skipped'> {
    const name = `revision:${revisionId}`;
    const document = server.hocuspocus.documents.get(name);
    // Not open: the row already has the change; the next load reconciles from the row (savedHash differs).
    if (!document) return 'not-open';
    try {
      applyPatchToDoc(document, revisionId, patch, { userId, source: patch.source });
    } catch (e) {
      // e.g. the part was removed live in the meantime: the live state wins, the snapshot records it.
      log('api-patch-skipped', { revisionId, error: (e as Error).message });
      return 'skipped';
    }
    let s = editors.get(name);
    if (!s) editors.set(name, (s = new Set()));
    s.add(userId);
    log('api-patch', { revisionId, ops: patch.ops.length });
    return 'applied';
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
    applyApiPatch,
    async stop() {
      if (timer) clearInterval(timer);
      await snapshotAll();
      server.hocuspocus.flushPendingStores();
      await server.destroy();
    },
  };
}
