import { cookies } from 'next/headers';
import { route, body, HttpError } from '@/server/http';
import { getSession, USER_COOKIE } from '@/server/auth';
import { getRepo } from '@/server/context';

// The first request on a fresh database migrates and seeds the demo (serverless cold start).
export const maxDuration = 60;

/** Dev auth: list users for the picker; POST signs in as one (AUTH_PROVIDER=dev only). */
export const GET = route(async (req) => {
  const session = await getSession(req);
  const repo = await getRepo();
  const ws = (await repo.listWorkspaces())[0];
  const users = ws ? await repo.listUsers(ws.id) : [];
  return { session: session && { user: session.user, workspaceId: session.workspace.id }, users, authProvider: process.env.AUTH_PROVIDER ?? 'dev' };
});

export const POST = route(async (req) => {
  if ((process.env.AUTH_PROVIDER ?? 'dev') !== 'dev') throw new HttpError(400, 'Sign in through Supabase');
  const { userId } = await body<{ userId: string }>(req);
  const user = await (await getRepo()).getUser(userId);
  if (!user) throw new HttpError(404, 'Unknown user');
  (await cookies()).set(USER_COOKIE, user.id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return { user };
});

export const DELETE = route(async () => {
  (await cookies()).delete(USER_COOKIE);
  return { ok: true };
});
