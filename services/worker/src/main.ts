/**
 * Background worker: `pnpm worker` (or the internal `worker` service on Vercel, see vercel.json).
 * Runs imports, exports, AI optimize runs, digests, ERP pushes and webhook deliveries from the job queue,
 * and enqueues the daily digest at DIGEST_HOUR_UTC. Needs the shared database: DATABASE_URL / POSTGRES_URL
 * with QUEUE_BACKEND=postgres (the default when a database URL is set). Answers GET /health on PORT so
 * container platforms can probe it; it serves nothing else.
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createRepository, findMigrationsDir } from '@bom/db';
import { createDeps, createQueue } from './factory';
import { jobs, Worker } from './runner';

const env = process.env;
const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
const repo = await createRepository({
  DATA_BACKEND: env.DATA_BACKEND ?? 'auto',
  DATA_FILE: env.DATA_FILE,
  DATABASE_URL: databaseUrl,
  DATABASE_SSL: env.DATABASE_SSL,
  MIGRATIONS_DIR: env.AUTO_MIGRATE === 'off' ? undefined : findMigrationsDir([env.BOM_MIGRATIONS_DIR, resolve(process.cwd(), 'supabase/migrations'), resolve(process.cwd(), '../../supabase/migrations')]),
});
const queueEnv = { ...env, DATABASE_URL: databaseUrl, QUEUE_BACKEND: env.QUEUE_BACKEND ?? (databaseUrl ? 'postgres' : 'memory') };
const queue = await createQueue(queueEnv);
const log = (msg: string, data?: Record<string, unknown>) => console.log(`[worker] ${msg}`, data ? JSON.stringify(data) : '');
const worker = new Worker({ queue, deps: { ...createDeps(env, repo), log }, log });
worker.start(Number(env.WORKER_POLL_MS ?? 1000));
log('started', { id: worker.id, queue: queueEnv.QUEUE_BACKEND, repo: repo.kind });

const health = createServer((req, res) => {
  const ok = req.method === 'GET' && (req.url ?? '').endsWith('/health');
  res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(ok ? { ok: true, worker: worker.id } : { error: 'not found' }));
});
health.listen(Number(env.PORT ?? env.WORKER_PORT ?? 8787));

const digestHour = Number(env.DIGEST_HOUR_UTC ?? 1);
const digestTimer = setInterval(async () => {
  if (new Date().getUTCHours() !== digestHour) return;
  for (const ws of await repo.listWorkspaces()) await jobs.digest(queue, { workspaceId: ws.id });
}, 10 * 60_000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    worker.stop();
    clearInterval(digestTimer);
    health.close();
    process.exit(0);
  });
}
