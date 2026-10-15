import type { MeetingRole, Team } from '@bom/domain';
import { can } from '@bom/domain';
import { createMeeting } from '@bom/workflow';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { loadRevision } from '@/server/service';

export const GET = route(async (req) => {
  const { repo } = await requireSession(req);
  const productId = new URL(req.url).searchParams.get('productId') ?? undefined;
  return { meetings: await repo.listMeetings({ productId }) };
});

/** Meeting setup (PRD §9 "Before the meeting"): product + revision, invitees with team roles, agenda from L1. */
export const POST = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  if (!can(user, 'manageMeeting').allowed) throw new HttpError(403, 'Only editors and leads set up meetings');
  const b = await body<{ revisionId: string; title: string; noteTakerId: string; participants: { userId: string; team: Team; role: MeetingRole; device: 'tablet' | 'laptop' | 'paper' }[] }>(req);
  const { revision, product } = await loadRevision(repo, b.revisionId);
  const users = await repo.listUsers(workspace.id);
  const noteTaker = users.find((u) => u.id === b.noteTakerId) ?? user;
  const m = createMeeting({ productId: product.id, revisionId: revision.id, content: revision.content, title: b.title, lead: user, noteTaker, participants: b.participants });
  await repo.upsertMeeting(m);
  await repo.upsertRevision({ ...revision, meetingIds: [...new Set([...revision.meetingIds, m.id])] }).catch(() => {});
  return { meeting: m };
});
