import { HocuspocusProvider } from '@hocuspocus/provider';
import { revisionMaps, Y } from '@bom/collab';

export interface LoadTestOptions {
  url: string;
  revisionId: string;
  /** Part whose `notes` field each client writes in turn. */
  partId: string;
  clients?: number;
  rounds?: number;
  tokenFor: (i: number) => string;
  timeoutMs?: number;
}

export interface LoadTestResult {
  clients: number;
  samples: number;
  p50: number;
  p95: number;
  max: number;
  /** Every client ended with identical document state. */
  converged: boolean;
}

export interface ConnectedClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
}

export function connectClient(url: string, name: string, token: string, timeoutMs = 10_000): Promise<ConnectedClient> {
  const doc = new Y.Doc();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sync timeout for ${name}`)), timeoutMs);
    const provider = new HocuspocusProvider({
      url,
      name,
      document: doc,
      token,
      onSynced: ({ state }) => {
        if (!state) return;
        clearTimeout(t);
        resolve({ doc, provider });
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(t);
        provider.destroy();
        reject(new Error(`auth failed: ${reason}`));
      },
    });
  });
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0;
};

/**
 * PRD §13 phase-3 gate: 25 people on one board, edits reach everyone in under 500 ms.
 * Each client in turn writes one field; latency is measured until the last of the other clients sees it.
 */
export async function runLoadTest(o: LoadTestOptions): Promise<LoadTestResult> {
  const n = o.clients ?? 25;
  const rounds = o.rounds ?? 2;
  const name = `revision:${o.revisionId}`;
  const clients = await Promise.all(Array.from({ length: n }, (_, i) => connectClient(o.url, name, o.tokenFor(i), o.timeoutMs)));
  const samples: number[] = [];
  try {
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < n; i++) {
        const value = `edit r${r} c${i} ${Math.random().toString(36).slice(2, 8)}`;
        const seen = clients.map((c, j) =>
          j === i
            ? Promise.resolve()
            : new Promise<void>((resolve, reject) => {
                const part = () => revisionMaps(c.doc, o.revisionId).parts.get(o.partId);
                const t = setTimeout(() => reject(new Error(`client ${j} never saw edit from ${i}`)), o.timeoutMs ?? 10_000);
                const check = () => {
                  if (part()?.get('notes') === value) {
                    clearTimeout(t);
                    c.doc.off('update', check);
                    resolve();
                  }
                };
                c.doc.on('update', check);
              }),
        );
        const t0 = performance.now();
        revisionMaps(clients[i].doc, o.revisionId).parts.get(o.partId)!.set('notes', value);
        await Promise.all(seen);
        samples.push(performance.now() - t0);
      }
    }
    const states = clients.map((c) => Buffer.from(Y.encodeStateVector(c.doc)).toString('base64'));
    return { clients: n, samples: samples.length, p50: round(pct(samples, 50)), p95: round(pct(samples, 95)), max: round(Math.max(...samples)), converged: new Set(states).size === 1 };
  } finally {
    for (const c of clients) c.provider.destroy();
  }
}

const round = (x: number) => Math.round(x * 10) / 10;
