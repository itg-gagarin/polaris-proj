import { route, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';

/** Data ownership (PRD §12): everything for the workspace as JSON. */
export const GET = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  if (user.external) throw new HttpError(403, 'Not available to external users');
  const data = await repo.exportAll(workspace.id);
  return new Response(JSON.stringify(data, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="bom-studio-${workspace.id}-${new Date().toISOString().slice(0, 10)}.json"` } });
});
