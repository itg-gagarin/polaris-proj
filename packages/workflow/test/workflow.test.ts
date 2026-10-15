import { describe, it, expect, beforeAll } from 'vitest';
import type { User, Product, RevisionContent } from '@bom/domain';
import { DEFAULT_SETTINGS, applyPatch, makePatch, contentHash } from '@bom/domain';
import { loadHollan } from '@bom/fixtures';
import { analyze } from '@bom/engine';
import {
  newRevision, submitRevision, approveLane, requestChanges, reconcileState, releaseRevision, onContentChanged, startNextDraft, nextLabel,
  forkAlternative, promoteAlternative, changesSinceApproval, createThread, reply, toTask, carryForward, parseMentions,
  mentionNotifications, laneNotifications, createMeeting, startMeeting, addNote, shareNote, mergeNotes, recordDecision, closeMeeting,
  decisionsToChangeRequests, startRecording, tagSegment, autoAnswers, personalSheet, WorkflowError,
} from '../src';

const u = (id: string, name: string, teams: User['teams'], role: User['role']): User => ({ id, name, email: `${id}@itg.test`, teams, role, color: '#000', locale: 'id', external: false });
const lead = u('lead', 'Pak Margono', ['design'], 'lead');
const editor = u('ed', 'Budi Santoso', ['engineering'], 'editor');
const reviewers: Record<string, User> = Object.fromEntries((['design', 'engineering', 'finishing', 'assembly', 'hardware', 'packing', 'qc'] as const).map((t) => [t, u(`r-${t}`, `Reviewer ${t}`, [t], 'reviewer')]));
const users = [lead, editor, ...Object.values(reviewers)];
let content: RevisionContent;
const product: Product = { id: 'p1', workspaceId: 'w', code: 'HH-CC-NIGHT-STAND', name: 'Night Stand', category: 'Storage & Casegoods', subCategory: 'Nightstands', currentRevisionId: null, sharedWithBuyer: false, componentProductIds: [], createdAt: '' };

beforeAll(async () => {
  content = (await loadHollan()).find((p) => p.code === 'HH-CC-NIGHT-STAND')!.content;
});

describe('revision states (PRD §9)', () => {
  it('labels advance A → B, Z → AA, R5 → R6', () => {
    expect([nextLabel('A'), nextLabel('Z'), nextLabel('R5'), nextLabel('AZ')]).toEqual(['B', 'AA', 'R6', 'BA']);
  });

  it('draft → in review → approved → released, release blocked until every required lane approves', () => {
    let rev = newRevision(product.id, 'R5', content, editor);
    expect(() => submitRevision(rev, product, editor, '', DEFAULT_SETTINGS)).toThrow(/note is required/);
    const sub = submitRevision(rev, product, editor, 'Initial import from Hollan House Rev. 5', DEFAULT_SETTINGS);
    rev = sub.revision;
    let reviews = sub.reviews;
    expect(rev.state).toBe('in_review');
    expect(reviews.map((r) => r.team)).toEqual(['design', 'engineering', 'finishing', 'assembly', 'hardware', 'packing', 'qc']);
    expect(() => releaseRevision(rev, reviews, lead)).toThrow(WorkflowError);
    // a reviewer can't approve another team's lane
    expect(() => approveLane(rev, reviews[0], reviewers.qc, { hash: rev.submittedHash! })).toThrow(/Only design reviewers/);
    reviews = reviews.map((r) => approveLane(rev, r, reviewers[r.team], { hash: contentHash(rev.content) }));
    rev = reconcileState(rev, reviews);
    expect(rev.state).toBe('approved');
    expect(() => releaseRevision(rev, reviews, editor)).toThrow(/cannot releaseRevision/);
    const released = releaseRevision(rev, reviews, lead);
    expect(released.state).toBe('released');
    // released revisions are read-only; editing starts the next draft
    expect(() => onContentChanged(released, content, content, reviews)).toThrow(/read-only/);
    const next = startNextDraft(released, editor);
    expect(next).toMatchObject({ label: 'R6', state: 'draft', parentRevisionId: released.id });
  });

  it('an approval is tied to the content hash; a stale review is refused', () => {
    const { revision, reviews } = submitRevision(newRevision(product.id, 'A', content, editor), product, editor, 'note', DEFAULT_SETTINGS);
    expect(() => approveLane(revision, reviews[0], reviewers.design, { hash: 'old' })).toThrow(/changed since you opened it/);
  });

  it('an edit in a team scope resets that lane and says what changed', () => {
    let { revision, reviews } = submitRevision(newRevision(product.id, 'A', content, editor), product, editor, 'note', DEFAULT_SETTINGS);
    reviews = reviews.map((r) => approveLane(revision, r, reviewers[r.team], { hash: contentHash(revision.content) }));
    revision = reconcileState(revision, reviews);
    const slide = content.parts.find((p) => p.role === 'slide')!;
    const after = applyPatch(content, makePatch([{ op: 'setField', partId: slide.id, field: 'hardwareSku', value: 'SH-ABC FE 300' }], 'sku')).content;
    const r = onContentChanged(revision, content, after, reviews);
    expect(r.reset).toEqual(['hardware']);
    expect(r.reviews.find((x) => x.team === 'hardware')!.resetReason).toMatch(/hardwareSku/);
    expect(r.revision.state).toBe('in_review');
    expect(reconcileState(r.revision, r.reviews).state).toBe('in_review');
  });

  it('any lane can request changes, sending the revision back to draft on the next edit', () => {
    const { revision, reviews } = submitRevision(newRevision(product.id, 'A', content, editor), product, editor, 'note', DEFAULT_SETTINGS);
    const rc = requestChanges(revision, reviews[2], reviewers.finishing, 'Finish code missing on profil top samp');
    expect(rc.revision.state).toBe('changes_requested');
    expect(onContentChanged(rc.revision, content, content, reviews).revision.state).toBe('draft');
  });

  it('alternatives fork and one is promoted, siblings archived', () => {
    const base = newRevision(product.id, 'B', content, editor);
    const wood = forkAlternative(base, 'wood', editor);
    const metal = forkAlternative(base, 'metal', editor);
    expect(wood.label).toBe('B-wood');
    const r = promoteAlternative(metal, [wood, metal]);
    expect(r.promoted.branch?.status).toBe('promoted');
    expect(r.archived.map((x) => x.label)).toEqual(['B-wood']);
  });

  it('review assistant lists what changed in a team scope since its approval', () => {
    const front = content.parts.find((p) => p.role === 'drawerFront')!;
    const after = applyPatch(content, makePatch([{ op: 'setField', partId: front.id, field: 'finishCode', value: 'F-12' }], 'f')).content;
    expect(changesSinceApproval('finishing', content, after)[0]).toMatch(/finishCode/);
  });

  it('checklists are pre-answered from the findings', () => {
    const a = analyze(content);
    const ans = autoAnswers('hardware', a.findings);
    expect(ans['slide-fit']).toBe(false); // drawer-box-vs-slide fails on the night stand
  });
});

describe('comments, tasks, notifications', () => {
  it('parses mentions, threads move with their part to the next draft', () => {
    expect(parseMentions('@Budi tolong cek, cc @pak margono', users)).toEqual(['ed', 'lead']);
    const part = content.parts.find((p) => p.role === 'drawerFront')!;
    let t = createThread({ productId: 'p1', revisionId: 'r1', anchor: { kind: 'part', partId: part.id, stdCode: part.stdCode, position: part.position }, author: lead, body: '@Budi reveal looks tight', users });
    t = reply(t, editor, 'Will check', users);
    t = toTask(t, { assigneeId: editor.id, due: '2026-10-20' });
    expect(mentionNotifications({ ...t, comments: t.comments.slice(0, 1) }, lead)[0].userId).toBe('ed');
    const nextContent = { ...content, parts: content.parts.map((p) => (p.id === part.id ? { ...p, id: 'new-id' } : p)) };
    const moved = carryForward([t], content, nextContent, 'r2');
    expect(moved[0]).toMatchObject({ revisionId: 'r2', carriedFromThreadId: t.id, anchor: { kind: 'part', partId: 'new-id' } });
  });

  it('lane notifications go to the members of each team', () => {
    const { revision, reviews } = submitRevision(newRevision(product.id, 'A', content, editor), product, editor, 'note', DEFAULT_SETTINGS);
    const n = laneNotifications(revision, reviews, users, 'submitted');
    expect(n.map((x) => x.userId).sort()).toEqual(['ed', 'lead', ...Object.values(reviewers).map((r) => r.id)].sort());
  });
});

describe('meeting mode (PRD §9)', () => {
  it('runs a product meeting end to end into change requests on the draft', () => {
    const participants = users.map((x) => ({ userId: x.id, team: x.teams[0], role: (x.id === lead.id ? 'lead' : x.id === editor.id ? 'noteTaker' : 'participant') as 'lead' | 'noteTaker' | 'participant', device: 'tablet' as const }));
    let m = createMeeting({ productId: 'p1', revisionId: 'r1', content, title: 'Night stand review', lead, noteTaker: editor, participants });
    expect(m.agenda.map((a) => a.title)).toContain('RAKITAN LACI');
    expect(personalSheet(m, reviewers.finishing, 'finishing').frames).toContain('finish-codes');
    expect(() => startMeeting(m, editor)).toThrow();
    m = startMeeting(m, lead);
    const front = content.parts.find((p) => p.role === 'drawerFront')!;
    const anchor = { kind: 'part' as const, partId: front.id, stdCode: front.stdCode, position: front.position };
    const n1 = shareNote(addNote(m, reviewers.finishing, 'finishing', anchor, { kind: 'ink', ink: [{ points: [{ x: 1, y: 2, p: 0.5 }], color: '#e11', width: 2 }], tag: 'issue' }));
    const n2 = addNote(m, reviewers.hardware, 'hardware', anchor, { kind: 'text', text: 'private thought' });
    const n3 = shareNote(addNote(m, reviewers.design, 'design', { kind: 'sheet', sheetId: 'front', x: 1, y: 1 }, { kind: 'text', text: 'Handle position?', tag: 'question' }));
    // offline copy of n1 edited later wins
    const merged = mergeNotes([n1, n2, n3], [{ ...n1, clientId: n1.id, id: n1.id, text: 'edited offline', at: '2999-01-01' }]);
    expect(merged.find((n) => n.id === n1.id)?.text).toBe('edited offline');
    expect(() => startRecording(m.id, [{ userId: 'x', granted: false }])).toThrow(/consent/);
    const rec = startRecording(m.id, users.map((x) => ({ userId: x.id, granted: true })));
    rec.segments.push(tagSegment({ id: 's1', start: 12, end: 20, speakerId: lead.id, text: 'Reveal on the drawer is too tight' }, [{ at: 0, partIds: [front.id], sheetId: null }]));
    const d = recordDecision(m, editor, { text: 'Reduce drawer front to 455 mm', partIds: [front.id], ownerTeam: 'design', due: '2026-10-22', transcriptRef: { segmentId: 's1', start: 12 } });
    const closed = closeMeeting(m, lead, merged, [d], rec, content, users, DEFAULT_SETTINGS);
    expect(closed.meeting.state).toBe('closed');
    expect(closed.record.notesByPart.find((g) => g.partId === front.id)?.byTeam[0].team).toBe('finishing');
    expect(closed.record.openQuestions.map((q) => q.text)).toEqual(['Handle position?']);
    expect(closed.record.notesByPart.flatMap((g) => g.byTeam.flatMap((t) => t.notes)).some((n) => n.text === 'private thought')).toBe(false);
    expect(closed.record.transcript[0].partIds).toEqual([front.id]);
    const cr = decisionsToChangeRequests(closed.meeting, closed.record.decisions, 'draft-2', editor, users, content);
    expect(cr.threads[0]).toMatchObject({ kind: 'changeRequest', task: { team: 'design', due: '2026-10-22' }, revisionId: 'draft-2' });
    expect(cr.decisions[0].linkedThreadId).toBe(cr.threads[0].id);
  });

  it('auto-shares unpublished notes at close when the workspace says so', () => {
    const m = startMeeting(createMeeting({ productId: 'p', revisionId: 'r', content, title: 't', lead, noteTaker: lead, participants: [] }), lead);
    const n = addNote(m, editor, 'engineering', { kind: 'point', point: { x: 0, y: 0, z: 0 } }, { kind: 'text', text: 'x' });
    const closed = closeMeeting(m, lead, [n], [], null, content, users, { ...DEFAULT_SETTINGS, meetings: { ...DEFAULT_SETTINGS.meetings, unpublishedNotesAtClose: 'auto-share' } });
    expect(closed.notes[0].visibility).toBe('shared');
  });
});
