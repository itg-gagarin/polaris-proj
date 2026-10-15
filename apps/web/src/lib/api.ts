'use client';
import type { Board, Product, Revision, Thread, User, Workspace, AppNotification, Review, Patch } from '@bom/domain';
import type { CheckResult } from '@bom/db';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export type RevisionSummary = Omit<Revision, 'content'> & { parts: number; family: string };

export interface Bootstrap {
  user: User;
  workspace: Workspace;
  users: User[];
  products: Product[];
  revisions: RevisionSummary[];
  boards: Board[];
  notifications: AppNotification[];
  syncUrl: string | null;
  ai: { provider: string; enabled: boolean };
}

export interface RevisionBundle {
  revision: Revision;
  product: Product;
  reviews: Review[];
  threads: Thread[];
  check: CheckResult | null;
  siblings: Pick<Revision, 'id' | 'label' | 'state' | 'branch' | 'updatedAt' | 'parentRevisionId' | 'submittedHash' | 'releasedAt'>[];
}

export interface PatchResult {
  revision: Revision;
  reviews: Review[];
  resetLanes: string[];
  suggestions: Thread[];
  summary: CheckResult['summary'] | null;
}

export const postPatch = (revisionId: string, patch: Patch) => api<PatchResult>(`/api/revisions/${revisionId}/patch`, { method: 'POST', json: { patch } });
export const revisionAction = (revisionId: string, body: Record<string, unknown>) => api<RevisionBundle>(`/api/revisions/${revisionId}/action`, { method: 'POST', json: body });
export const threadAction = (threadId: string, body: Record<string, unknown>) => api<{ thread: Thread }>(`/api/threads/${threadId}`, { method: 'POST', json: body });

export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
