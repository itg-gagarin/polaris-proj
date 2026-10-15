import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { MemoryRepository, type SqlExecutor } from '@bom/db';
import { seedDemo, DEMO_WORKSPACE_ID } from '@bom/db/seed';
import { MockProvider } from '@bom/ai';
import { FileErpConnector, verifySignature, type Fetcher, type WebhookSubscription } from '@bom/integrations';
import { fixturePath } from '@bom/fixtures';
import type { Revision } from '@bom/domain';
import { MemoryQueue, SqlQueue, Worker, jobs, type JobQueue, type JobHandler } from '../src';

const MIGRATIONS = resolve(__dirname, '../../../supabase/migrations');

async function queueContract(q: JobQueue) {
  const a = await q.enqueue('noop', { n: 1 }, { dedupeKey: 'k1' });
  const dup = await q.enqueue('noop', { n: 2 }, { dedupeKey: 'k1' });
  expect(dup.id).toBe(a.id);
  const later = await q.enqueue('noop', { n: 3 }, { runAt: new Date(Date.now() + 60_000) });
  const c = await q.claim('w1', ['noop']);
  expect(c?.id).toBe(a.id);
  expect(c?.attempts).toBe(1);
  expect(await q.claim('w2', ['noop'])).toBeNull(); // the other job is not due yet
  await q.complete(a.id, { ok: true }, { scrubbed: true });
  const done = (await q.get(a.id))!;
  expect(done.status).toBe('done');
  expect(done.payload).toEqual({ scrubbed: true });
  // Dedupe key is free again once the job finished.
  expect((await q.enqueue('noop', {}, { dedupeKey: 'k1' })).id).not.toBe(a.id);
  const f = await q.enqueue('flaky', {}, { maxAttempts: 2 });
  await q.claim('w1', ['flaky']);
  expect((await q.fail(f.id, 'boom', 0)).status).toBe('queued');
  await q.claim('w1', ['flaky']);
  const final = await q.fail(f.id, 'boom again', 0, { gone: true });
  expect(final.status).toBe('failed');
  expect(final.payload).toEqual({ gone: true });
  expect((await q.list({ status: 'failed' })).map((j) => j.id)).toContain(f.id);
  expect(later.status).toBe('queued');
}

describe('job queue', () => {
  it('memory queue: dedupe, scheduling, retries, scrubbing', async () => {
    await queueContract(new MemoryQueue());
  });

  it('PostgreSQL queue (app.jobs on PGlite) has the same contract', async () => {
    const db = new PGlite();
    await db.exec(`create schema auth; create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$; create role authenticated;`);
    for (const f of readdirSync(MIGRATIONS).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    const exec: SqlExecutor = {
      query: async (sql, params) => ({ rows: (await db.query(sql, params as unknown[])).rows as never[] }),
      transaction: async (fn) => fn(exec),
    };
    await queueContract(new SqlQueue(exec));
  }, 60_000);
});

describe('worker jobs on the Hollan fixtures', () => {
  let repo: MemoryRepository;
  let queue: MemoryQueue;
  let worker: Worker;
  let ns: Revision;
  const erp = new FileErpConnector();
  const posted: { url: string; body: string; sig: string }[] = [];
  let failFirst = true;
  const fetcher: Fetcher = async (url, init) => {
    posted.push({ url, body: String(init?.body), sig: String((init?.headers as Record<string, string>)['x-bomstudio-signature']) });
    if (url.includes('flaky') && failFirst) {
      failFirst = false;
      return { ok: false, status: 503, text: async () => '' } as Response;
    }
    return { ok: true, status: 200, text: async () => '' } as Response;
  };
  const subs: WebhookSubscription[] = [
    { id: 'wh_ok', url: 'https://erp.example/hook', events: ['revision.released'], secret: 's1', active: true },
    { id: 'wh_flaky', url: 'https://flaky.example/hook', events: ['revision.released'], secret: 's2', active: true },
  ];
  const emails: { to: string; text: string }[] = [];

  beforeAll(async () => {
    repo = new MemoryRepository();
    await seedDemo(repo);
    queue = new MemoryQueue();
    worker = new Worker({ queue, backoffMs: 0, deps: { repo, ai: new MockProvider(), chat: null, erp, webhooks: subs, fetcher, baseUrl: 'https://studio.example', sendEmail: async (to, _s, text) => void emails.push({ to, text }) } });
    const p = (await repo.listProducts(DEMO_WORKSPACE_ID)).find((x) => x.code === 'HH-CC-NIGHT-STAND')!;
    ns = (await repo.getRevision(p.currentRevisionId!))!;
  }, 60_000);

  it('exports every format', async () => {
    const formats = ['xlsx', 'json', 'pdf', 'personal-pdf', 'glb', 'dxf', 'step'] as const;
    const js = await Promise.all(formats.map((format) => jobs.export(queue, { revisionId: ns.id, format, userId: 'u_budi', team: 'hardware' })));
    expect(await worker.drain()).toBe(formats.length);
    for (const j of js) {
      const done = (await queue.get(j.id))!;
      expect(done.status, `${j.payload.format}: ${done.error}`).toBe('done');
      const f = await repo.getFile((done.result as { uri: string }).uri);
      expect(f!.bytes.byteLength).toBeGreaterThan(500);
    }
    const pdf = await repo.getFile(((await queue.get(js[2].id))!.result as { uri: string }).uri);
    expect(new TextDecoder().decode(pdf!.bytes.slice(0, 5))).toBe('%PDF-');
  }, 60_000);

  it('imports a workbook to a preview and drops the bytes', async () => {
    const bytes = readFileSync(fixturePath('products', 'hollan-house-curated-craftsman.xlsx'));
    const j = await jobs.import(queue, { workspaceId: DEMO_WORKSPACE_ID, userId: 'u_sari', fileName: 'hollan.xlsx', bytesB64: bytes.toString('base64') });
    await worker.drain();
    const done = (await queue.get(j.id))!;
    expect(done.status, done.error ?? '').toBe('done');
    expect((done.result as { products: number }).products).toBe(11);
    expect(JSON.stringify(done.payload)).not.toContain('bytesB64');
  }, 60_000);

  it('AI optimize runs in the background, stores the suggestion and logs the run', async () => {
    const j = await jobs.optimize(queue, { revisionId: ns.id, userId: 'u_margono' });
    expect((await jobs.optimize(queue, { revisionId: ns.id, userId: 'u_margono' })).id).toBe(j.id);
    await worker.drain();
    const done = (await queue.get(j.id))!;
    expect(done.status, done.error ?? '').toBe('done');
    expect((done.result as { changes: number }).changes).toBeGreaterThan(0);
    expect((await repo.listAiRuns(ns.id)).length).toBeGreaterThan(0);
    expect((await repo.listNotifications('u_margono')).some((n) => n.kind === 'ai')).toBe(true);
  }, 60_000);

  it('ERP push only for released revisions; webhooks retry per subscription and are signed', async () => {
    const j1 = await jobs.erpPush(queue, { revisionId: ns.id });
    await worker.drain();
    expect((await queue.get(j1.id))!.error).toMatch(/released/);
    await repo.upsertRevision({ ...ns, state: 'released', releasedAt: '2026-10-15T00:00:00.000Z' });
    const j2 = await jobs.erpPush(queue, { revisionId: ns.id });
    await worker.drain();
    expect((await queue.get(j2.id))!.status).toBe('done');
    expect(erp.written[0].revision.label).toBe(ns.label);

    await jobs.webhook(queue, { type: 'revision.released', revisionId: ns.id, productId: ns.productId, label: ns.label, at: '2026-10-15T00:00:00.000Z' } as never, subs);
    await worker.drain();
    expect(posted.filter((p) => p.url.includes('erp.example'))).toHaveLength(1);
    expect(posted.filter((p) => p.url.includes('flaky'))).toHaveLength(2);
    expect(await verifySignature('s1', posted[0].body, posted[0].sig)).toBe(true);
  }, 60_000);

  it('daily digest goes to everyone with unread notifications, once per day', async () => {
    const a = await jobs.digest(queue, { workspaceId: DEMO_WORKSPACE_ID }, '2026-10-15');
    expect((await jobs.digest(queue, { workspaceId: DEMO_WORKSPACE_ID }, '2026-10-15')).id).toBe(a.id);
    await worker.drain();
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.find((e) => e.to.includes('margono'))?.text).toMatch(/AI optimize finished/);
  });

  it('a job that throws is retried with backoff, then marked failed', async () => {
    let calls = 0;
    const boom: JobHandler = async () => {
      calls++;
      throw new Error('nope');
    };
    const w = new Worker({ queue, backoffMs: 0, handlers: { boom }, deps: { repo, ai: null, chat: null, erp: null, webhooks: [] } });
    const j = await queue.enqueue('boom', {}, { maxAttempts: 3 });
    await w.drain();
    expect(calls).toBe(3);
    expect((await queue.get(j.id))!.status).toBe('failed');
  });
});
