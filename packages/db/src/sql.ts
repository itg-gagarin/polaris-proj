/**
 * PostgreSQL repository (Supabase in production). Talks SQL through a tiny executor interface so it
 * runs on node-postgres (production) and PGlite (tests). Requests can be scoped to a signed-in user:
 * `SET LOCAL ROLE authenticated` + the JWT subject, so row-level security applies exactly as in Supabase.
 */
import type {
  AppNotification, AuditEvent, Board, Comment, Decision, Meeting, MeetingNote, Product, Recording, Review, Revision, StdPart, Thread, User, Workspace,
} from '@bom/domain';
import { contentHash, newId } from '@bom/domain';
import type { AiRunLog, CheckResult, Repository, StoredFile } from './repository';

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run statements in one transaction (needed for SET LOCAL). */
  transaction<T>(fn: (q: SqlExecutor) => Promise<T>): Promise<T>;
}

interface TableMap {
  table: string;
  pk: string[];
  cols: Record<string, string>;
  json?: string[];
}

const T = {
  workspaces: { table: 'app.workspaces', pk: ['id'], cols: { id: 'id', name: 'name', settings: 'settings' }, json: ['settings'] },
  members: { table: 'app.members', pk: ['id'], cols: { id: 'id', workspaceId: 'workspace_id', name: 'name', email: 'email', teams: 'teams', role: 'role', color: 'color', locale: 'locale', external: 'external' } },
  std: {
    table: 'app.std_parts',
    pk: ['std_code'],
    cols: { stdCode: 'std_code', level: 'level', l1: 'l1', l2: 'l2', name: 'name', nameEn: 'name_en', category: 'category', subCategory: 'sub_category', positions: 'positions', variants: 'variants', mergedNames: 'merged_names', fgsUsing: 'fgs_using', sgLines: 'sg_lines', source: 'source', axisMap: 'axis_map', defaultRole: 'default_role', ownerTeam: 'owner_team', parentCode: 'parent_code' },
    json: ['axis_map'],
  },
  products: { table: 'app.products', pk: ['id'], cols: { id: 'id', workspaceId: 'workspace_id', code: 'code', name: 'name', category: 'category', subCategory: 'sub_category', currentRevisionId: 'current_revision_id', sharedWithBuyer: 'shared_with_buyer', componentProductIds: 'component_product_ids', createdAt: 'created_at' } },
  revisions: {
    table: 'app.revisions',
    pk: ['id'],
    cols: { id: 'id', productId: 'product_id', label: 'label', state: 'state', notes: 'notes', authorId: 'author_id', createdAt: 'created_at', updatedAt: 'updated_at', parentRevisionId: 'parent_revision_id', branch: 'branch', content: 'content', submittedHash: 'submitted_hash', releasedAt: 'released_at', meetingIds: 'meeting_ids' },
    json: ['branch', 'content'],
  },
  reviews: { table: 'app.reviews', pk: ['id'], cols: { id: 'id', revisionId: 'revision_id', team: 'team', state: 'state', reviewerId: 'reviewer_id', hash: 'hash', checklist: 'checklist', comment: 'comment', at: 'at', resetReason: 'reset_reason' }, json: ['checklist'] },
  threads: { table: 'app.threads', pk: ['id'], cols: { id: 'id', productId: 'product_id', revisionId: 'revision_id', anchor: 'anchor', status: 'status', kind: 'kind', tag: 'tag', task: 'task', createdAt: 'created_at', carriedFromThreadId: 'carried_from_thread_id', meetingId: 'meeting_id' }, json: ['anchor', 'task'] },
  comments: { table: 'app.comments', pk: ['id'], cols: { id: 'id', threadId: 'thread_id', authorId: 'author_id', body: 'body', mentions: 'mentions', attachments: 'attachments', createdAt: 'created_at', editedAt: 'edited_at' }, json: ['attachments'] },
  notifications: { table: 'app.notifications', pk: ['id'], cols: { id: 'id', userId: 'user_id', kind: 'kind', text: 'text', link: 'link', read: 'read', createdAt: 'created_at' } },
  boards: { table: 'app.boards', pk: ['id'], cols: { id: 'id', workspaceId: 'workspace_id', name: 'name', items: 'items' }, json: ['items'] },
  meetings: {
    table: 'app.meetings',
    pk: ['id'],
    cols: { id: 'id', productId: 'product_id', revisionId: 'revision_id', title: 'title', leadId: 'lead_id', noteTakerId: 'note_taker_id', agenda: 'agenda', state: 'state', startedAt: 'started_at', closedAt: 'closed_at', presenter: 'presenter', participants: 'participants', record: 'record' },
    json: ['agenda', 'presenter', 'participants', 'record'],
  },
  notes: { table: 'app.meeting_notes', pk: ['id'], cols: { id: 'id', meetingId: 'meeting_id', authorId: 'author_id', team: 'team', visibility: 'visibility', anchor: 'anchor', kind: 'kind', ink: 'ink', text: 'text', tag: 'tag', at: 'at', clientId: 'client_id' }, json: ['anchor', 'ink'] },
  decisions: {
    table: 'app.decisions',
    pk: ['id'],
    cols: { id: 'id', meetingId: 'meeting_id', text: 'text', partIds: 'part_ids', ownerTeam: 'owner_team', due: 'due', status: 'status', linkedThreadId: 'linked_thread_id', transcriptRef: 'transcript_ref', confirmedBy: 'confirmed_by', source: 'source', confidence: 'confidence' },
    json: ['transcript_ref'],
  },
  recordings: { table: 'app.recordings', pk: ['meeting_id'], cols: { meetingId: 'meeting_id', audioUri: 'audio_uri', consent: 'consent', segments: 'segments', bookmarks: 'bookmarks', startedAt: 'started_at', stoppedAt: 'stopped_at' }, json: ['consent', 'segments', 'bookmarks'] },
  audit: { table: 'app.audit_events', pk: ['id'], cols: { id: 'id', workspaceId: 'workspace_id', productId: 'product_id', revisionId: 'revision_id', who: 'who', what: 'what', before: 'before', after: 'after', at: 'at', source: 'source' }, json: ['before', 'after'] },
  aiRuns: { table: 'app.ai_runs', pk: ['id'], cols: { id: 'id', workspaceId: 'workspace_id', revisionId: 'revision_id', kind: 'kind', userId: 'user_id', model: 'model', request: 'request', response: 'response', status: 'status', ms: 'ms', at: 'at' }, json: ['request', 'response'] },
} satisfies Record<string, TableMap>;

function toRow(m: TableMap, obj: Record<string, unknown>): { cols: string[]; vals: unknown[] } {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, c] of Object.entries(m.cols)) {
    if (!(k in obj)) continue;
    let v = obj[k];
    if (v === undefined) continue;
    if (m.json?.includes(c)) v = v === null ? null : JSON.stringify(v);
    cols.push(c);
    vals.push(v);
  }
  return { cols, vals };
}

function fromRow<R>(m: TableMap, row: Record<string, unknown>): R {
  const out: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(m.cols)) {
    let v = row[c];
    if (v instanceof Date) v = v.toISOString();
    if (typeof v === 'string' && m.json?.includes(c)) v = JSON.parse(v);
    out[k] = v ?? null;
  }
  return out as R;
}

export class SqlRepository implements Repository {
  readonly kind = 'supabase' as const;

  /** @param authUid when set, every call runs as that Supabase user under row-level security. */
  constructor(private db: SqlExecutor, private authUid: string | null = null) {}

  /** A repository scoped to one signed-in user (API routes create one per request). */
  as(authUid: string | null): SqlRepository {
    return new SqlRepository(this.db, authUid);
  }

  private run<R>(fn: (q: SqlExecutor) => Promise<R>): Promise<R> {
    if (!this.authUid) return fn(this.db);
    return this.db.transaction(async (q) => {
      await q.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [this.authUid, JSON.stringify({ sub: this.authUid, role: 'authenticated' })]);
      await q.query('set local role authenticated');
      return fn(q);
    });
  }

  private async select<R>(m: TableMap, where = '', params: unknown[] = [], order = ''): Promise<R[]> {
    return this.run(async (q) => (await q.query(`select * from ${m.table} ${where ? `where ${where}` : ''} ${order}`, params)).rows.map((r) => fromRow<R>(m, r as Record<string, unknown>)));
  }

  private async one<R>(m: TableMap, where: string, params: unknown[]): Promise<R | null> {
    return (await this.select<R>(m, where, params))[0] ?? null;
  }

  private upsertSql(m: TableMap, obj: Record<string, unknown>, extra: Record<string, unknown> = {}): { sql: string; vals: unknown[] } {
    const { cols, vals } = toRow(m, obj);
    for (const [c, v] of Object.entries(extra)) {
      cols.push(c);
      vals.push(v);
    }
    const ph = cols.map((_, i) => `$${i + 1}`);
    const upd = cols.filter((c) => !m.pk.includes(c)).map((c) => `${c} = excluded.${c}`);
    return { sql: `insert into ${m.table} (${cols.join(', ')}) values (${ph.join(', ')}) on conflict (${m.pk.join(', ')}) do ${upd.length ? `update set ${upd.join(', ')}` : 'nothing'}`, vals };
  }

  private async upsert(m: TableMap, objs: Record<string, unknown>[], extra?: (o: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    if (!objs.length) return;
    await this.run(async (q) => {
      for (const o of objs) {
        const { sql, vals } = this.upsertSql(m, o, extra?.(o));
        await q.query(sql, vals);
      }
    });
  }

  getWorkspace(id: string) { return this.one<Workspace>(T.workspaces, 'id = $1', [id]).then((w) => (w ? { ...w, memberIds: [] } : null)); }
  async listWorkspaces() { return (await this.select<Workspace>(T.workspaces)).map((w) => ({ ...w, memberIds: [] })); }
  upsertWorkspace(w: Workspace) { return this.upsert(T.workspaces, [w as unknown as Record<string, unknown>]); }

  async listUsers(workspaceId: string) { return (await this.select<User & { workspaceId: string }>(T.members, 'workspace_id = $1', [workspaceId], 'order by name')).map(({ workspaceId: _w, ...u }) => u as User); }
  async getUser(id: string) {
    const u = await this.one<User & { workspaceId: string }>(T.members, 'id = $1', [id]);
    if (!u) return null;
    const { workspaceId: _w, ...rest } = u;
    return rest as User;
  }
  upsertUser(u: User, workspaceId: string) { return this.upsert(T.members, [{ ...u, workspaceId } as unknown as Record<string, unknown>]); }

  listStdParts() { return this.select<StdPart>(T.std, '', [], 'order by std_code'); }
  async replaceStdParts(entries: StdPart[]) {
    await this.run(async (q) => {
      await q.query('delete from app.std_parts');
      for (const e of entries) {
        const { sql, vals } = this.upsertSql(T.std, e as unknown as Record<string, unknown>);
        await q.query(sql, vals);
      }
    });
  }

  listProducts(workspaceId: string) { return this.select<Product>(T.products, 'workspace_id = $1', [workspaceId], 'order by code'); }
  getProduct(id: string) { return this.one<Product>(T.products, 'id = $1', [id]); }
  upsertProduct(p: Product) { return this.upsert(T.products, [p as unknown as Record<string, unknown>]); }

  listRevisions(productId: string) { return this.select<Revision>(T.revisions, 'product_id = $1', [productId], 'order by created_at'); }
  getRevision(id: string) { return this.one<Revision>(T.revisions, 'id = $1', [id]); }
  upsertRevision(r: Revision) { return this.upsert(T.revisions, [r as unknown as Record<string, unknown>], (o) => ({ content_hash: contentHash((o as unknown as Revision).content) })); }

  listReviews(revisionId: string) { return this.select<Review>(T.reviews, 'revision_id = $1', [revisionId]); }
  upsertReviews(rs: Review[]) { return this.upsert(T.reviews, rs as unknown as Record<string, unknown>[]); }

  async listThreads(f: { productId?: string; revisionId?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.productId) where.push(`product_id = $${params.push(f.productId)}`);
    if (f.revisionId) where.push(`revision_id = $${params.push(f.revisionId)}`);
    const threads = await this.select<Omit<Thread, 'comments'>>(T.threads, where.join(' and '), params, 'order by created_at');
    if (!threads.length) return [];
    const comments = await this.select<Comment>(T.comments, 'thread_id = any($1)', [threads.map((t) => t.id)], 'order by created_at');
    return threads.map((t) => ({ ...t, comments: comments.filter((c) => c.threadId === t.id) }) as Thread);
  }
  async getThread(id: string) {
    const t = await this.one<Omit<Thread, 'comments'>>(T.threads, 'id = $1', [id]);
    if (!t) return null;
    return { ...t, comments: await this.select<Comment>(T.comments, 'thread_id = $1', [id], 'order by created_at') } as Thread;
  }
  async upsertThread(t: Thread) {
    const { comments, ...rest } = t;
    await this.upsert(T.threads, [rest as unknown as Record<string, unknown>]);
    await this.upsert(T.comments, comments as unknown as Record<string, unknown>[]);
  }

  listNotifications(userId: string) { return this.select<AppNotification>(T.notifications, 'user_id = $1', [userId], 'order by created_at desc'); }
  addNotifications(n: AppNotification[]) { return this.upsert(T.notifications, n as unknown as Record<string, unknown>[]); }
  async markNotificationsRead(userId: string, ids: string[]) { await this.run((q) => q.query('update app.notifications set read = true where user_id = $1 and id = any($2)', [userId, ids])); }

  listBoards(workspaceId: string) { return this.select<Board>(T.boards, 'workspace_id = $1', [workspaceId]); }
  getBoard(id: string) { return this.one<Board>(T.boards, 'id = $1', [id]); }
  upsertBoard(b: Board) { return this.upsert(T.boards, [b as unknown as Record<string, unknown>]); }

  listMeetings(f: { productId?: string }) { return f.productId ? this.select<Meeting>(T.meetings, 'product_id = $1', [f.productId]) : this.select<Meeting>(T.meetings); }
  getMeeting(id: string) { return this.one<Meeting>(T.meetings, 'id = $1', [id]); }
  upsertMeeting(m: Meeting) { return this.upsert(T.meetings, [m as unknown as Record<string, unknown>]); }
  listNotes(meetingId: string) { return this.select<MeetingNote>(T.notes, 'meeting_id = $1', [meetingId], 'order by at'); }
  upsertNotes(n: MeetingNote[]) { return this.upsert(T.notes, n as unknown as Record<string, unknown>[]); }
  listDecisions(meetingId: string) { return this.select<Decision>(T.decisions, 'meeting_id = $1', [meetingId]); }
  upsertDecisions(d: Decision[]) { return this.upsert(T.decisions, d as unknown as Record<string, unknown>[]); }
  getRecording(meetingId: string) { return this.one<Recording>(T.recordings, 'meeting_id = $1', [meetingId]); }
  upsertRecording(r: Recording) { return this.upsert(T.recordings, [r as unknown as Record<string, unknown>]); }

  async appendAudit(e: AuditEvent[]) {
    await this.run(async (q) => {
      for (const x of e) {
        const { cols, vals } = toRow(T.audit, x as unknown as Record<string, unknown>);
        await q.query(`insert into app.audit_events (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
      }
    });
  }
  async listAudit(f: { workspaceId: string; productId?: string; revisionId?: string; limit?: number }) {
    const params: unknown[] = [f.workspaceId];
    const where = ['workspace_id = $1'];
    if (f.productId) where.push(`product_id = $${params.push(f.productId)}`);
    if (f.revisionId) where.push(`revision_id = $${params.push(f.revisionId)}`);
    return this.select<AuditEvent>(T.audit, where.join(' and '), params, `order by at desc limit ${Math.max(1, Math.min(5000, f.limit ?? 500))}`);
  }

  appendAiRun(r: AiRunLog) { return this.upsert(T.aiRuns, [r as unknown as Record<string, unknown>]); }
  listAiRuns(revisionId: string) { return this.select<AiRunLog>(T.aiRuns, 'revision_id = $1', [revisionId], 'order by at'); }

  async putCheckResult(r: CheckResult) {
    await this.run((q) =>
      q.query(
        'insert into app.check_results (revision_id, content_hash, findings, summary, computed_at) values ($1, $2, $3, $4, $5) on conflict (revision_id, content_hash) do update set findings = excluded.findings, summary = excluded.summary, computed_at = excluded.computed_at',
        [r.revisionId, r.contentHash, JSON.stringify(r.findings), JSON.stringify(r.summary), r.computedAt],
      ),
    );
  }
  async getCheckResult(revisionId: string, contentHash?: string) {
    const r = await this.run((q) =>
      q.query<Record<string, unknown>>(
        `select revision_id, content_hash, findings, summary, computed_at from app.check_results where revision_id = $1 ${contentHash ? 'and content_hash = $2' : ''} order by computed_at desc limit 1`,
        contentHash ? [revisionId, contentHash] : [revisionId],
      ),
    );
    const row = r.rows[0];
    if (!row) return null;
    const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    const at = row.computed_at;
    return { revisionId: String(row.revision_id), contentHash: String(row.content_hash), findings: j(row.findings), summary: j(row.summary), computedAt: at instanceof Date ? at.toISOString() : String(at) } as CheckResult;
  }

  async getBoardDoc(name: string) {
    const r = await this.run((q) => q.query('select state from app.board_docs where name = $1', [name]));
    const v = r.rows[0]?.state as Uint8Array | undefined;
    return v ? new Uint8Array(v) : null;
  }
  async saveBoardDoc(name: string, workspaceId: string, state: Uint8Array) {
    await this.run((q) =>
      q.query(
        'insert into app.board_docs (name, workspace_id, state, updated_at) values ($1, $2, $3, now()) on conflict (name) do update set state = excluded.state, updated_at = now()',
        [name, workspaceId, state],
      ),
    );
  }

  /** File bytes belong in Supabase Storage; this adapter stores the index row (bytes inline only for small files in dev). */
  async putFile(name: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    const uri = `db://${newId('file')}/${encodeURIComponent(name)}`;
    await this.run((q) => q.query('insert into app.files (uri, name, mime, size) values ($1, $2, $3, $4)', [uri, name, mime, bytes.byteLength]));
    return { uri, name, mime, size: bytes.byteLength };
  }
  async getFile(_uri: string): Promise<null> {
    return null;
  }

  async exportAll(workspaceId: string) {
    const products = await this.listProducts(workspaceId);
    const revisions = (await Promise.all(products.map((p) => this.listRevisions(p.id)))).flat();
    return {
      format: 'bom-studio/workspace@1',
      exportedAt: new Date().toISOString(),
      workspace: await this.getWorkspace(workspaceId),
      users: await this.listUsers(workspaceId),
      products,
      revisions,
      reviews: (await Promise.all(revisions.map((r) => this.listReviews(r.id)))).flat(),
      threads: (await Promise.all(products.map((p) => this.listThreads({ productId: p.id })))).flat(),
      audit: await this.listAudit({ workspaceId, limit: 5000 }),
    };
  }
}

/** node-postgres executor (DATABASE_URL — Supabase connection string in production). */
export async function pgExecutor(connectionString: string): Promise<SqlExecutor> {
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString, max: 10 });
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): SqlExecutor => ({
    query: async (s, p) => (await c.query(s, p)) as { rows: never[] },
    transaction: async (fn) => fn(wrap(c)),
  });
  return {
    query: async (s, p) => (await pool.query(s, p as unknown[])) as { rows: never[] },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const r = await fn(wrap(client));
        await client.query('commit');
        return r;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
