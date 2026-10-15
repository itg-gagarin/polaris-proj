import { route } from '@/server/http';
import { requireSession } from '@/server/auth';
import { revisionBundle } from '@/server/service';

export const GET = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  return revisionBundle(repo, user, workspace, (await params).id);
});
