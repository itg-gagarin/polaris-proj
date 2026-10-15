import type {
  AppNotification, AuditEvent, Board, Decision, Meeting, MeetingNote, Product, Recording, Review, Revision, StdPart, Thread, User, Workspace,
} from '@bom/domain';
import { clone, newId } from '@bom/domain';
import type { AiRunLog, Repository, StoredFile } from './repository';

export interface MemoryState {
  version: 1;
  workspaces: Record<string, Workspace>;
  users: Record<string, User & { workspaceId: string }>;
  stdParts: StdPart[];
  products: Record<string, Product>;
  revisions: Record<string, Revision>;
  reviews: Record<string, Review>;
  threads: Record<string, Thread>;
  notifications: Record<string, AppNotification>;
  boards: Record<string, Board>;
  meetings: Record<string, Meeting>;
  notes: Record<string, MeetingNote>;
  decisions: Record<string, Decision>;
  recordings: Record<string, Recording>;
  audit: AuditEvent[];
  aiRuns: AiRunLog[];
  files: Record<string, StoredFile & { b64: string }>;
}

export const emptyState = (): MemoryState => ({
  version: 1,
  workspaces: {},
  users: {},
  stdParts: [],
  products: {},
  revisions: {},
  reviews: {},
  threads: {},
  notifications: {},
  boards: {},
  meetings: {},
  notes: {},
  decisions: {},
  recordings: {},
  audit: [],
  aiRuns: [],
  files: {},
});

const vals = <T>(o: Record<string, T>) => Object.values(o);
const toB64 = (b: Uint8Array) => (typeof Buffer !== 'undefined' ? Buffer.from(b).toString('base64') : btoa(String.fromCharCode(...b)));
const fromB64 = (s: string) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

/** In-process repository. Values are cloned in and out so callers never share mutable state. */
export class MemoryRepository implements Repository {
  readonly kind: 'memory' | 'file' = 'memory';
  protected s: MemoryState;

  constructor(state?: MemoryState) {
    this.s = state ?? emptyState();
  }

  protected changed(): void {}

  snapshot(): MemoryState {
    return clone(this.s);
  }

  async getWorkspace(id: string) { return clone(this.s.workspaces[id] ?? null); }
  async listWorkspaces() { return clone(vals(this.s.workspaces)); }
  async upsertWorkspace(w: Workspace) { this.s.workspaces[w.id] = clone(w); this.changed(); }

  async listUsers(workspaceId: string) {
    return clone(vals(this.s.users).filter((u) => u.workspaceId === workspaceId).map(({ workspaceId: _w, ...u }) => u as User));
  }
  async getUser(id: string) {
    const u = this.s.users[id];
    if (!u) return null;
    const { workspaceId: _w, ...rest } = u;
    return clone(rest as User);
  }
  async upsertUser(u: User, workspaceId: string) { this.s.users[u.id] = clone({ ...u, workspaceId }); this.changed(); }

  async listStdParts() { return clone(this.s.stdParts); }
  async replaceStdParts(entries: StdPart[]) { this.s.stdParts = clone(entries); this.changed(); }

  async listProducts(workspaceId: string) { return clone(vals(this.s.products).filter((p) => p.workspaceId === workspaceId).sort((a, b) => a.code.localeCompare(b.code))); }
  async getProduct(id: string) { return clone(this.s.products[id] ?? null); }
  async upsertProduct(p: Product) { this.s.products[p.id] = clone(p); this.changed(); }

  async listRevisions(productId: string) { return clone(vals(this.s.revisions).filter((r) => r.productId === productId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))); }
  async getRevision(id: string) { return clone(this.s.revisions[id] ?? null); }
  async upsertRevision(r: Revision) {
    const prev = this.s.revisions[r.id];
    if (prev?.state === 'released' && JSON.stringify(prev.content) !== JSON.stringify(r.content)) throw new Error('Released revisions are immutable');
    this.s.revisions[r.id] = clone(r);
    this.changed();
  }

  async listReviews(revisionId: string) { return clone(vals(this.s.reviews).filter((r) => r.revisionId === revisionId)); }
  async upsertReviews(rs: Review[]) { for (const r of rs) this.s.reviews[r.id] = clone(r); this.changed(); }

  async listThreads(f: { productId?: string; revisionId?: string }) {
    return clone(vals(this.s.threads).filter((t) => (!f.productId || t.productId === f.productId) && (!f.revisionId || t.revisionId === f.revisionId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  async getThread(id: string) { return clone(this.s.threads[id] ?? null); }
  async upsertThread(t: Thread) { this.s.threads[t.id] = clone(t); this.changed(); }

  async listNotifications(userId: string) { return clone(vals(this.s.notifications).filter((n) => n.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
  async addNotifications(ns: AppNotification[]) { for (const n of ns) this.s.notifications[n.id] = clone(n); this.changed(); }
  async markNotificationsRead(userId: string, ids: string[]) {
    for (const id of ids) if (this.s.notifications[id]?.userId === userId) this.s.notifications[id].read = true;
    this.changed();
  }

  async listBoards(workspaceId: string) { return clone(vals(this.s.boards).filter((b) => b.workspaceId === workspaceId)); }
  async getBoard(id: string) { return clone(this.s.boards[id] ?? null); }
  async upsertBoard(b: Board) { this.s.boards[b.id] = clone(b); this.changed(); }

  async listMeetings(f: { productId?: string }) { return clone(vals(this.s.meetings).filter((m) => !f.productId || m.productId === f.productId)); }
  async getMeeting(id: string) { return clone(this.s.meetings[id] ?? null); }
  async upsertMeeting(m: Meeting) { this.s.meetings[m.id] = clone(m); this.changed(); }
  async listNotes(meetingId: string) { return clone(vals(this.s.notes).filter((n) => n.meetingId === meetingId).sort((a, b) => a.at.localeCompare(b.at))); }
  async upsertNotes(ns: MeetingNote[]) { for (const n of ns) this.s.notes[n.id] = clone(n); this.changed(); }
  async listDecisions(meetingId: string) { return clone(vals(this.s.decisions).filter((d) => d.meetingId === meetingId)); }
  async upsertDecisions(ds: Decision[]) { for (const d of ds) this.s.decisions[d.id] = clone(d); this.changed(); }
  async getRecording(meetingId: string) { return clone(this.s.recordings[meetingId] ?? null); }
  async upsertRecording(r: Recording) { this.s.recordings[r.meetingId] = clone(r); this.changed(); }

  async appendAudit(es: AuditEvent[]) { this.s.audit.push(...clone(es)); this.changed(); }
  async listAudit(f: { workspaceId: string; productId?: string; revisionId?: string; limit?: number }) {
    return clone(this.s.audit.filter((e) => e.workspaceId === f.workspaceId && (!f.productId || e.productId === f.productId) && (!f.revisionId || e.revisionId === f.revisionId)).slice(-(f.limit ?? 500)).reverse());
  }

  async appendAiRun(r: AiRunLog) { this.s.aiRuns.push(clone(r)); this.changed(); }
  async listAiRuns(revisionId: string) { return clone(this.s.aiRuns.filter((r) => r.revisionId === revisionId)); }

  async putFile(name: string, bytes: Uint8Array, mime: string): Promise<StoredFile> {
    const uri = `mem://${newId('file')}/${encodeURIComponent(name)}`;
    const f = { uri, name, mime, size: bytes.byteLength, b64: toB64(bytes) };
    this.s.files[uri] = f;
    this.changed();
    return { uri, name, mime, size: f.size };
  }
  async getFile(uri: string) {
    const f = this.s.files[uri];
    if (!f) return null;
    const { b64, ...file } = f;
    return { file, bytes: fromB64(b64) };
  }

  async exportAll(workspaceId: string) {
    const products = await this.listProducts(workspaceId);
    const pids = new Set(products.map((p) => p.id));
    const revisions = vals(this.s.revisions).filter((r) => pids.has(r.productId));
    const rids = new Set(revisions.map((r) => r.id));
    return clone({
      format: 'bom-studio/workspace@1',
      exportedAt: new Date().toISOString(),
      workspace: this.s.workspaces[workspaceId],
      users: await this.listUsers(workspaceId),
      products,
      revisions,
      reviews: vals(this.s.reviews).filter((r) => rids.has(r.revisionId)),
      threads: vals(this.s.threads).filter((t) => pids.has(t.productId)),
      meetings: vals(this.s.meetings).filter((m) => pids.has(m.productId)),
      notes: vals(this.s.notes),
      decisions: vals(this.s.decisions),
      audit: this.s.audit.filter((e) => e.workspaceId === workspaceId),
      boards: vals(this.s.boards).filter((b) => b.workspaceId === workspaceId),
    });
  }
}
