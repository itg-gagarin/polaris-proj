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

import { after } from 'next/server';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV = process.env as Record<string, string | undefined>;
/** Vercel (and other serverless hosts): read-only code directory, no long-running loops. */
const SERVERLESS = !!ENV.VERCEL;
/**
 * Run due jobs inside the web function, after the response. Default on serverless: nothing there polls the
 * queue (on Vercel the worker service is request-driven, so it sleeps while nobody calls it).
 */
const INLINE_JOBS = (ENV.INLINE_JOBS ?? (SERVERLESS ? 'on' : 'off')) === 'on';

function migrationsDir(): string | undefined {
  const candidates = [ENV.BOM_MIGRATIONS_DIR, resolve(process.cwd(), 'supabase/migrations'), resolve(process.cwd(), '../../supabase/migrations')].filter((c): c is string => !!c);
  return candidates.find((c) => existsSync(c));
}

interface Ctx {
  repo: Promise<Repository>;
  ai: AiProvider;
  queue: Promise<JobQueue>;
  worker: Worker | null;
}

const g = globalThis as unknown as { __bom?: Ctx };

async function initRepo(): Promise<Repository> {
  const env = process.env;
  const repo = await createRepository({
    // auto: PostgreSQL when a database URL is present (Vercel's Neon/Supabase integrations inject one), else the file store.
    DATA_BACKEND: env.DATA_BACKEND ?? 'auto',
    // Serverless file systems are read-only except /tmp (and /tmp does not survive): use a database there.
    DATA_FILE: env.DATA_FILE || (SERVERLESS ? '/tmp/bom-studio-db.json' : env.BOM_DATA_FILE),
    DATABASE_URL: env.DATABASE_URL || env.POSTGRES_URL,
    DATABASE_SSL: env.DATABASE_SSL,
    // Fresh databases (Supabase, Neon) are migrated on first start; set AUTO_MIGRATE=off to manage it yourself.
    MIGRATIONS_DIR: env.AUTO_MIGRATE === 'off' ? undefined : migrationsDir(),
  });
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
    // With the in-memory queue the worker must live in this process (not on serverless: no background loops).
    if ((process.env.QUEUE_BACKEND ?? 'memory') === 'memory' && !SERVERLESS) {
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

/**
 * Call from a route handler that enqueued a job (or polls one): with INLINE_JOBS the due jobs run after the
 * response is sent. The queue claims with SKIP LOCKED, so this and a running worker service never run a job twice.
 */
export function kickJobs(max = 3): void {
  if (!INLINE_JOBS) return;
  after(async () => {
    try {
      const [repo, queue] = await Promise.all([ctx().repo, ctx().queue]);
      await queue.recoverStale(15 * 60_000);
      // Stay inside the function's time limit (maxDuration 60 s on the routes that call this).
      await new Worker({ queue, deps: createDeps(ENV, repo), timeoutMs: 45_000 }).drain(max);
    } catch (e) {
      console.error('inline jobs failed', (e as Error).message);
    }
  });
}

/** Per-request repository: under Supabase every query runs as the signed-in user (row-level security). */
export async function repoFor(authUid: string | null): Promise<Repository> {
  const r = await getRepo();
  return r instanceof SqlRepository && authUid ? r.as(authUid) : r;
}
