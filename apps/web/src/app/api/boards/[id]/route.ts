import type { BoardItem } from '@bom/domain';
import { route, body, HttpError, notFound } from '@/server/http';
import { requireSession } from '@/server/auth';

export const GET = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const b = await repo.getBoard((await params).id);
  if (!b || b.workspaceId !== workspace.id || user.external) throw notFound('Board');
  return { board: b };
});

/** Local sync mode: the board items are saved from the client (with Hocuspocus the sync server saves them). */
export const PUT = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const b = await repo.getBoard((await params).id);
  if (!b || b.workspaceId !== workspace.id) throw notFound('Board');
  if (user.external || user.role === 'viewer') throw new HttpError(403, 'Read-only');
  const { items } = await body<{ items: BoardItem[] }>(req);
  if (!Array.isArray(items) || items.length > 5000) throw new HttpError(400, 'Bad items');
  await repo.upsertBoard({ ...b, items });
  return { ok: true };
});
