import type { Repository } from './repository';
import { MemoryRepository } from './memory';
import { FileRepository } from './file';
import { SqlRepository, pgExecutor } from './sql';
import { runMigrations } from './migrate';

export interface RepoEnv {
  DATA_BACKEND?: string;
  DATA_FILE?: string;
  DATABASE_URL?: string;
  /** verify | no-verify (providers with a private CA, e.g. some poolers) | off */
  DATABASE_SSL?: string;
  /** Apply supabase/migrations on start (default on for SQL backends when a migrations dir is known). */
  MIGRATIONS_DIR?: string;
}

/**
 * DATA_BACKEND=memory   in-process only
 * DATA_BACKEND=file     in-process, snapshotted to DATA_FILE (default .data/db.json) — the dev default
 * DATA_BACKEND=supabase PostgreSQL via DATABASE_URL (Supabase, Neon or any Postgres 14+)
 * DATA_BACKEND=auto     PostgreSQL when DATABASE_URL is set, otherwise the file store (hosted previews)
 */
export async function createRepository(env: RepoEnv = {}): Promise<Repository> {
  const requested = env.DATA_BACKEND ?? 'file';
  const backend = requested === 'auto' ? (env.DATABASE_URL ? 'postgres' : 'file') : requested;
  if (backend === 'supabase' || backend === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('DATA_BACKEND=supabase needs DATABASE_URL');
    const db = await pgExecutor(env.DATABASE_URL, { ssl: env.DATABASE_SSL as 'verify' | 'no-verify' | 'off' | undefined });
    if (env.MIGRATIONS_DIR) await runMigrations(db, env.MIGRATIONS_DIR);
    return new SqlRepository(db);
  }
  if (backend === 'memory') return new MemoryRepository();
  return new FileRepository(env.DATA_FILE ?? '.data/db.json');
}
