import { route, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';

/** Read a stored file (detail drawings) for signed-in workspace members. */
export const GET = route(async (req) => {
  const { user, repo } = await requireSession(req);
  if (user.external) throw new HttpError(403, 'Not available to external users');
  const uri = new URL(req.url).searchParams.get('uri');
  if (!uri) throw new HttpError(400, 'uri required');
  const f = await repo.getFile(uri);
  if (!f) throw new HttpError(404, 'File not found');
  return new Response(Buffer.from(f.bytes), { headers: { 'content-type': f.file.mime, 'cache-control': 'private, max-age=3600', 'content-disposition': `inline; filename="${f.file.name}"` } });
});
