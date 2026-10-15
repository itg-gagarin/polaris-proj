import type { Id } from './ids';
import type { Role, Team, MeetingRole } from './teams';
import type { Vec3, ChangeSource, Confidence, Patch } from './model';
import type { WorkspaceSettings } from './settings';

export interface User {
  id: Id;
  name: string;
  email: string;
  teams: Team[];
  role: Role;
  color: string;
  locale: 'en' | 'id';
  external: boolean;
}

export interface Workspace {
  id: Id;
  name: string;
  settings: WorkspaceSettings;
  memberIds: Id[];
}

/* ------------------------------------------------------------------ */
/* Review lanes                                                        */
/* ------------------------------------------------------------------ */

export type LaneState = 'pending' | 'approved' | 'changes_requested';

export interface ChecklistItem {
  id: string;
  text: { en: string; id: string };
  /** Optional check rule ids whose findings answer this item automatically. */
  ruleIds?: string[];
}

export interface Review {
  id: Id;
  revisionId: Id;
  team: Team;
  state: LaneState;
  reviewerId: Id | null;
  /** Content hash the approval is tied to. */
  hash: string | null;
  checklist: Record<string, boolean>;
  comment: string;
  at: string | null;
  /** Set when the lane was reset by a scope edit: what changed. */
  resetReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Comments, tasks, notifications                                      */
/* ------------------------------------------------------------------ */

export type Anchor =
  | { kind: 'part'; partId: Id; stdCode: string | null; position: string | null; point?: Vec3 }
  | { kind: 'point'; point: Vec3 }
  | { kind: 'sheet'; sheetId: Id; region: { x: number; y: number; w: number; h: number } }
  | { kind: 'bomCell'; partId: Id; column: string }
  | { kind: 'revision' }
  | { kind: 'finding'; findingKey: string };

export interface Attachment {
  id: Id;
  name: string;
  mime: string;
  uri: string;
}

export interface Comment {
  id: Id;
  threadId: Id;
  authorId: Id;
  body: string;
  mentions: Id[];
  attachments: Attachment[];
  createdAt: string;
  editedAt: string | null;
}

export interface Thread {
  id: Id;
  productId: Id;
  revisionId: Id;
  anchor: Anchor;
  status: 'open' | 'resolved';
  kind: 'comment' | 'checkNote' | 'revisionNote' | 'changeRequest';
  /** Tag carried from meeting notes. */
  tag: NoteTag | null;
  comments: Comment[];
  task: Task | null;
  createdAt: string;
  /** Threads carry forward to the next draft; this links to the original. */
  carriedFromThreadId: Id | null;
  meetingId: Id | null;
  /** Out-of-scope edit saved as a suggestion for the owning team (PRD §2); accepting applies it. */
  suggestion?: Patch | null;
}

export interface Task {
  assigneeId: Id | null;
  team: Team | null;
  due: string | null;
  done: boolean;
}

export type NotificationKind = 'mention' | 'assignment' | 'lane' | 'revision' | 'meeting' | 'ai';

export interface AppNotification {
  id: Id;
  userId: Id;
  kind: NotificationKind;
  text: string;
  link: string;
  read: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Board (canvas)                                                      */
/* ------------------------------------------------------------------ */

export type FrameType = 'viewport' | 'sheet' | 'bom' | 'compare' | 'findings' | 'assumptions' | 'record';
export type MarkupType = 'rect' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'pencil' | 'text' | 'note' | 'image';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameItem {
  id: Id;
  kind: 'frame';
  type: FrameType;
  rect: Rect;
  z: number;
  title: string;
  productId: Id | null;
  revisionId: Id | null;
  /** Frame-specific config: camera, shading, lens, sheet view, compare revision ids... */
  props: Record<string, unknown>;
}

export interface MarkupStyle {
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  sketchy: boolean;
  fontSize?: number;
}

export interface MarkupItem {
  id: Id;
  kind: 'markup';
  type: MarkupType;
  /** Board coordinates (or frame-local when pinned to a part). */
  points: { x: number; y: number; p?: number }[];
  rect: Rect;
  text: string;
  style: MarkupStyle;
  z: number;
  authorId: Id;
  /** Arrow/line endpoint bindings to other items. */
  bindStart: Id | null;
  bindEnd: Id | null;
  /** Pinned to a part: moves with the part (frame + part id + offset). */
  pin: { frameId: Id; partId: Id; offset: { x: number; y: number } } | null;
  team: Team | null;
}

export type BoardItem = FrameItem | MarkupItem;

export interface Board {
  id: Id;
  workspaceId: Id;
  name: string;
  items: BoardItem[];
}

/* ------------------------------------------------------------------ */
/* Meetings                                                            */
/* ------------------------------------------------------------------ */

export type NoteTag = 'question' | 'issue' | 'decision-needed' | 'idea';

export interface Meeting {
  id: Id;
  productId: Id;
  revisionId: Id;
  title: string;
  leadId: Id;
  noteTakerId: Id;
  /** Agenda built from the assemblies (L1), in order. */
  agenda: { assemblyId: Id | null; title: string; done: boolean }[];
  state: 'planned' | 'live' | 'closed';
  startedAt: string | null;
  closedAt: string | null;
  presenter: { userId: Id | null; view: unknown } | null;
  participants: Participant[];
  record: MeetingRecord | null;
}

export interface Participant {
  userId: Id;
  team: Team;
  role: MeetingRole;
  device: 'tablet' | 'laptop' | 'paper';
  following: boolean;
  published: boolean;
}

export interface InkStroke {
  points: { x: number; y: number; p: number }[];
  color: string;
  width: number;
}

export type NoteAnchor =
  | { kind: 'part'; partId: Id; stdCode: string | null; position: string | null; point?: Vec3 }
  | { kind: 'sheet'; sheetId: string; x: number; y: number }
  | { kind: 'point'; point: Vec3 };

export interface MeetingNote {
  id: Id;
  meetingId: Id;
  authorId: Id;
  team: Team;
  visibility: 'private' | 'shared';
  anchor: NoteAnchor;
  kind: 'ink' | 'text' | 'voice';
  ink: InkStroke[];
  text: string;
  tag: NoteTag | null;
  at: string;
  /** Offline-created notes carry a client timestamp and sync later. */
  clientId: string | null;
}

export interface Decision {
  id: Id;
  meetingId: Id;
  text: string;
  partIds: Id[];
  ownerTeam: Team;
  due: string | null;
  status: 'proposed' | 'confirmed' | 'rejected' | 'done';
  /** Change request / task created on the draft revision. */
  linkedThreadId: Id | null;
  transcriptRef: { segmentId: Id; start: number } | null;
  confirmedBy: Id | null;
  source: 'note-taker' | 'ai';
  confidence: Confidence | null;
}

export interface TranscriptSegment {
  id: Id;
  start: number;
  end: number;
  speakerId: Id | null;
  text: string;
  /** Part or sheet the presenter had on screen at that moment. */
  partIds: Id[];
  sheetId: string | null;
}

export interface Recording {
  meetingId: Id;
  audioUri: string | null;
  consent: { userId: Id; at: string; granted: boolean }[];
  segments: TranscriptSegment[];
  bookmarks: { userId: Id; at: number; label: string }[];
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface MeetingRecord {
  generatedAt: string;
  attendees: { userId: Id; name: string; team: Team; role: MeetingRole; device: string }[];
  decisions: Decision[];
  /** Published notes grouped by part, then by team. */
  notesByPart: { partId: Id | null; partName: string; byTeam: { team: Team; notes: MeetingNote[] }[] }[];
  openQuestions: MeetingNote[];
  transcript: TranscriptSegment[];
  summary: string;
}

export interface PersonalSheet {
  meetingId: Id;
  userId: Id;
  template: Team;
  frames: string[];
  printed: boolean;
  qr: boolean;
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export interface AuditEvent {
  id: Id;
  workspaceId: Id;
  productId: Id | null;
  revisionId: Id | null;
  who: Id;
  what: string;
  before: unknown;
  after: unknown;
  at: string;
  source: ChangeSource;
}
