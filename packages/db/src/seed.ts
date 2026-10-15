/**
 * Demo workspace seeded from the fixtures: Hollan House "Curated Craftsman" bedroom.
 * Used by the in-memory/file store at first start and by `pnpm db:seed` against Supabase.
 * All people are fictional demo accounts.
 */
import type { Board, FrameItem, MarkupItem, Product, Revision, Thread, User, Workspace } from '@bom/domain';
import { DEFAULT_SETTINGS, stableId } from '@bom/domain';
import { loadDictionary, loadHollan, loadSets } from '@bom/fixtures';
import { analyze } from '@bom/engine';
import { createMeeting, createThread, newRevision, submitRevision, toTask, forkAlternative, approveLane } from '@bom/workflow';
import type { Repository } from './repository';

export const DEMO_WORKSPACE_ID = 'ws_itg';
export const DEMO_BOARD_ID = 'board_hollan';

const user = (id: string, name: string, teams: User['teams'], role: User['role'], color: string, extra: Partial<User> = {}): User => ({
  id,
  name,
  email: `${id.replace('u_', '')}@demo.itg`,
  teams,
  role,
  color,
  locale: 'id',
  external: false,
  ...extra,
});

export const DEMO_USERS: User[] = [
  user('u_margono', 'Margono', ['design'], 'lead', '#2563eb'),
  user('u_sari', 'Sari Wulandari', ['design'], 'editor', '#3b82f6'),
  user('u_budi', 'Budi Santoso', ['engineering'], 'editor', '#7c3aed'),
  user('u_tono', 'Tono Prasetyo', ['engineering'], 'reviewer', '#8b5cf6'),
  user('u_dewi', 'Dewi Lestari', ['finishing'], 'reviewer', '#db2777'),
  user('u_lina', 'Lina Marlina', ['finishing'], 'editor', '#ec4899'),
  user('u_agus', 'Agus Setiawan', ['assembly'], 'reviewer', '#d97706'),
  user('u_rina', 'Rina Kartika', ['hardware'], 'editor', '#059669'),
  user('u_yusuf', 'Yusuf Hidayat', ['hardware'], 'reviewer', '#10b981'),
  user('u_joko', 'Joko Susilo', ['packing'], 'reviewer', '#a16207'),
  user('u_wati', 'Wati Rahayu', ['qc'], 'reviewer', '#dc2626'),
  user('u_hendra', 'Hendra Gunawan', ['ppic'], 'lead', '#475569'),
  user('u_admin', 'Admin ITG', ['design', 'engineering'], 'admin', '#0f172a', { locale: 'en' }),
  user('u_buyer', 'Buyer reviewer (demo)', ['buyer'], 'viewer', '#0ea5e9', { external: true, locale: 'en' }),
];

const withId = (t: Thread, id: string): Thread => ({ ...t, id, comments: t.comments.map((c) => ({ ...c, threadId: id })) });

export async function seedDemo(repo: Repository): Promise<{ workspace: Workspace; products: Product[] }> {
  const ws: Workspace = { id: DEMO_WORKSPACE_ID, name: 'PT Integra Indocabinet', settings: DEFAULT_SETTINGS, memberIds: DEMO_USERS.map((u) => u.id) };
  await repo.upsertWorkspace(ws);
  for (const u of DEMO_USERS) await repo.upsertUser(u, ws.id);
  const { entries } = await loadDictionary();
  await repo.replaceStdParts(entries);

  const by = (id: string) => DEMO_USERS.find((u) => u.id === id)!;
  const created = '2026-09-24T08:00:00.000Z';
  const products: Product[] = [];
  const revisions = new Map<string, Revision>();
  const fixtures = await loadHollan();

  for (const f of fixtures) {
    if (f.code === 'HH-CC-NIGHT-STAND-2') continue; // seeded as an alternative of the night stand below
    const product: Product = {
      id: stableId('prod', f.code),
      workspaceId: ws.id,
      code: f.code,
      name: f.name,
      category: f.category,
      subCategory: f.subCategory,
      currentRevisionId: null,
      sharedWithBuyer: f.code === 'HH-CC-NIGHT-STAND',
      componentProductIds: [],
      createdAt: created,
    };
    const rev = { ...newRevision(product.id, f.revisionLabel, f.content, by('u_budi'), `Imported from Hollan House Rev. ${f.revisionLabel.replace(/^R/, '')} (Material Breakdown Form)`), id: stableId('rev', `${f.code}|${f.revisionLabel}`), createdAt: created, updatedAt: created };
    product.currentRevisionId = rev.id;
    products.push(product);
    revisions.set(f.code, rev);
  }

  // Bed sets made of component products.
  for (const s of await loadSets()) {
    const product: Product = {
      id: stableId('prod', s.code),
      workspaceId: ws.id,
      code: s.code,
      name: s.name,
      category: 'Beds',
      subCategory: 'Panel Beds',
      currentRevisionId: null,
      sharedWithBuyer: false,
      componentProductIds: Object.values(s.components).map((c) => stableId('prod', c)),
      createdAt: created,
    };
    const rev = { ...newRevision(product.id, 'R5', s.content, by('u_budi'), 'Bed set composed from headboard, footboard A and side rails'), id: stableId('rev', `${s.code}|R5`), createdAt: created, updatedAt: created };
    product.currentRevisionId = rev.id;
    products.push(product);
    revisions.set(s.code, rev);
  }

  // Night stand: submitted for review, two lanes approved; the reduce-cost sheet is an alternative.
  const nsProduct = products.find((p) => p.code === 'HH-CC-NIGHT-STAND')!;
  let ns = revisions.get('HH-CC-NIGHT-STAND')!;
  const sub = submitRevision(ns, nsProduct, by('u_budi'), 'Rev. 5 from Hollan House: reduce cost finishing interior $1/m2', ws.settings);
  ns = sub.revision;
  let reviews = sub.reviews;
  reviews = reviews.map((r) => (r.team === 'packing' ? approveLane(ns, r, by('u_joko'), { hash: ns.submittedHash!, comment: 'Skids and carton OK' }) : r.team === 'qc' ? approveLane(ns, r, by('u_wati'), { hash: ns.submittedHash! }) : r));
  revisions.set('HH-CC-NIGHT-STAND', ns);
  const alt = fixtures.find((f) => f.code === 'HH-CC-NIGHT-STAND-2');
  if (alt) {
    const a = { ...forkAlternative({ ...ns, state: 'draft' }, 'PB-E1', by('u_sari')), id: stableId('rev', 'HH-CC-NIGHT-STAND|PB-E1'), content: alt.content, notes: 'Alternative: particle board E1 (Rev. 1 reduce cost)', parentRevisionId: ns.id, createdAt: created, updatedAt: created };
    revisions.set('HH-CC-NIGHT-STAND-2', a);
  }

  // Products first, then revisions, then point each product at its current revision (FK order).
  for (const p of products) await repo.upsertProduct({ ...p, currentRevisionId: null });
  for (const r of revisions.values()) await repo.upsertRevision(r);
  for (const p of products) await repo.upsertProduct(p);
  await repo.upsertReviews(reviews);

  // A few comments anchored to parts, one turned into a task.
  const nsContent = ns.content;
  const front = nsContent.parts.find((p) => p.role === 'drawerFront')!;
  const slide = nsContent.parts.find((p) => p.role === 'slide');
  const t1 = toTask(
    createThread({ productId: nsProduct.id, revisionId: ns.id, anchor: { kind: 'part', partId: front.id, stdCode: front.stdCode, position: front.position }, author: by('u_margono'), body: 'Check the reveal gap on the drawer fronts, @Sari — 458 in a 461 opening is tight.', users: DEMO_USERS }),
    { assigneeId: 'u_sari', team: 'design', due: '2026-10-22' },
  );
  await repo.upsertThread(withId(t1, 'thread_reveal'));
  if (slide) {
    const t2 = createThread({ productId: nsProduct.id, revisionId: ns.id, anchor: { kind: 'part', partId: slide.id, stdCode: slide.stdCode, position: null }, author: by('u_rina'), body: 'SH-ABC full-extension 250 mm: confirm the clearance per side with the supplier (12.7 mm assumed).', users: DEMO_USERS });
    await repo.upsertThread(withId(t2, 'thread_slide'));
  }

  // A planned product meeting for the night stand.
  const participants = DEMO_USERS.filter((u) => !u.external).map((u) => ({ userId: u.id, team: u.teams[0], role: (u.id === 'u_margono' ? 'lead' : u.id === 'u_tono' ? 'noteTaker' : 'participant') as 'lead' | 'noteTaker' | 'participant', device: (u.id === 'u_agus' ? 'paper' : 'tablet') as 'paper' | 'tablet' }));
  const meeting = { ...createMeeting({ productId: nsProduct.id, revisionId: ns.id, content: nsContent, title: 'Night stand R5 product meeting', lead: by('u_margono'), noteTaker: by('u_tono'), participants }), id: 'mtg_ns_r5' };
  await repo.upsertMeeting(meeting);

  // A starter board: frames for the night stand and the dresser.
  const dresser = products.find((p) => p.code === 'HH-CC-DRAWER-DRESSER')!;
  const frame = (id: string, type: FrameItem['type'], title: string, x: number, y: number, w: number, h: number, productId: string | null, revisionId: string | null, props: Record<string, unknown> = {}): FrameItem => ({ id, kind: 'frame', type, rect: { x, y, w, h }, z: 1, title, productId, revisionId, props });
  const sticky: MarkupItem = { id: 'mk_reveal', kind: 'markup', type: 'note', points: [], rect: { x: 1560, y: 520, w: 220, h: 140 }, text: 'Check the reveal gap', style: { stroke: '#047857', fill: '#a7f3d0', strokeWidth: 1, sketchy: false, fontSize: 18 }, z: 5, authorId: 'u_margono', bindStart: null, bindEnd: null, pin: null, team: 'design' };
  const board: Board = {
    id: DEMO_BOARD_ID,
    workspaceId: ws.id,
    name: 'Hollan House — Curated Craftsman bedroom',
    items: [
      frame('fr_ns_3d', 'viewport', '3D · Night Stand', 0, 0, 760, 560, nsProduct.id, ns.id, { shading: 'material', lens: 'none', view: 'iso' }),
      frame('fr_ns_sheet', 'sheet', 'Sheet · Night Stand', 800, 0, 720, 560, nsProduct.id, ns.id, { views: ['front', 'side', 'top'] }),
      frame('fr_ns_bom', 'bom', 'BOM · Night Stand', 0, 600, 1520, 460, nsProduct.id, ns.id),
      frame('fr_ns_findings', 'findings', 'Checks · Night Stand', 1560, 0, 520, 480, nsProduct.id, ns.id),
      frame('fr_dr_3d', 'viewport', '3D · Drawer Dresser', 0, 1120, 960, 620, dresser.id, dresser.currentRevisionId, { shading: 'solid', lens: 'engineering', view: 'iso' }),
      sticky,
    ],
  };
  await repo.upsertBoard(board);

  // Server-side check run on every seeded revision (stored in the audit trail).
  for (const [code, r] of revisions) {
    const a = analyze(r.content, ws.settings);
    await repo.appendAudit([{ id: stableId('audit', `seed|${code}`), workspaceId: ws.id, productId: r.productId, revisionId: r.id, who: 'system', what: `Imported and checked: ${a.summary.fail} fail, ${a.summary.warn} warn`, before: null, after: a.summary, at: created, source: 'import' }]);
  }
  return { workspace: ws, products };
}
