import { route, body } from '@/server/http';
import { requireSession } from '@/server/auth';

export const GET = route(async (req) => {
  const { user, repo } = await requireSession(req);
  return { notifications: await repo.listNotifications(user.id) };
});

export const POST = route(async (req) => {
  const { user, repo } = await requireSession(req);
  const { read } = await body<{ read: string[] }>(req);
  await repo.markNotificationsRead(user.id, read);
  return { notifications: await repo.listNotifications(user.id) };
});
