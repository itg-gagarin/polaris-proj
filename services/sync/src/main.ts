/**
 * Sync server entry: `pnpm sync` (or the `sync` service on Vercel, see vercel.json).
 * Env: PORT (or SYNC_PORT, default 1234); DATABASE_URL / POSTGRES_URL (shared with the web app) — without
 * it the file store is used and the demo is seeded (standalone dev only); SYNC_TOKEN_SECRET (shared with
 * the web app: browser tokens + internal calls; required when the service is public); SNAPSHOT_MS (30000).
 */
import { resolve } from 'node:path';
import { createRepository, findMigrationsDir } from '@bom/db';
import { seedDemo } from '@bom/db/seed';
import { startSyncServer } from './server';

const env = process.env;
const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL;
const repo = await createRepository({
  DATA_BACKEND: env.DATA_BACKEND ?? 'auto',
  DATA_FILE: env.DATA_FILE,
  DATABASE_URL: databaseUrl,
  DATABASE_SSL: env.DATABASE_SSL,
  MIGRATIONS_DIR: env.AUTO_MIGRATE === 'off' ? undefined : findMigrationsDir([env.BOM_MIGRATIONS_DIR, resolve(process.cwd(), 'supabase/migrations'), resolve(process.cwd(), '../../supabase/migrations')]),
});
// With a shared database the web app owns the demo seed; seeding here too would race it.
if (repo.kind !== 'supabase' && (await repo.listWorkspaces()).length === 0) await seedDemo(repo);
if (!env.SYNC_TOKEN_SECRET && (env.AUTH_PROVIDER ?? 'dev') === 'dev') console.warn('[sync] dev tokens ("dev:<userId>"): never expose this server to the internet without SYNC_TOKEN_SECRET.');

const s = await startSyncServer({
  repo,
  env,
  port: Number(env.PORT ?? env.SYNC_PORT ?? 1234),
  snapshotMs: Number(env.SNAPSHOT_MS ?? 30_000),
  log: (msg, data) => console.log(`[sync] ${msg}`, data ? JSON.stringify(data) : ''),
});
console.log(`[sync] listening on ${s.url} (${repo.kind} repository)`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void s.stop().then(() => process.exit(0));
  });
}
