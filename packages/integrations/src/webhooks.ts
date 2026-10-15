/**
 * Public webhooks (PRD §10): revision released, lane approved, comment created.
 * Payloads are signed with HMAC-SHA256 (header X-BomStudio-Signature: t=<unix>,v1=<hex>).
 */
import type { Fetcher, DeliveryResult } from './http';
import { defaultFetcher } from './http';

export type WebhookEvent =
  | { type: 'revision.released'; productId: string; productCode: string; revisionId: string; label: string; at: string }
  | { type: 'lane.approved'; revisionId: string; team: string; reviewerId: string; at: string }
  | { type: 'lane.changes_requested'; revisionId: string; team: string; comment: string; at: string }
  | { type: 'comment.created'; threadId: string; revisionId: string; authorId: string; at: string };

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent['type'][];
  secret: string;
  active: boolean;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signPayload(secret: string, body: string, ts = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${ts},v1=${await hmacHex(secret, `${ts}.${body}`)}`;
}

/** Receivers verify the signature and reject stale timestamps (replay protection). */
export async function verifySignature(secret: string, body: string, header: string, toleranceS = 300, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const m = header.match(/t=(\d+),v1=([0-9a-f]+)/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (Math.abs(now - ts) > toleranceS) return false;
  const expected = await hmacHex(secret, `${ts}.${body}`);
  if (expected.length !== m[2].length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}

export async function deliverWebhook(event: WebhookEvent, subs: WebhookSubscription[], fetcher: Fetcher = defaultFetcher): Promise<DeliveryResult[]> {
  const targets = subs.filter((s) => s.active && s.events.includes(event.type));
  const body = JSON.stringify({ event: event.type, data: event });
  return Promise.all(
    targets.map(async (s) => {
      try {
        const r = await fetcher(s.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bomstudio-event': event.type, 'x-bomstudio-signature': await signPayload(s.secret, body) }, body });
        return { ok: r.ok, status: r.status, target: s.url };
      } catch (e) {
        return { ok: false, status: 0, target: s.url, error: (e as Error).message };
      }
    }),
  );
}
