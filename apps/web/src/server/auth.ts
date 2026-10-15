import { cookies } from 'next/headers';
import type { User, Workspace } from '@bom/domain';
import { userIdFromToken } from '@bom/sync/auth';
import { getRepo, repoFor } from './context';
import { HttpError } from './http';

export const USER_COOKIE = 'bom_user';
export const SUPABASE_COOKIE = 'sb-access-token';

export interface Session {
  user: User;
  workspace: Workspace;
  /** Supabase auth uid (null with dev auth). */
  authUid: string | null;
}

/**
 * AUTH_PROVIDER=dev (default): the user picker sets a cookie with the app user id. Never deploy this.
 * AUTH_PROVIDER=supabase: the Supabase access token (cookie sb-access-token or Authorization: Bearer).
 */
export async function getSession(req?: Request): Promise<Session | null> {
  const provider = process.env.AUTH_PROVIDER ?? 'dev';
  const jar = await cookies();
  let userId: string | null = null;
  let authUid: string | null = null;
  try {
    if (provider === 'dev') {
      userId = jar.get(USER_COOKIE)?.value ?? null;
    } else {
      const bearer = req?.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? jar.get(SUPABASE_COOKIE)?.value;
      if (!bearer) return null;
      userId = userIdFromToken(bearer, process.env as Record<string, string | undefined>);
      authUid = userId;
    }
  } catch {
    return null;
  }
  if (!userId) return null;
  const repo = await getRepo();
  const user = await repo.getUser(userId);
  if (!user) return null;
  const workspace = (await repo.listWorkspaces()).find((w) => w.memberIds.includes(user.id));
  if (!workspace) return null;
  return { user, workspace, authUid };
}

export async function requireSession(req?: Request): Promise<Session & { repo: Awaited<ReturnType<typeof repoFor>> }> {
  const s = await getSession(req);
  if (!s) throw new HttpError(401, 'Sign in first');
  return { ...s, repo: await repoFor(s.authUid) };
}
