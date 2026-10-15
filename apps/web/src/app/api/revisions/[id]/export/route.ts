import type { Team } from '@bom/domain';
import { exportJob, type ExportFormat } from '@bom/worker';
import { route, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { assertCanView, loadRevision } from '@/server/service';

const FORMATS: ExportFormat[] = ['xlsx', 'json', 'pdf', 'personal-pdf', 'glb', 'dxf', 'step'];

/** Exports run inline for one revision (they take well under a second); batch exports go through the worker. */
export const GET = route(async (req, { params }) => {
  const { user, repo } = await requireSession(req);
  const id = (await params).id;
  const { product } = await loadRevision(repo, id);
  assertCanView(user, product);
  const sp = new URL(req.url).searchParams;
  const format = (sp.get('format') ?? 'xlsx') as ExportFormat;
  if (!FORMATS.includes(format)) throw new HttpError(400, `format must be one of ${FORMATS.join(', ')}`);
  const team = (sp.get('team') ?? user.teams[0] ?? 'design') as Team;
  const out = await exportJob({ revisionId: id, format, userId: user.id, team }, { repo, queue: null as never, ai: null, chat: null, erp: null, webhooks: [], baseUrl: new URL(req.url).origin });
  const file = await repo.getFile((out.result as { uri: string }).uri);
  if (!file) throw new HttpError(500, 'Export failed');
  return new Response(Buffer.from(file.bytes), { headers: { 'content-type': file.file.mime, 'content-disposition': `attachment; filename="${file.file.name}"` } });
});
