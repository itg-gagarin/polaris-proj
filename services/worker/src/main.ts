/**
 * Background worker: `pnpm worker`. Runs imports, exports, AI optimize runs, digests, ERP pushes
 * and webhook deliveries from the job queue, and enqueues the daily digest at DIGEST_HOUR_UTC.
 * With QUEUE_BACKEND=memory the queue lives in this process (useful only together with the API
 * in one process); use QUEUE_BACKEND=postgres for a separate worker.
 */
import { createRepository } from '@bom/db';
import { createDeps, createQueue } from './factory';
import { jobs, Worker } from './runner';

const env = process.env;
const repo = await createRepository(env);
const queue = await createQueue(env);
const log = (msg: string, data?: Record<string, unknown>) => console.log(`[worker] ${msg}`, data ? JSON.stringify(data) : '');
const worker = new Worker({ queue, deps: { ...createDeps(env, repo), log }, log });
worker.start(Number(env.WORKER_POLL_MS ?? 1000));
log('started', { id: worker.id, queue: env.QUEUE_BACKEND ?? 'memory', repo: repo.kind });

const digestHour = Number(env.DIGEST_HOUR_UTC ?? 1);
const digestTimer = setInterval(async () => {
  if (new Date().getUTCHours() !== digestHour) return;
  for (const ws of await repo.listWorkspaces()) await jobs.digest(queue, { workspaceId: ws.id });
}, 10 * 60_000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    worker.stop();
    clearInterval(digestTimer);
    process.exit(0);
  });
}
