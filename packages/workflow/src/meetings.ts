import type {
  Meeting, Participant, MeetingNote, Decision, MeetingRecord, Recording, User, RevisionContent, Thread, Team, TranscriptSegment, NoteAnchor, PersonalSheet, WorkspaceSettings,
} from '@bom/domain';
import { newId, can, TEAMS } from '@bom/domain';
import { WorkflowError } from './errors';
import { createThread, toTask } from './comments';

const now = () => new Date().toISOString();

export function createMeeting(opts: { productId: string; revisionId: string; content: RevisionContent; title: string; lead: User; noteTaker: User; participants: Omit<Participant, 'following' | 'published'>[] }): Meeting {
  if (!can(opts.lead, 'manageMeeting').allowed) throw new WorkflowError('Only editors and leads run meetings', 'forbidden');
  // Agenda from the assemblies (L1), in order; skip packing / hardware packs.
  const agenda = opts.content.assemblies
    .filter((a) => a.role !== 'hardwarePack' && a.role !== 'packing' && a.role !== 'veneer')
    .map((a) => ({ assemblyId: a.id, title: a.originalName.trim() || a.name, done: false }));
  return {
    id: newId('mtg'),
    productId: opts.productId,
    revisionId: opts.revisionId,
    title: opts.title,
    leadId: opts.lead.id,
    noteTakerId: opts.noteTaker.id,
    agenda,
    state: 'planned',
    startedAt: null,
    closedAt: null,
    presenter: { userId: opts.lead.id, view: null },
    participants: opts.participants.map((p) => ({ ...p, following: true, published: false })),
    record: null,
  };
}

/** What each person's personal spec sheet shows, by team (PRD §9). */
export const SHEET_TEMPLATES: Record<string, { frames: string[]; partFilter: (team: Team) => (p: { teamOwner: Team; kind: string; finishCode: string | null; role: string | null }) => boolean }> = {
  default: { frames: ['front', 'side', 'top', 'iso', 'dimensions', 'part-list'], partFilter: () => () => true },
};

export function personalSheet(meeting: Meeting, user: User, team: Team, opts: { printed?: boolean } = {}): PersonalSheet {
  const frames = ['front', 'side', 'top', 'iso', 'overall-dimensions', 'part-list'];
  if (team === 'finishing') frames.push('finish-codes', 'visible-faces');
  if (team === 'assembly') frames.push('exploded', 'assembly-sequence');
  if (team === 'hardware') frames.push('hardware-list', 'hardware-fit');
  if (team === 'packing') frames.push('packing');
  if (team === 'engineering') frames.push('joints', 'clashes');
  return { meetingId: meeting.id, userId: user.id, template: team, frames, printed: !!opts.printed, qr: !!opts.printed };
}

export function startMeeting(m: Meeting, by: User): Meeting {
  if (by.id !== m.leadId) throw new WorkflowError('Only the meeting lead starts the meeting', 'forbidden');
  return { ...m, state: 'live', startedAt: now() };
}

export function addNote(m: Meeting, author: User, team: Team, anchor: NoteAnchor, body: { kind: MeetingNote['kind']; text?: string; ink?: MeetingNote['ink']; tag?: MeetingNote['tag'] }, clientId: string | null = null): MeetingNote {
  if (m.state === 'closed') throw new WorkflowError('The meeting is closed', 'invalid-state');
  return { id: newId('note'), meetingId: m.id, authorId: author.id, team, visibility: 'private', anchor, kind: body.kind, ink: body.ink ?? [], text: body.text ?? '', tag: body.tag ?? null, at: now(), clientId };
}

export const shareNote = (n: MeetingNote): MeetingNote => ({ ...n, visibility: 'shared' });

/** Offline notes: merge by clientId, newest wins (notes taken on bad Wi-Fi sync when the connection returns). */
export function mergeNotes(server: MeetingNote[], incoming: MeetingNote[]): MeetingNote[] {
  const byKey = new Map(server.map((n) => [n.clientId ?? n.id, n]));
  for (const n of incoming) {
    const k = n.clientId ?? n.id;
    const prev = byKey.get(k);
    if (!prev || prev.at <= n.at) byKey.set(k, n);
  }
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export function recordDecision(m: Meeting, by: User, d: Omit<Decision, 'id' | 'meetingId' | 'status' | 'linkedThreadId' | 'confirmedBy' | 'source' | 'confidence'> & Partial<Pick<Decision, 'source' | 'confidence'>>): Decision {
  if (by.id !== m.noteTakerId && by.id !== m.leadId) throw new WorkflowError('The note-taker records decisions', 'forbidden');
  return { id: newId('dec'), meetingId: m.id, status: 'confirmed', linkedThreadId: null, confirmedBy: by.id, source: d.source ?? 'note-taker', confidence: d.confidence ?? null, text: d.text, partIds: d.partIds, ownerTeam: d.ownerTeam, due: d.due, transcriptRef: d.transcriptRef };
}

/** AI-proposed cards are never logged automatically: a person confirms each (PRD §9). */
export function confirmProposed(d: Decision, by: User): Decision {
  if (d.status !== 'proposed') return d;
  return { ...d, status: 'confirmed', confirmedBy: by.id };
}

export function startRecording(meetingId: string, consents: { userId: string; granted: boolean }[]): Recording {
  if (!consents.length || consents.some((c) => !c.granted)) throw new WorkflowError('Recording needs consent from everyone in the room', 'forbidden');
  return { meetingId, audioUri: null, consent: consents.map((c) => ({ ...c, at: now() })), segments: [], bookmarks: [], startedAt: now(), stoppedAt: null };
}

/** Tag a transcript segment with the part/sheet the presenter had on screen at that moment. */
export function tagSegment(seg: Omit<TranscriptSegment, 'partIds' | 'sheetId'>, presenterTrail: { at: number; partIds: string[]; sheetId: string | null }[]): TranscriptSegment {
  const view = [...presenterTrail].reverse().find((v) => v.at <= seg.start) ?? presenterTrail[0];
  return { ...seg, partIds: view?.partIds ?? [], sheetId: view?.sheetId ?? null };
}

/**
 * Close the meeting and build the combined record: attendees, decisions, published notes grouped
 * by part then team, open questions, transcript (PRD §9 "After the meeting").
 */
export function closeMeeting(m: Meeting, by: User, notes: MeetingNote[], decisions: Decision[], recording: Recording | null, content: RevisionContent, users: User[], settings: WorkspaceSettings): { meeting: Meeting; notes: MeetingNote[]; record: MeetingRecord } {
  if (by.id !== m.leadId) throw new WorkflowError('Only the meeting lead closes the meeting', 'forbidden');
  const finalNotes = settings.meetings.unpublishedNotesAtClose === 'auto-share' ? notes.map(shareNote) : notes;
  const published = finalNotes.filter((n) => n.visibility === 'shared');
  const partName = (id: string | null) => (id ? content.parts.find((p) => p.id === id)?.originalName ?? '(removed part)' : 'Sheet / general');
  const groups = new Map<string | null, MeetingNote[]>();
  for (const n of published) {
    const k = n.anchor.kind === 'part' ? n.anchor.partId : null;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const notesByPart = [...groups.entries()].map(([partId, ns]) => {
    const teams = new Map<Team, MeetingNote[]>();
    for (const n of ns) teams.set(n.team, [...(teams.get(n.team) ?? []), n]);
    return { partId, partName: partName(partId), byTeam: [...teams.entries()].map(([team, list]) => ({ team, notes: list })) };
  });
  const confirmed = decisions.filter((d) => d.status === 'confirmed');
  const attendees = m.participants.map((p) => ({ userId: p.userId, name: users.find((u) => u.id === p.userId)?.name ?? p.userId, team: p.team, role: p.role, device: p.device }));
  const record: MeetingRecord = {
    generatedAt: now(),
    attendees,
    decisions: confirmed,
    notesByPart,
    openQuestions: published.filter((n) => n.tag === 'question' || n.tag === 'decision-needed'),
    transcript: recording?.segments ?? [],
    summary: `${m.title}: ${attendees.length} attendees, ${confirmed.length} decision(s), ${published.length} shared note(s) on ${groups.size} part(s).`,
  };
  return { meeting: { ...m, state: 'closed', closedAt: now(), record }, notes: finalNotes, record };
}

/** Each decision becomes a change request / task on the draft revision, assigned to its owner team. */
export function decisionsToChangeRequests(m: Meeting, decisions: Decision[], draftRevisionId: string, author: User, users: User[], content: RevisionContent): { threads: Thread[]; decisions: Decision[] } {
  const threads: Thread[] = [];
  const updated = decisions.map((d) => {
    if (d.status !== 'confirmed' || d.linkedThreadId) return d;
    const part = d.partIds[0] ? content.parts.find((p) => p.id === d.partIds[0]) : undefined;
    let t = createThread({
      productId: m.productId,
      revisionId: draftRevisionId,
      anchor: part ? { kind: 'part', partId: part.id, stdCode: part.stdCode, position: part.position } : { kind: 'revision' },
      author,
      users,
      body: `Decision (${m.title}): ${d.text}`,
      kind: 'changeRequest',
      meetingId: m.id,
    });
    t = toTask(t, { team: d.ownerTeam, due: d.due });
    threads.push(t);
    return { ...d, linkedThreadId: t.id };
  });
  return { threads, decisions: updated };
}

export function teamLabel(t: Team): string {
  return TEAMS[t].label.en;
}
