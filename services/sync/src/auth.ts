import { createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from '@bom/domain';
import { can } from '@bom/domain';
import type { Repository } from '@bom/db';

export interface SyncEnv {
  AUTH_PROVIDER?: string;
  SUPABASE_JWT_SECRET?: string;
  /** Shared by the web app and the sync service: signs browser sync tokens and internal calls. */
  SYNC_TOKEN_SECRET?: string;
}

export interface SyncContext {
  user: User;
  workspaceId: string;
  /** What this connection may write. Read-only connections still receive updates and awareness. */
  readOnly: boolean;
  doc: DocRef;
}

export type DocRef = { kind: 'board'; id: string } | { kind: 'revision'; id: string };

export class SyncAuthError extends Error {}

/**
 * Two document kinds (ADR 0006):
 *   board:<boardId>        frames, markup, sticky notes — every workspace member writes
 *   revision:<revisionId>  draft content — only roles with editGeometry/editBom, and only while editable
 * Splitting them lets the socket enforce who may change product data; Yjs has no per-key write checks.
 */
export function parseDocName(name: string): DocRef {
  const m = /^(board|revision):([A-Za-z0-9_.-]{1,128})$/.exec(name);
  if (!m) throw new SyncAuthError(`Unknown document "${name}"`);
  return { kind: m[1] as DocRef['kind'], id: m[2] };
}

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** HS256 JWT check (Supabase signs access tokens with the project JWT secret). */
export function verifyHs256(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new SyncAuthError('Malformed token');
  const header = JSON.parse(b64url(parts[0]).toString('utf8')) as { alg?: string };
  if (header.alg !== 'HS256') throw new SyncAuthError('Unsupported token algorithm');
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = b64url(parts[2]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new SyncAuthError('Bad token signature');
  const claims = JSON.parse(b64url(parts[1]).toString('utf8')) as Record<string, unknown>;
  if (typeof claims.exp === 'number' && claims.exp < nowSec) throw new SyncAuthError('Token expired');
  return claims;
}

/** Token the web app gives a signed-in browser for the sync socket (10 minutes; providers re-fetch on reconnect). */
export function mintSyncToken(userId: string, secret: string, ttlSec = 600): string {
  return signHs256({ scope: 'sync', app_user_id: userId, exp: Math.floor(Date.now() / 1000) + ttlSec }, secret);
}

/** Service-to-service call from the web app to the sync service (internal endpoints). */
export function mintInternalToken(secret: string, ttlSec = 60): string {
  return signHs256({ scope: 'internal', exp: Math.floor(Date.now() / 1000) + ttlSec }, secret);
}

export function verifyInternalToken(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  try {
    return verifyHs256(header.slice(7), secret).scope === 'internal';
  } catch {
    return false;
  }
}

/** Test helper / dev tooling: mint an HS256 token. */
export function signHs256(claims: Record<string, unknown>, secret: string): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/**
 * Token → app user id.
 *   AUTH_PROVIDER=dev (default): token is "dev:<userId>" — the dev user picker; never enable in production.
 *   AUTH_PROVIDER=supabase: a Supabase access token. The app user id is read from the `app_user_id`
 *   claim (added by a custom access token hook from app.members.auth_user_id), falling back to `sub`.
 */
export function userIdFromToken(token: string, env: SyncEnv): string {
  // With a shared secret the web app hands each signed-in browser a short-lived token (/api/sync-token).
  const provider = env.AUTH_PROVIDER ?? (env.SYNC_TOKEN_SECRET ? 'app' : 'dev');
  if (provider === 'app') {
    if (!env.SYNC_TOKEN_SECRET) throw new SyncAuthError('SYNC_TOKEN_SECRET is not set');
    const c = verifyHs256(token, env.SYNC_TOKEN_SECRET);
    if (c.scope !== 'sync' || typeof c.app_user_id !== 'string') throw new SyncAuthError('Not a sync token');
    return c.app_user_id;
  }
  if (provider === 'dev') {
    if (!token.startsWith('dev:')) throw new SyncAuthError('Dev auth expects a "dev:<userId>" token');
    return token.slice(4);
  }
  if (provider === 'supabase') {
    if (!env.SUPABASE_JWT_SECRET) throw new SyncAuthError('SUPABASE_JWT_SECRET is not set');
    const c = verifyHs256(token, env.SUPABASE_JWT_SECRET);
    const id = (c.app_user_id ?? c.sub) as string | undefined;
    if (!id) throw new SyncAuthError('Token has no user id');
    return id;
  }
  throw new SyncAuthError(`Unknown AUTH_PROVIDER "${provider}"`);
}

export async function authorize(repo: Repository, token: string, documentName: string, env: SyncEnv): Promise<SyncContext> {
  const doc = parseDocName(documentName);
  const userId = userIdFromToken(token, env);
  const user = await repo.getUser(userId);
  if (!user) throw new SyncAuthError('Unknown user');

  let workspaceId: string;
  let readOnly: boolean;
  if (doc.kind === 'board') {
    const board = await repo.getBoard(doc.id);
    if (!board) throw new SyncAuthError('Unknown board');
    workspaceId = board.workspaceId;
    // External users comment through threads on shared products only, not on the internal board.
    readOnly = user.external || !can(user, 'comment').allowed;
  } else {
    const rev = await repo.getRevision(doc.id);
    if (!rev) throw new SyncAuthError('Unknown revision');
    const product = await repo.getProduct(rev.productId);
    if (!product) throw new SyncAuthError('Unknown product');
    workspaceId = product.workspaceId;
    const editable = rev.state !== 'released';
    readOnly = user.external || !editable || !(can(user, 'editGeometry').allowed || can(user, 'editBom').allowed);
  }
  const ws = await repo.getWorkspace(workspaceId);
  if (!ws || !ws.memberIds.includes(user.id)) throw new SyncAuthError('Not a member of this workspace');
  return { user, workspaceId, readOnly, doc };
}
