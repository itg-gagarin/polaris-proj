import { jobs } from '@bom/worker';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { getQueue } from '@/server/context';

/** Background jobs: batch exports and AI runs; GET ?id= polls a job. */
export const GET = route(async (req) => {
  await requireSession(req);
  const id = new URL(req.url).searchParams.get('id');
  if (!id) throw new HttpError(400, 'id required');
  const job = await (await getQueue()).get(id);
  if (!job) throw new HttpError(404, 'Job not found');
  const { payload: _p, ...rest } = job;
  return { job: rest };
});

export const POST = route(async (req) => {
  const { user } = await requireSession(req);
  const b = await body<{ kind: 'export' | 'ai-optimize'; revisionId: string; format?: string }>(req);
  const q = await getQueue();
  const job = b.kind === 'export' ? await jobs.export(q, { revisionId: b.revisionId, format: (b.format ?? 'step') as never, userId: user.id, team: user.teams[0] }) : await jobs.optimize(q, { revisionId: b.revisionId, userId: user.id });
  return { jobId: job.id };
});
