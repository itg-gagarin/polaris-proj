/**
 * `pnpm loadtest`: starts an in-memory sync server with the demo seed, connects 25 clients to the
 * Hollan night stand draft and reports propagation latency. LOADTEST_URL targets a running server instead.
 */
import { MemoryRepository } from '@bom/db';
import { seedDemo, DEMO_USERS } from '@bom/db/seed';
import { startSyncServer } from './server';
import { runLoadTest } from './loadtest';

const repo = new MemoryRepository();
await seedDemo(repo);
const products = await repo.listProducts('ws_itg');
const ns = products.find((p) => p.code === 'HH-CC-NIGHT-STAND')!;
const rev = await repo.getRevision(ns.currentRevisionId!);
const external = process.env.LOADTEST_URL;
const server = external ? null : await startSyncServer({ repo, port: Number(process.env.SYNC_PORT ?? 0) || 0, snapshotMs: 0 });
const editors = DEMO_USERS.filter((u) => !u.external && (u.role === 'editor' || u.role === 'lead'));
const res = await runLoadTest({
  url: external ?? server!.url,
  revisionId: rev!.id,
  partId: rev!.content.parts[0].id,
  clients: Number(process.env.CLIENTS ?? 25),
  rounds: Number(process.env.ROUNDS ?? 2),
  tokenFor: (i) => `dev:${editors[i % editors.length].id}`,
});
console.log(JSON.stringify(res, null, 2));
console.log(res.p95 < 500 && res.converged ? 'PASS: p95 under 500 ms and all clients converged' : 'FAIL');
await server?.stop();
process.exit(res.p95 < 500 && res.converged ? 0 : 1);
