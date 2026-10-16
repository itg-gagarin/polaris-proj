import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { MemoryRepository, FileRepository, SqlRepository, runMigrations, type SqlExecutor, type Repository } from '../src';
import { seedDemo, DEMO_WORKSPACE_ID } from '../src/seed';

const MIGRATIONS = resolve(__dirname, '../../../supabase/migrations');

function pgliteExecutor(db: PGlite): SqlExecutor {
  type Q = { query: PGlite['query']; exec: PGlite['exec'] };
  const run = async (q: Q, sql: string, params?: unknown[]) => (params?.length ? (await q.query(sql, params)).rows : ((await q.exec(sql)).at(-1)?.rows ?? []));
  const wrap = (q: Q): SqlExecutor => ({
    query: async (sql, params) => ({ rows: (await run(q, sql, params as unknown[])) as never[] }),
    transaction: async (fn) => fn(wrap(q)),
  });
  return {
    query: async (sql, params) => ({ rows: (await run(db, sql, params as unknown[])) as never[] }),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx as unknown as Q))),
  };
}

async function contractChecks(repo: Repository) {
  const ws = await repo.getWorkspace(DEMO_WORKSPACE_ID);
  expect(ws?.name).toBe('PT Integra Indocabinet');
  // Sign-in and the sync server rely on workspace membership.
  expect(ws?.memberIds).toContain('u_margono');
  expect((await repo.listWorkspaces())[0].memberIds.length).toBe(14);
  const products = await repo.listProducts(DEMO_WORKSPACE_ID);
  expect(products.map((p) => p.code)).toContain('HH-CC-DRAWER-DRESSER');
  expect(products.find((p) => p.code === 'HH-CC-QUEEN-PANEL-BED')?.componentProductIds).toHaveLength(3);
  const ns = products.find((p) => p.code === 'HH-CC-NIGHT-STAND')!;
  const revs = await repo.listRevisions(ns.id);
  expect(revs.map((r) => r.label).sort()).toEqual(['R5', 'R5-PB-E1']);
  const r5 = revs.find((r) => r.label === 'R5')!;
  expect(r5.state).toBe('in_review');
  expect(r5.content.parts.length).toBe(71);
  const reviews = await repo.listReviews(r5.id);
  expect(reviews.filter((r) => r.state === 'approved').map((r) => r.team).sort()).toEqual(['packing', 'qc']);
  const threads = await repo.listThreads({ revisionId: r5.id });
  expect(threads.find((t) => t.id === 'thread_reveal')?.comments[0].mentions).toEqual(['u_sari']);
  expect((await repo.listStdParts()).length).toBe(1920);
  expect((await repo.listUsers(DEMO_WORKSPACE_ID)).length).toBe(14);
  expect((await repo.getBoard('board_hollan'))?.items.length).toBeGreaterThan(3);
  expect((await repo.getMeeting('mtg_ns_r5'))?.agenda.length).toBeGreaterThan(3);
  const audit = await repo.listAudit({ workspaceId: DEMO_WORKSPACE_ID });
  expect(audit.length).toBeGreaterThanOrEqual(12);
  const exported = await repo.exportAll(DEMO_WORKSPACE_ID);
  expect((exported.products as unknown[]).length).toBe(products.length);
}

describe('in-memory and file repositories', () => {
  it('seed + repository contract (memory)', async () => {
    const repo = new MemoryRepository();
    await seedDemo(repo);
    await contractChecks(repo);
  });

  it('released revisions are immutable', async () => {
    const repo = new MemoryRepository();
    await seedDemo(repo);
    const p = (await repo.listProducts(DEMO_WORKSPACE_ID))[0];
    const r = (await repo.listRevisions(p.id))[0];
    await repo.upsertRevision({ ...r, state: 'released' });
    await expect(repo.upsertRevision({ ...r, state: 'released', content: { ...r.content, parts: [] } })).rejects.toThrow(/immutable/);
  });

  it('board documents round-trip (Hocuspocus persistence)', async () => {
    const repo = new MemoryRepository();
    expect(await repo.getBoardDoc('board:x')).toBeNull();
    await repo.saveBoardDoc('board:x', DEMO_WORKSPACE_ID, new Uint8Array([1, 2, 3]));
    expect(Array.from((await repo.getBoardDoc('board:x'))!)).toEqual([1, 2, 3]);
  });

  it('file repository survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bomdb-'));
    const a = new FileRepository(join(dir, 'db.json'), 0);
    await seedDemo(a);
    a.flush();
    const b = new FileRepository(join(dir, 'db.json'));
    expect(b.isEmpty()).toBe(false);
    expect((await b.listProducts(DEMO_WORKSPACE_ID)).length).toBeGreaterThan(10);
  });
});

describe('migrations on an empty PostgreSQL (Neon / plain Postgres, no Supabase auth schema)', () => {
  it('applies every migration once, adds the auth.uid() stand-in, and stores file bytes', async () => {
    const db = new PGlite();
    const exec = pgliteExecutor(db);
    const first = await runMigrations(exec, MIGRATIONS, () => {});
    expect(first.length).toBe(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length);
    expect(await runMigrations(exec, MIGRATIONS, () => {})).toEqual([]);
    expect((await db.query<{ u: string | null }>('select auth.uid()::text as u')).rows[0].u).toBeNull();
    const repo = new SqlRepository(exec);
    await seedDemo(repo);
    const f = await repo.putFile('sheet.pdf', new Uint8Array([37, 80, 68, 70]), 'application/pdf');
    expect(Array.from((await repo.getFile(f.uri))!.bytes)).toEqual([37, 80, 68, 70]);
  }, 120_000);
});

describe('PostgreSQL schema + row-level security (supabase/migrations on PGlite)', () => {
  let db: PGlite;
  let repo: SqlRepository;
  const uid: Record<string, string> = {};

  beforeAll(async () => {
    db = new PGlite();
    // Stand-ins for what Supabase provides: auth.uid() from the JWT, and the authenticated role.
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create role authenticated;
    `);
    for (const f of readdirSync(MIGRATIONS).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    await db.exec(`grant usage on schema app to authenticated; grant all on all tables in schema app to authenticated;`);
    repo = new SqlRepository(pgliteExecutor(db));
    await seedDemo(repo);
    const rows = (await db.query<{ id: string; uid: string }>(`update app.members set auth_user_id = gen_random_uuid() returning id, auth_user_id::text as uid`)).rows;
    for (const r of rows) uid[r.id] = r.uid;
  }, 120_000);

  it('migrations apply and the repository contract holds on PostgreSQL', async () => {
    await contractChecks(repo);
  });

  it('an external buyer sees only products shared with them', async () => {
    const products = await repo.as(uid.u_buyer).listProducts(DEMO_WORKSPACE_ID);
    expect(products.map((p) => p.code)).toEqual(['HH-CC-NIGHT-STAND']);
    const all = await repo.as(uid.u_budi).listProducts(DEMO_WORKSPACE_ID);
    expect(all.length).toBeGreaterThan(10);
  });

  it('a reviewer approves only their own lane', async () => {
    const ns = (await repo.listProducts(DEMO_WORKSPACE_ID)).find((p) => p.code === 'HH-CC-NIGHT-STAND')!;
    const rev = (await repo.listRevisions(ns.id)).find((r) => r.label === 'R5')!;
    const exec = pgliteExecutor(db);
    const asUser = (u: string, sql: string, params: unknown[]) =>
      exec.transaction(async (q) => {
        await q.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid[u]]);
        await q.query('set local role authenticated');
        return q.query(sql, params);
      });
    const design = await asUser('u_wati', `update app.reviews set state = 'approved' where revision_id = $1 and team = 'design' returning id`, [rev.id]);
    expect(design.rows).toHaveLength(0); // QC reviewer cannot touch the design lane
    const qc = await asUser('u_wati', `update app.reviews set comment = 'ok' where revision_id = $1 and team = 'qc' returning id`, [rev.id]);
    expect(qc.rows).toHaveLength(1);
  });

  it('private meeting notes are visible to their author only', async () => {
    await repo.upsertNotes([
      { id: 'n_priv', meetingId: 'mtg_ns_r5', authorId: 'u_dewi', team: 'finishing', visibility: 'private', anchor: { kind: 'point', point: { x: 0, y: 0, z: 0 } }, kind: 'text', ink: [], text: 'mine', tag: null, at: '2026-10-15T09:00:00Z', clientId: null },
      { id: 'n_pub', meetingId: 'mtg_ns_r5', authorId: 'u_dewi', team: 'finishing', visibility: 'shared', anchor: { kind: 'point', point: { x: 0, y: 0, z: 0 } }, kind: 'text', ink: [], text: 'everyone', tag: null, at: '2026-10-15T09:01:00Z', clientId: null },
    ]);
    expect((await repo.as(uid.u_dewi).listNotes('mtg_ns_r5')).map((n) => n.id)).toEqual(['n_priv', 'n_pub']);
    expect((await repo.as(uid.u_agus).listNotes('mtg_ns_r5')).map((n) => n.id)).toEqual(['n_pub']);
  });

  it('board documents are stored as bytea and scoped to workspace members', async () => {
    await repo.saveBoardDoc('board:pg', DEMO_WORKSPACE_ID, new Uint8Array([9, 8, 7]));
    await repo.saveBoardDoc('board:pg', DEMO_WORKSPACE_ID, new Uint8Array([9, 8, 7, 6]));
    expect(Array.from((await repo.as(uid.u_budi).getBoardDoc('board:pg'))!)).toEqual([9, 8, 7, 6]);
  });

  it('released revisions are read-only and the audit log is append-only (database triggers)', async () => {
    const p = (await repo.listProducts(DEMO_WORKSPACE_ID)).find((x) => x.code === 'HH-CC-DRAWER-CHEST')!;
    const r = (await repo.listRevisions(p.id))[0];
    await repo.upsertRevision({ ...r, state: 'released' });
    await expect(repo.upsertRevision({ ...r, state: 'released', notes: 'x', content: { ...r.content, parts: r.content.parts.slice(1) } })).rejects.toThrow(/read-only/);
    await expect(db.query(`update app.audit_events set what = 'x'`)).rejects.toThrow(/append-only/);
  });
});
