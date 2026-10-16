import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlExecutor } from './sql';

/** Any fixed number: serialises migrations when several services start against one database. */
const MIGRATION_LOCK = 724331;

/**
 * Apply `supabase/migrations/*.sql` in order, once each (tracked in public.bom_migrations), so a fresh
 * Supabase, Neon or plain PostgreSQL database is ready on first start. Outside Supabase it adds a stand-in
 * `auth.uid()` (reads the request.jwt.claim.sub setting) — the same contract Supabase provides.
 * Runs in one transaction under an advisory lock: the web app, sync server and worker may all start at once.
 */
export async function runMigrations(db: SqlExecutor, dir: string, log: (m: string) => void = (m) => console.log(`[db] ${m}`)): Promise<string[]> {
  const files = readdirSync(dir).filter((x) => x.endsWith('.sql')).sort();
  return db.transaction(async (q) => {
    await q.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await q.query('create table if not exists public.bom_migrations (name text primary key, applied_at timestamptz not null default now())');
    await q.query(`
      do $do$
      begin
        if not exists (select 1 from pg_namespace where nspname = 'auth') then
          execute 'create schema auth';
        end if;
        if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
          execute $f$create function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$ $f$;
        end if;
      end $do$;`);
    const done = new Set((await q.query<{ name: string }>('select name from public.bom_migrations')).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await q.query(readFileSync(join(dir, f), 'utf8'));
      await q.query('insert into public.bom_migrations (name) values ($1)', [f]);
      applied.push(f);
      log(`applied ${f}`);
    }
    return applied;
  });
}

/** Locate supabase/migrations from a service's working directory (repo root, app dir or bundled function). */
export function findMigrationsDir(candidates: (string | undefined)[]): string | undefined {
  return candidates.filter((c): c is string => !!c).find((c) => existsSync(c));
}
