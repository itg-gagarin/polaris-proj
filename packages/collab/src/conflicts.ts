import * as Y from 'yjs';
import { revisionMaps } from './schema';

export interface LostWrite {
  partId: string;
  field: string;
  yours: unknown;
  theirs: unknown;
}

/**
 * Last write wins; the loser sees a toast with the value they lost (PRD §9).
 * Remembers the user's own recent writes and reports when a remote change overwrites one.
 */
export function watchLostWrites(doc: Y.Doc, revisionId: string, localOrigin: unknown, onLost: (l: LostWrite) => void, windowMs = 10_000): () => void {
  const r = revisionMaps(doc, revisionId);
  const mine = new Map<string, { value: unknown; at: number }>();
  const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    for (const ev of events) {
      if (!(ev.target instanceof Y.Map) || ev.target === r.parts) continue;
      const partId = [...r.parts.entries()].find(([, m]) => m === ev.target)?.[0];
      if (!partId) continue;
      for (const key of (ev as Y.YMapEvent<unknown>).keysChanged) {
        const k = `${partId}|${key}`;
        const value = (ev.target as Y.Map<unknown>).get(key);
        if (tr.origin === localOrigin) {
          mine.set(k, { value, at: Date.now() });
        } else {
          const m = mine.get(k);
          if (m && Date.now() - m.at < windowMs && JSON.stringify(m.value) !== JSON.stringify(value)) {
            onLost({ partId, field: key, yours: m.value, theirs: value });
            mine.delete(k);
          }
        }
      }
    }
  };
  r.parts.observeDeep(handler);
  return () => r.parts.unobserveDeep(handler);
}
