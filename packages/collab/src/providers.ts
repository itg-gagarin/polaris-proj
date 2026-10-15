import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';

/** Minimal message channel (BroadcastChannel in the browser, an in-memory hub in tests). */
export interface Channel {
  post(msg: unknown): void;
  onMessage(fn: (msg: unknown) => void): () => void;
  close(): void;
}

type Msg =
  | { t: 'update'; from: number; u: Uint8Array }
  | { t: 'sync-req'; from: number; sv: Uint8Array; reply?: boolean }
  | { t: 'sync-res'; from: number; to: number; u: Uint8Array }
  | { t: 'aw'; from: number; u: Uint8Array };

/**
 * Peer-to-peer provider over a broadcast channel: multiplayer between tabs/windows on one machine
 * with no server. With NEXT_PUBLIC_SYNC_URL set, the Hocuspocus provider is used instead.
 */
export class ChannelProvider {
  readonly awareness: Awareness;
  private off: (() => void)[] = [];
  synced = false;

  constructor(readonly doc: Y.Doc, private channel: Channel, awareness?: Awareness) {
    this.awareness = awareness ?? new Awareness(doc);
    const id = doc.clientID;
    const onUpdate = (u: Uint8Array, origin: unknown) => {
      if (origin !== this) channel.post({ t: 'update', from: id, u } satisfies Msg);
    };
    doc.on('update', onUpdate);
    this.off.push(() => doc.off('update', onUpdate));
    const onAw = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === this) return;
      const changed = [...added, ...updated, ...removed];
      channel.post({ t: 'aw', from: id, u: encodeAwarenessUpdate(this.awareness, changed) } satisfies Msg);
    };
    this.awareness.on('update', onAw);
    this.off.push(() => this.awareness.off('update', onAw));
    this.off.push(
      channel.onMessage((raw) => {
        const m = raw as Msg;
        if (!m || m.from === id) return;
        if (m.t === 'update') Y.applyUpdate(doc, m.u, this);
        else if (m.t === 'sync-req') {
          channel.post({ t: 'sync-res', from: id, to: m.from, u: Y.encodeStateAsUpdate(doc, m.sv) } satisfies Msg);
          // Two-way handshake: ask the newcomer for what it has that we don't.
          if (!m.reply) channel.post({ t: 'sync-req', from: id, sv: Y.encodeStateVector(doc), reply: true } satisfies Msg);
          channel.post({ t: 'aw', from: id, u: encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]) } satisfies Msg);
        } else if (m.t === 'sync-res' && m.to === id) {
          Y.applyUpdate(doc, m.u, this);
          this.synced = true;
        } else if (m.t === 'aw') applyAwarenessUpdate(this.awareness, m.u, this);
      }),
    );
    channel.post({ t: 'sync-req', from: id, sv: Y.encodeStateVector(doc) } satisfies Msg);
  }

  destroy(): void {
    removeAwarenessStates(this.awareness, [this.awareness.clientID], 'destroy');
    for (const f of this.off) f();
    this.channel.close();
  }
}

export function broadcastChannel(name: string): Channel {
  const bc = new BroadcastChannel(name);
  return {
    post: (m) => bc.postMessage(m),
    onMessage: (fn) => {
      const h = (e: MessageEvent) => fn(e.data);
      bc.addEventListener('message', h);
      return () => bc.removeEventListener('message', h);
    },
    close: () => bc.close(),
  };
}

/** In-memory hub: connects providers in one process (tests, load tests, server-side bots). */
export class MemoryHub {
  private subs = new Set<(m: unknown) => void>();
  latencyMs = 0;
  channel(): Channel {
    let fn: ((m: unknown) => void) | null = null;
    const deliver = (m: unknown) => fn?.(m);
    return {
      post: (m) => {
        for (const s of this.subs) if (s !== deliver) (this.latencyMs ? setTimeout(() => s(m), this.latencyMs) : s(m));
      },
      onMessage: (f) => {
        fn = f;
        this.subs.add(deliver);
        return () => this.subs.delete(deliver);
      },
      close: () => this.subs.delete(deliver),
    };
  }
}

/** Offline queue: edits made without a connection persist in IndexedDB and merge on reconnect (browser only). */
export async function attachOfflinePersistence(doc: Y.Doc, name: string): Promise<{ destroy: () => void; whenSynced: Promise<unknown> }> {
  const { IndexeddbPersistence } = await import('y-indexeddb');
  const p = new IndexeddbPersistence(name, doc);
  return { destroy: () => void p.destroy(), whenSynced: p.whenSynced };
}
