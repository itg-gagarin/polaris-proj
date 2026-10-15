import { route } from '@/server/http';
import { requireSession } from '@/server/auth';
import { assertCanView, loadRevision } from '@/server/service';

export const GET = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const { revision, product } = await loadRevision(repo, (await params).id);
  assertCanView(user, product);
  return { events: await repo.listAudit({ workspaceId: workspace.id, productId: product.id, limit: 300 }), revisionId: revision.id };
});
