import type {
  AppNotification, AuditEvent, Board, Decision, Meeting, MeetingNote, Product, Recording, Review, Revision, StdPart, Thread, User, Workspace,
} from '@bom/domain';

export interface AiRunLog {
  id: string;
  workspaceId: string;
  revisionId: string;
  kind: 'optimize' | 'import-mapping' | 'revision-summary' | 'review-assistant' | 'meeting-assistant' | 'ask';
  userId: string;
  model: string | null;
  /** Exactly what was sent and received (PRD §12: prompts and responses logged per run). */
  request: unknown;
  response: unknown;
  status: 'ok' | 'error' | 'timeout' | 'disabled';
  ms: number;
  at: string;
}

export interface StoredFile {
  uri: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * Storage port. The app talks only to this interface; adapters: in-memory (+ JSON file) for
 * development and demos, Supabase (PostgreSQL + RLS + Storage) for production.
 */
export interface Repository {
  readonly kind: 'memory' | 'file' | 'supabase';

  getWorkspace(id: string): Promise<Workspace | null>;
  listWorkspaces(): Promise<Workspace[]>;
  upsertWorkspace(w: Workspace): Promise<void>;

  listUsers(workspaceId: string): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  upsertUser(u: User, workspaceId: string): Promise<void>;

  listStdParts(): Promise<StdPart[]>;
  replaceStdParts(entries: StdPart[]): Promise<void>;

  listProducts(workspaceId: string): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  upsertProduct(p: Product): Promise<void>;

  listRevisions(productId: string): Promise<Revision[]>;
  getRevision(id: string): Promise<Revision | null>;
  upsertRevision(r: Revision): Promise<void>;

  listReviews(revisionId: string): Promise<Review[]>;
  upsertReviews(rs: Review[]): Promise<void>;

  listThreads(filter: { productId?: string; revisionId?: string }): Promise<Thread[]>;
  getThread(id: string): Promise<Thread | null>;
  upsertThread(t: Thread): Promise<void>;

  listNotifications(userId: string): Promise<AppNotification[]>;
  addNotifications(n: AppNotification[]): Promise<void>;
  markNotificationsRead(userId: string, ids: string[]): Promise<void>;

  listBoards(workspaceId: string): Promise<Board[]>;
  getBoard(id: string): Promise<Board | null>;
  upsertBoard(b: Board): Promise<void>;

  listMeetings(filter: { productId?: string }): Promise<Meeting[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  upsertMeeting(m: Meeting): Promise<void>;
  listNotes(meetingId: string): Promise<MeetingNote[]>;
  upsertNotes(n: MeetingNote[]): Promise<void>;
  listDecisions(meetingId: string): Promise<Decision[]>;
  upsertDecisions(d: Decision[]): Promise<void>;
  getRecording(meetingId: string): Promise<Recording | null>;
  upsertRecording(r: Recording): Promise<void>;

  appendAudit(e: AuditEvent[]): Promise<void>;
  listAudit(filter: { workspaceId: string; productId?: string; revisionId?: string; limit?: number }): Promise<AuditEvent[]>;

  appendAiRun(r: AiRunLog): Promise<void>;
  listAiRuns(revisionId: string): Promise<AiRunLog[]>;

  putFile(name: string, bytes: Uint8Array, mime: string): Promise<StoredFile>;
  getFile(uri: string): Promise<{ file: StoredFile; bytes: Uint8Array } | null>;

  /** Data ownership (PRD §12): everything for a workspace as JSON. */
  exportAll(workspaceId: string): Promise<Record<string, unknown>>;
}
