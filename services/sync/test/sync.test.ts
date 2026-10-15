import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryRepository } from '@bom/db';
import { seedDemo, DEMO_BOARD_ID, DEMO_USERS, DEMO_WORKSPACE_ID } from '@bom/db/seed';
import { boardItems, readRevision, revisionMaps } from '@bom/collab';
import { contentHash, makePatch, type Revision } from '@bom/domain';
import { startSyncServer, connectClient, runLoadTest, signHs256, userIdFromToken, verifyHs256, type SyncServer } from '../src';

let repo: MemoryRepository;
let sync: SyncServer;
let draft: Revision;

beforeAll(async () => {
  repo = new MemoryRepository();
  await seedDemo(repo);
  const ns = (await repo.listProducts(DEMO_WORKSPACE_ID)).find((p) => p.code === 'HH-CC-NIGHT-STAND')!;
  draft = (await repo.getRevision(ns.currentRevisionId!))!;
  sync = await startSyncServer({ repo, port: 0, snapshotMs: 0, storeDebounceMs: 50, storeMaxDebounceMs: 200 });
}, 60_000);

afterAll(async () => {
  await sync?.stop();
});

const until = async (fn: () => boolean | Promise<boolean>, ms = 5000) => {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('auth', () => {
  it('dev tokens and Supabase HS256 tokens', () => {
    expect(userIdFromToken('dev:u_budi', {})).toBe('u_budi');
    expect(() => userIdFromToken('u_budi', {})).toThrow(/dev:/);
    const secret = 'test-secret';
    const tok = signHs256({ sub: 'auth-uuid', app_user_id: 'u_sari', exp: Math.floor(Date.now() / 1000) + 60 }, secret);
    expect(userIdFromToken(tok, { AUTH_PROVIDER: 'supabase', SUPABASE_JWT_SECRET: secret })).toBe('u_sari');
    expect(() => verifyHs256(tok, 'wrong')).toThrow(/signature/);
    const old = signHs256({ sub: 'x', exp: 1 }, secret);
    expect(() => verifyHs256(old, secret)).toThrow(/expired/);
  });

  it('rejects unknown users and documents; external users and viewers get read-only content', async () => {
    await expect(connectClient(sync.url, `revision:${draft.id}`, 'dev:nobody', 3000)).rejects.toThrow(/auth failed/);
    await expect(connectClient(sync.url, 'nonsense', 'dev:u_budi', 3000)).rejects.toThrow(/auth failed/);
    const buyer = await connectClient(sync.url, `revision:${draft.id}`, 'dev:u_buyer');
    const editor = await connectClient(sync.url, `revision:${draft.id}`, 'dev:u_margono');
    expect(buyer.provider.authorizedScope).toBe('readonly');
    expect(editor.provider.authorizedScope).toBe('read-write');
    // The buyer's write is dropped by the server, so nobody else ever sees it.
    const [pid, marker] = [draft.content.parts[0].id, draft.content.parts[1].id];
    revisionMaps(buyer.doc, draft.id).parts.get(pid)!.set('notes', 'buyer was here');
    await new Promise((r) => setTimeout(r, 100));
    revisionMaps(editor.doc, draft.id).parts.get(marker)!.set('notes', 'editor marker');
    const server = () => sync.server.hocuspocus.documents.get(`revision:${draft.id}`)!;
    await until(() => revisionMaps(server(), draft.id).parts.get(marker)!.get('notes') === 'editor marker');
    expect(revisionMaps(server(), draft.id).parts.get(pid)!.get('notes')).not.toBe('buyer was here');
    expect(revisionMaps(editor.doc, draft.id).parts.get(pid)!.get('notes')).not.toBe('buyer was here');
    buyer.provider.destroy();
    editor.provider.destroy();
  });
});

describe('board and revision documents', () => {
  it('a board document is initialised from the board row and persisted', async () => {
    const c = await connectClient(sync.url, `board:${DEMO_BOARD_ID}`, 'dev:u_sari');
    const board = (await repo.getBoard(DEMO_BOARD_ID))!;
    expect(boardItems(c.doc).size).toBe(board.items.length);
    const frame = { ...board.items[0], id: 'frame_new', title: 'Added live' };
    boardItems(c.doc).set(frame.id, frame);
    await until(async () => (await repo.getBoard(DEMO_BOARD_ID))!.items.some((i) => i.id === 'frame_new'));
    expect(await repo.getBoardDoc(`board:${DEMO_BOARD_ID}`)).not.toBeNull();
    c.provider.destroy();
  });

  it('snapshot writes the draft, records the editors, and re-runs checks server-side', async () => {
    const c = await connectClient(sync.url, `revision:${draft.id}`, 'dev:u_budi');
    expect(contentHash(readRevision(c.doc, draft.id)!)).not.toBe('');
    const front = draft.content.parts.find((p) => p.role === 'drawerFront')!;
    revisionMaps(c.doc, draft.id).parts.get(front.id)!.set('dims.L', front.dims.L + 3);
    await until(() => revisionMaps(sync.server.hocuspocus.documents.get(`revision:${draft.id}`)!, draft.id).parts.get(front.id)!.get('dims.L') === front.dims.L + 3);
    const [res] = (await sync.snapshotAll()).filter((r) => r.revisionId === draft.id);
    expect(res.status).toBe('saved');
    const saved = (await repo.getRevision(draft.id))!;
    expect(saved.content.parts.find((p) => p.id === front.id)!.dims.L).toBe(front.dims.L + 3);
    const check = (await repo.getCheckResult(draft.id, res.hash))!;
    expect(check.findings.length).toBeGreaterThan(0);
    const audit = await repo.listAudit({ workspaceId: DEMO_WORKSPACE_ID, revisionId: draft.id, limit: 5 });
    expect(audit[0].who).toContain('u_budi');
    expect(audit[0].what).toMatch(/\d+ changed/);
    // Approved lanes whose scope changed were reset (the seed approved packing + qc on this revision).
    expect(res.reset).toBeDefined();
    expect((await sync.snapshotAll()).find((r) => r.revisionId === draft.id)?.status).toBe('unchanged');
    c.provider.destroy();
  });

  it('server-side patches (REST / AI accept) reach connected clients', async () => {
    const c = await connectClient(sync.url, `revision:${draft.id}`, 'dev:u_dewi');
    const pid = draft.content.parts[1].id;
    await sync.applyServerPatch(draft.id, makePatch([{ op: 'setField', partId: pid, field: 'finishCode', value: 'F-AI-1' }], 'AI optimize, accepted by Margono', 'ai'), 'u_margono');
    await until(() => revisionMaps(c.doc, draft.id).parts.get(pid)!.get('finishCode') === 'F-AI-1');
    c.provider.destroy();
  });

  it('released revisions are read-only over the socket', async () => {
    const released = (await repo.listProducts(DEMO_WORKSPACE_ID)).find((p) => p.code === 'HH-CC-DRAWER-CHEST')!;
    const rev = (await repo.getRevision(released.currentRevisionId!))!;
    await repo.upsertRevision({ ...rev, state: 'released', releasedAt: new Date().toISOString() });
    const c = await connectClient(sync.url, `revision:${rev.id}`, 'dev:u_margono');
    expect(c.provider.authorizedScope).toBe('readonly');
    c.provider.destroy();
  });
});

describe('PRD §13 phase-3 gate', () => {
  it('25 clients on one draft: every edit reaches all others in under 500 ms (p95)', async () => {
    const editors = DEMO_USERS.filter((u) => !u.external && (u.role === 'editor' || u.role === 'lead'));
    const res = await runLoadTest({ url: sync.url, revisionId: draft.id, partId: draft.content.parts[2].id, clients: 25, rounds: 1, tokenFor: (i) => `dev:${editors[i % editors.length].id}` });
    console.log('load test', res);
    expect(res.converged).toBe(true);
    expect(res.p95).toBeLessThan(500);
  }, 60_000);
});
