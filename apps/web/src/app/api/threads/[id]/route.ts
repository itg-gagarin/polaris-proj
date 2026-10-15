import type { Team } from '@bom/domain';
import { assignmentNotifications, mentionNotifications, reopenThread, reply, resolveThread, toTask } from '@bom/workflow';
import { route, body, HttpError, notFound } from '@/server/http';
import { requireSession } from '@/server/auth';
import { acceptSuggestion, assertCanView, loadRevision } from '@/server/service';

type Action =
  | { action: 'reply'; body: string }
  | { action: 'resolve' }
  | { action: 'reopen' }
  | { action: 'task'; assigneeId: string | null; team: Team | null; due: string | null }
  | { action: 'acceptSuggestion' }
  | { action: 'rejectSuggestion'; reason: string };

export const POST = route(async (req, { params }) => {
  const { user, workspace, repo } = await requireSession(req);
  const thread = await repo.getThread((await params).id);
  if (!thread) throw notFound('Thread');
  const { product } = await loadRevision(repo, thread.revisionId);
  assertCanView(user, product);
  const a = await body<Action>(req);
  const users = await repo.listUsers(workspace.id);
  switch (a.action) {
    case 'reply': {
      const t = reply(thread, user, a.body, users);
      await repo.upsertThread(t);
      await repo.addNotifications(mentionNotifications({ ...t, comments: t.comments.slice(-1) }, user));
      return { thread: t };
    }
    case 'resolve':
      await repo.upsertThread(resolveThread(thread));
      break;
    case 'reopen':
      await repo.upsertThread(reopenThread(thread));
      break;
    case 'task': {
      if (user.external) throw new HttpError(403, 'External users cannot assign tasks');
      const t = toTask(thread, { assigneeId: a.assigneeId, team: a.team, due: a.due });
      await repo.upsertThread(t);
      await repo.addNotifications(assignmentNotifications(t, user, users));
      break;
    }
    case 'acceptSuggestion':
      return { ...(await acceptSuggestion(repo, user, workspace, thread)), thread: await repo.getThread(thread.id) };
    case 'rejectSuggestion': {
      const t = resolveThread(reply(thread, user, `Not accepted: ${a.reason}`, users));
      await repo.upsertThread({ ...t, task: t.task ? { ...t.task, done: true } : null });
      break;
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
  return { thread: await repo.getThread(thread.id) };
});
