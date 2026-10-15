import * as Y from 'yjs';

export interface PartLock {
  partId: string;
  userId: string;
  userName: string;
  at: number;
  /** Refreshed on activity; the lock lapses after this. */
  expiresAt: number;
}

export const LOCK_IDLE_MS = 30 * 60 * 1000;

const locksMap = (doc: Y.Doc) => doc.getMap<PartLock>('locks');

export function activeLock(doc: Y.Doc, partId: string, now = Date.now()): PartLock | null {
  const l = locksMap(doc).get(partId);
  return l && l.expiresAt > now ? l : null;
}

/** Lock a part (or an assembly's parts) so others can't edit it while you work (PRD §9). */
export function acquireLock(doc: Y.Doc, partIds: string[], user: { id: string; name: string }, idleMs = LOCK_IDLE_MS, now = Date.now()): { ok: string[]; blocked: PartLock[] } {
  const ok: string[] = [];
  const blocked: PartLock[] = [];
  doc.transact(() => {
    for (const id of partIds) {
      const l = activeLock(doc, id, now);
      if (l && l.userId !== user.id) {
        blocked.push(l);
        continue;
      }
      locksMap(doc).set(id, { partId: id, userId: user.id, userName: user.name, at: l?.at ?? now, expiresAt: now + idleMs });
      ok.push(id);
    }
  }, 'locks');
  return { ok, blocked };
}

export function releaseLocks(doc: Y.Doc, userId: string, partIds?: string[]): void {
  doc.transact(() => {
    for (const [id, l] of locksMap(doc).entries()) if (l.userId === userId && (!partIds || partIds.includes(id))) locksMap(doc).delete(id);
  }, 'locks');
}

/** Activity keeps your locks alive. */
export function touchLocks(doc: Y.Doc, userId: string, idleMs = LOCK_IDLE_MS, now = Date.now()): void {
  doc.transact(() => {
    for (const [id, l] of locksMap(doc).entries()) if (l.userId === userId && l.expiresAt > now) locksMap(doc).set(id, { ...l, expiresAt: now + idleMs });
  }, 'locks');
}

export function canEdit(doc: Y.Doc, partId: string, userId: string, now = Date.now()): boolean {
  const l = activeLock(doc, partId, now);
  return !l || l.userId === userId;
}

export function allLocks(doc: Y.Doc, now = Date.now()): PartLock[] {
  return [...locksMap(doc).values()].filter((l) => l.expiresAt > now);
}
