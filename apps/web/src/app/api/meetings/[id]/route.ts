import type { Decision, MeetingNote, NoteAnchor, Team } from '@bom/domain';
import { newId } from '@bom/domain';
import { meetingAssistant } from '@bom/ai';
import { addNote, closeMeeting, confirmProposed, decisionsToChangeRequests, mergeNotes, recordDecision, shareNote, startMeeting, startRecording, tagSegment, auditEvent } from '@bom/workflow';
import { route, body, HttpError, notFound } from '@/server/http';
import { requireSession } from '@/server/auth';
import { getAi } from '@/server/context';
import { loadRevision } from '@/server/service';

type Action =
  | { action: 'start' }
  | { action: 'note'; team: Team; anchor: NoteAnchor; kind: MeetingNote['kind']; text?: string; ink?: MeetingNote['ink']; tag?: MeetingNote['tag']; clientId?: string | null; share?: boolean }
  | { action: 'syncNotes'; notes: MeetingNote[] }
  | { action: 'share'; noteId: string }
  | { action: 'publishAll' }
  | { action: 'decision'; text: string; partIds: string[]; ownerTeam: Team; due: string | null; transcriptRef?: Decision['transcriptRef'] }
  | { action: 'confirm'; decisionId: string }
  | { action: 'reject'; decisionId: string }
  | { action: 'presenter'; view: unknown }
  | { action: 'consent'; granted: boolean }
  | { action: 'startRecording' }
  | { action: 'segment'; text: string; start: number; end: number; trail: { at: number; partIds: string[]; sheetId: string | null }[] }
  | { action: 'bookmark'; at: number; label: string }
  | { action: 'propose' }
  | { action: 'close'; draftRevisionId?: string };

async function bundle(repo: Awaited<ReturnType<typeof requireSession>>['repo'], id: string, userId: string) {
  const meeting = await repo.getMeeting(id);
  if (!meeting) throw notFound('Meeting');
  const notes = (await repo.listNotes(id)).filter((n) => n.visibility === 'shared' || n.authorId === userId);
  return { meeting, notes, decisions: await repo.listDecisions(id), recording: await repo.getRecording(id) };
}

export const GET = route(async (req, { params }) => {
  const { user, repo } = await requireSession(req);
  return bundle(repo, (await params).id, user.id);
});

export const POST = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const id = (await params).id;
  const m = await repo.getMeeting(id);
  if (!m) throw notFound('Meeting');
  const isLead = m.leadId === user.id;
  const isNoteTaker = m.noteTakerId === user.id || isLead;
  const a = await body<Action>(req);
  switch (a.action) {
    case 'start':
      await repo.upsertMeeting(startMeeting(m, user));
      break;
    case 'note': {
      const n = addNote(m, user, a.team, a.anchor, { kind: a.kind, text: a.text, ink: a.ink, tag: a.tag }, a.clientId ?? null);
      await repo.upsertNotes([a.share ? shareNote(n) : n]);
      break;
    }
    case 'syncNotes': {
      // Offline queue: notes taken without a connection, merged by client id.
      const mine = a.notes.filter((n) => n.authorId === user.id && n.meetingId === id);
      await repo.upsertNotes(mergeNotes(await repo.listNotes(id), mine).filter((n) => n.authorId === user.id));
      break;
    }
    case 'share': {
      const n = (await repo.listNotes(id)).find((x) => x.id === a.noteId);
      if (!n || n.authorId !== user.id) throw new HttpError(403, 'You can share only your own notes');
      await repo.upsertNotes([shareNote(n)]);
      break;
    }
    case 'publishAll': {
      const mine = (await repo.listNotes(id)).filter((n) => n.authorId === user.id && n.visibility === 'private');
      await repo.upsertNotes(mine.map(shareNote));
      await repo.upsertMeeting({ ...m, participants: m.participants.map((p) => (p.userId === user.id ? { ...p, published: true } : p)) });
      break;
    }
    case 'decision': {
      if (!isNoteTaker) throw new HttpError(403, 'Only the note-taker records decisions');
      await repo.upsertDecisions([recordDecision(m, user, { text: a.text, partIds: a.partIds, ownerTeam: a.ownerTeam, due: a.due, transcriptRef: a.transcriptRef ?? null })]);
      break;
    }
    case 'confirm':
    case 'reject': {
      if (!isNoteTaker) throw new HttpError(403, 'Only the note-taker confirms decisions');
      const d = (await repo.listDecisions(id)).find((x) => x.id === a.decisionId);
      if (!d) throw notFound('Decision');
      await repo.upsertDecisions([a.action === 'confirm' ? confirmProposed(d, user) : { ...d, status: 'rejected' }]);
      break;
    }
    case 'presenter':
      if (!isLead) throw new HttpError(403, 'Only the lead presents');
      await repo.upsertMeeting({ ...m, presenter: { userId: user.id, view: a.view } });
      break;
    case 'consent': {
      const rec = (await repo.getRecording(id)) ?? { meetingId: id, audioUri: null, consent: [], segments: [], bookmarks: [], startedAt: null, stoppedAt: null };
      await repo.upsertRecording({ ...rec, consent: [...rec.consent.filter((c) => c.userId !== user.id), { userId: user.id, at: new Date().toISOString(), granted: a.granted }] });
      break;
    }
    case 'startRecording': {
      if (!isLead) throw new HttpError(403, 'Only the lead starts recording');
      const rec = await repo.getRecording(id);
      const consents = m.participants.map((p) => ({ userId: p.userId, granted: !!rec?.consent.find((c) => c.userId === p.userId && c.granted) }));
      const started = startRecording(id, consents);
      await repo.upsertRecording({ ...started, consent: rec?.consent ?? started.consent, bookmarks: rec?.bookmarks ?? [] });
      break;
    }
    case 'segment': {
      const rec = await repo.getRecording(id);
      if (!rec?.startedAt) throw new HttpError(409, 'Recording has not started');
      const seg = tagSegment({ id: newId('seg'), start: a.start, end: a.end, speakerId: user.id, text: a.text }, a.trail);
      await repo.upsertRecording({ ...rec, segments: [...rec.segments, seg] });
      break;
    }
    case 'bookmark': {
      const rec = (await repo.getRecording(id)) ?? { meetingId: id, audioUri: null, consent: [], segments: [], bookmarks: [], startedAt: null, stoppedAt: null };
      await repo.upsertRecording({ ...rec, bookmarks: [...rec.bookmarks, { userId: user.id, at: a.at, label: a.label }] });
      break;
    }
    case 'propose': {
      if (!isNoteTaker) throw new HttpError(403, 'Only the note-taker asks for AI proposals');
      const { revision } = await loadRevision(repo, m.revisionId);
      const rec = await repo.getRecording(id);
      const notes = (await repo.listNotes(id)).filter((n) => n.visibility === 'shared');
      const out = await meetingAssistant(getAi(), id, rec?.segments ?? [], notes, revision.content);
      await repo.upsertDecisions(out.proposals);
      return { ...(await bundle(repo, id, user.id)), summary: out.summary };
    }
    case 'close': {
      const { revision } = await loadRevision(repo, m.revisionId);
      const users = await repo.listUsers(workspace.id);
      const closed = closeMeeting(m, user, await repo.listNotes(id), await repo.listDecisions(id), await repo.getRecording(id), revision.content, users, workspace.settings);
      await repo.upsertNotes(closed.notes);
      // Decisions → change requests on the draft (the meeting's revision if still editable, else the given draft).
      const draftId = a.draftRevisionId ?? (revision.state === 'released' ? null : revision.id);
      if (draftId) {
        const draft = (await repo.getRevision(draftId))!;
        const r = decisionsToChangeRequests(closed.meeting, closed.record.decisions, draftId, user, users, draft.content);
        for (const t of r.threads) await repo.upsertThread(t);
        await repo.upsertDecisions(r.decisions);
        closed.meeting.record = { ...closed.record, decisions: r.decisions.filter((d) => d.status === 'confirmed') };
        await repo.upsertRevision({ ...draft, meetingIds: [...new Set([...draft.meetingIds, id])] });
      }
      await repo.upsertMeeting(closed.meeting);
      await repo.appendAudit([auditEvent({ workspaceId: workspace.id, productId: m.productId, revisionId: m.revisionId, who: user.id, what: `Closed meeting "${m.title}"`, before: null, after: { decisions: closed.record.decisions.length }, source: 'meeting' })]);
      break;
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
  return bundle(repo, id, user.id);
});
