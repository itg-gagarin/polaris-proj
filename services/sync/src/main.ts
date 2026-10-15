/**
 * Sync server entry: `pnpm sync`.
 * Env: SYNC_PORT (1234), DATA_BACKEND / DATA_FILE / DATABASE_URL (see @bom/db), AUTH_PROVIDER (dev | supabase),
 * SUPABASE_JWT_SECRET, SNAPSHOT_MS (30000).
 *
 * The file backend is single-process: run the web app with its own API and BroadcastChannel sync,
 * or point both the web app and this server at the same PostgreSQL (DATA_BACKEND=supabase).
 */
import { createRepository } from '@bom/db';
import { seedDemo } from '@bom/db/seed';
import { startSyncServer } from './server';

const env = process.env;
const repo = await createRepository(env);
if ((await repo.listWorkspaces()).length === 0) await seedDemo(repo);
if ((env.AUTH_PROVIDER ?? 'dev') === 'dev') console.warn('[sync] AUTH_PROVIDER=dev: tokens are "dev:<userId>". Never expose this to the internet.');

const s = await startSyncServer({
  repo,
  env,
  port: Number(env.SYNC_PORT ?? 1234),
  snapshotMs: Number(env.SNAPSHOT_MS ?? 30_000),
  log: (msg, data) => console.log(`[sync] ${msg}`, data ? JSON.stringify(data) : ''),
});
console.log(`[sync] listening on ${s.url} (${repo.kind} repository)`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void s.stop().then(() => process.exit(0));
  });
}
