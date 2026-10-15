import type { Team, Waiver } from '@bom/domain';
import { contentHash, makePatch } from '@bom/domain';
import { approveLane, carryForward, forkAlternative, laneNotifications, promoteAlternative, reconcileState, releaseRevision, requestChanges, startNextDraft, submitRevision, auditEvent } from '@bom/workflow';
import { jobs } from '@bom/worker';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { getQueue } from '@/server/context';
import { applyUserPatch, loadRevision, revisionBundle } from '@/server/service';

type Action =
  | { action: 'submit'; note: string }
  | { action: 'approve'; team: Team; hash: string; checklist?: Record<string, boolean>; comment?: string }
  | { action: 'requestChanges'; team: Team; comment: string }
  | { action: 'release' }
  | { action: 'nextDraft' }
  | { action: 'fork'; name: string }
  | { action: 'promote' }
  | { action: 'waive'; findingKey: string; reason: string; kind: Waiver['kind'] }
  | { action: 'unwaive'; findingKey: string };

/** Revision workflow (PRD §9): submit → lanes → release; drafts, alternatives, waivers. */
export const POST = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const id = (await params).id;
  const a = await body<Action>(req);
  const { revision, product } = await loadRevision(repo, id);
  const users = await repo.listUsers(workspace.id);
  const audit = (what: string, after: unknown = null, revisionId = id) => repo.appendAudit([auditEvent({ workspaceId: workspace.id, productId: product.id, revisionId, who: user.id, what, before: null, after, source: 'user' })]);
  let goTo = id;

  switch (a.action) {
    case 'submit': {
      const r = submitRevision(revision, product, user, a.note, workspace.settings);
      await repo.upsertRevision(r.revision);
      await repo.upsertReviews(r.reviews);
      await repo.addNotifications(laneNotifications(r.revision, r.reviews, users, 'submitted'));
      await audit(`Submitted ${revision.label} for review`, { lanes: r.reviews.map((x) => x.team), hash: r.revision.submittedHash });
      break;
    }
    case 'approve': {
      const reviews = await repo.listReviews(id);
      const lane = reviews.find((r) => r.team === a.team);
      if (!lane) throw new HttpError(404, `No ${a.team} lane on this revision`);
      const approved = approveLane(revision, lane, user, { hash: a.hash, checklist: a.checklist, comment: a.comment });
      const next = reviews.map((r) => (r.id === approved.id ? approved : r));
      await repo.upsertReviews([approved]);
      await repo.upsertRevision(reconcileState(revision, next));
      await audit(`Approved the ${a.team} lane`, { hash: a.hash });
      break;
    }
    case 'requestChanges': {
      const reviews = await repo.listReviews(id);
      const lane = reviews.find((r) => r.team === a.team);
      if (!lane) throw new HttpError(404, `No ${a.team} lane on this revision`);
      const r = requestChanges(revision, lane, user, a.comment);
      await repo.upsertReviews([r.review]);
      await repo.upsertRevision(r.revision);
      await repo.addNotifications(laneNotifications(r.revision, [r.review], users, 'changes_requested'));
      await audit(`Requested changes (${a.team}): ${a.comment}`);
      break;
    }
    case 'release': {
      const reviews = await repo.listReviews(id);
      const released = releaseRevision(revision, reviews, user);
      await repo.upsertRevision(released);
      await repo.upsertProduct({ ...product, currentRevisionId: released.id });
      await repo.addNotifications(laneNotifications(released, reviews, users, 'released'));
      await audit(`Released ${revision.label}`, { hash: contentHash(released.content) });
      const q = await getQueue();
      await jobs.erpPush(q, { revisionId: released.id });
      break;
    }
    case 'nextDraft': {
      const draft = startNextDraft(revision, user);
      await repo.upsertRevision(draft);
      const open = (await repo.listThreads({ revisionId: id })).filter((t) => t.status === 'open');
      for (const t of carryForward(open, revision.content, draft.content, draft.id)) await repo.upsertThread(t);
      await repo.upsertProduct({ ...product, currentRevisionId: draft.id });
      await audit(`Started ${draft.label} from ${revision.label}`, { from: id }, draft.id);
      goTo = draft.id;
      break;
    }
    case 'fork': {
      const alt = forkAlternative(revision, a.name, user);
      await repo.upsertRevision(alt);
      await audit(`Forked alternative ${alt.label}`, { from: id }, alt.id);
      goTo = alt.id;
      break;
    }
    case 'promote': {
      const siblings = (await repo.listRevisions(product.id)).filter((r) => r.id !== id && r.branch && r.parentRevisionId === revision.parentRevisionId);
      const res = promoteAlternative(revision, siblings);
      for (const r of [res.promoted, ...res.archived]) await repo.upsertRevision(r);
      await audit(`Promoted alternative ${revision.label}`, { archived: res.archived.map((r) => r.label) });
      break;
    }
    case 'waive':
    case 'unwaive': {
      const waiver: Waiver | null = a.action === 'waive' ? { findingKey: a.findingKey, kind: a.kind, reason: a.reason, by: user.id, at: new Date().toISOString() } : null;
      if (a.action === 'waive' && !a.reason.trim()) throw new HttpError(400, 'A waiver needs a reason');
      await applyUserPatch(repo, user, workspace, id, makePatch([{ op: 'setWaiver', findingKey: a.findingKey, waiver }], waiver ? `Waived: ${waiver.reason}` : 'Removed waiver'));
      break;
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
  return revisionBundle(repo, user, workspace, goTo);
});
