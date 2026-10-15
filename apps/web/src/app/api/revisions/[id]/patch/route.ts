import type { Patch } from '@bom/domain';
import { route, body } from '@/server/http';
import { requireSession } from '@/server/auth';
import { applyUserPatch } from '@/server/service';

/** Local sync mode persistence: the client sends each history step; the server re-checks permissions. */
export const POST = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const { patch } = await body<{ patch: Patch }>(req);
  return applyUserPatch(repo, user, workspace, (await params).id, { ...patch, authorId: user.id });
});
