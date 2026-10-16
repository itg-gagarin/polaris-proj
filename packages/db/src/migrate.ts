import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlExecutor } from './sql';

/**
 * Apply `supabase/migrations/*.sql` in order, once each (tracked in public.bom_migrations), so a fresh
 * Supabase, Neon or plain PostgreSQL database is ready on first start. Outside Supabase it adds a stand-in
 * `auth.uid()` (reads the request.jwt.claim.sub setting) — the same contract Supabase provides.
 */
export async function runMigrations(db: SqlExecutor, dir: string, log: (m: string) => void = (m) => console.log(`[db] ${m}`)): Promise<string[]> {
  await db.query('create table if not exists public.bom_migrations (name text primary key, applied_at timestamptz not null default now())');
  await db.query(`
    do $do$
    begin
      if not exists (select 1 from pg_namespace where nspname = 'auth') then
        execute 'create schema auth';
      end if;
      if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
        execute $f$create function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$ $f$;
      end if;
    end $do$;`);
  const done = new Set((await db.query<{ name: string }>('select name from public.bom_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await db.transaction(async (q) => {
      await q.query(sql);
      await q.query('insert into public.bom_migrations (name) values ($1)', [f]);
    });
    applied.push(f);
    log(`applied ${f}`);
  }
  return applied;
}
