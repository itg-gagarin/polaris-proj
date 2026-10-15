import type { Repository } from './repository';
import { MemoryRepository } from './memory';
import { FileRepository } from './file';
import { SqlRepository, pgExecutor } from './sql';

export interface RepoEnv {
  DATA_BACKEND?: string;
  DATA_FILE?: string;
  DATABASE_URL?: string;
}

/**
 * DATA_BACKEND=memory   in-process only
 * DATA_BACKEND=file     in-process, snapshotted to DATA_FILE (default .data/db.json) — the dev default
 * DATA_BACKEND=supabase PostgreSQL via DATABASE_URL (run supabase/migrations first)
 */
export async function createRepository(env: RepoEnv = {}): Promise<Repository> {
  const backend = env.DATA_BACKEND ?? 'file';
  if (backend === 'supabase' || backend === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('DATA_BACKEND=supabase needs DATABASE_URL');
    return new SqlRepository(await pgExecutor(env.DATABASE_URL));
  }
  if (backend === 'memory') return new MemoryRepository();
  return new FileRepository(env.DATA_FILE ?? '.data/db.json');
}
