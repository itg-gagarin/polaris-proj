/**
 * Server-side singletons for route handlers: repository, AI provider, job queue + in-process worker.
 * Dev defaults: FileRepository at .data/db.json seeded with the Hollan House demo, dev auth (cookie),
 * MockProvider for AI, in-memory queue. Production: DATA_BACKEND=supabase, AUTH_PROVIDER=supabase,
 * AI_PROVIDER=claude, QUEUE_BACKEND=postgres with services/worker running separately.
 */
import type { Repository } from '@bom/db';
import { createRepository, SqlRepository } from '@bom/db';
import { createAiProvider, type AiProvider } from '@bom/ai';
import type { JobQueue } from '@bom/worker';
import { createDeps, createQueue, Worker } from '@bom/worker';

const ENV = process.env as Record<string, string | undefined>;

interface Ctx {
  repo: Promise<Repository>;
  ai: AiProvider;
  queue: Promise<JobQueue>;
  worker: Worker | null;
}

const g = globalThis as unknown as { __bom?: Ctx };

async function initRepo(): Promise<Repository> {
  const env = process.env;
  const repo = await createRepository({ DATA_BACKEND: env.DATA_BACKEND, DATA_FILE: env.DATA_FILE || env.BOM_DATA_FILE, DATABASE_URL: env.DATABASE_URL });
  if ((await repo.listWorkspaces()).length === 0) {
    const { seedDemo } = await import('@bom/db/seed');
    await seedDemo(repo);
  }
  return repo;
}

function ctx(): Ctx {
  if (!g.__bom) {
    const repo = initRepo();
    const queue = createQueue(ENV);
    g.__bom = { repo, ai: createAiProvider(ENV), queue, worker: null };
    // With the in-memory queue the worker must live in this process.
    if ((process.env.QUEUE_BACKEND ?? 'memory') === 'memory') {
      void Promise.all([repo, queue]).then(([r, q]) => {
        const w = new Worker({ queue: q, deps: createDeps(ENV, r) });
        w.start(500);
        g.__bom!.worker = w;
      });
    }
  }
  return g.__bom;
}

export const getRepo = () => ctx().repo;
export const getAi = () => ctx().ai;
export const getQueue = () => ctx().queue;

/** Per-request repository: under Supabase every query runs as the signed-in user (row-level security). */
export async function repoFor(authUid: string | null): Promise<Repository> {
  const r = await getRepo();
  return r instanceof SqlRepository && authUid ? r.as(authUid) : r;
}
