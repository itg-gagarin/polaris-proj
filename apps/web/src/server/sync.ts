import type { Patch } from '@bom/domain';
import { mintInternalToken } from '@bom/sync/auth';

/**
 * Talking to the sync service. On Vercel, `SYNC_URL` is the service binding (the sync service's
 * internal base URL, injected at runtime into functions); elsewhere set it yourself (e.g. http://localhost:1234).
 */
export const syncServiceUrl = (): string | null => process.env.SYNC_URL ?? null;

/**
 * Public WebSocket URL the browser uses. Explicit SYNC_PUBLIC_URL / NEXT_PUBLIC_SYNC_URL win; with a sync
 * binding present it defaults to the same-origin path the vercel.json rewrite sends to the sync service.
 */
export function publicSyncUrl(): string | null {
  return process.env.SYNC_PUBLIC_URL || process.env.NEXT_PUBLIC_SYNC_URL || (syncServiceUrl() ? '/sync/ws' : null);
}

/**
 * A patch the API just saved (AI accept, suggestion, waiver, REST edit): send it to the sync service, which
 * applies it on top of the live document. Resetting the document to the row instead would drop live edits
 * not yet snapshotted. Best effort: if sync is down, the document reconciles from the row when next loaded.
 */
export async function notifySyncPatch(revisionId: string, patch: Patch, userId: string): Promise<void> {
  const base = syncServiceUrl();
  const secret = process.env.SYNC_TOKEN_SECRET;
  if (!base || !secret) return;
  try {
    const url = new URL(`internal/revisions/${encodeURIComponent(revisionId)}/patch`, base.endsWith('/') ? base : `${base}/`);
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${mintInternalToken(secret)}`, 'content-type': 'application/json' }, body: JSON.stringify({ patch, userId }), signal: AbortSignal.timeout(3000) });
    if (!res.ok) console.warn(`[sync] patch ${revisionId}: HTTP ${res.status}`);
  } catch (e) {
    console.warn(`[sync] patch ${revisionId} failed: ${(e as Error).message}`);
  }
}
