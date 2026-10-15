import type { AppNotification, Thread, Review, User, Revision, NotificationKind } from '@bom/domain';
import { newId, TEAMS } from '@bom/domain';

const now = () => new Date().toISOString();
const note = (userId: string, kind: NotificationKind, text: string, link: string): AppNotification => ({ id: newId('ntf'), userId, kind, text, link, read: false, createdAt: now() });

export function mentionNotifications(thread: Thread, author: User): AppNotification[] {
  const last = thread.comments[thread.comments.length - 1];
  return last.mentions.filter((id) => id !== author.id).map((id) => note(id, 'mention', `${author.name} mentioned you: "${last.body.slice(0, 80)}"`, `/thread/${thread.id}`));
}

export function assignmentNotifications(thread: Thread, by: User, members: User[]): AppNotification[] {
  if (!thread.task) return [];
  const targets = thread.task.assigneeId ? [thread.task.assigneeId] : members.filter((m) => thread.task!.team && m.teams.includes(thread.task!.team)).map((m) => m.id);
  return targets.filter((id) => id !== by.id).map((id) => note(id, 'assignment', `${by.name} assigned you a task${thread.task!.due ? ` due ${thread.task!.due}` : ''}: "${thread.comments[0].body.slice(0, 80)}"`, `/thread/${thread.id}`));
}

/** Tell a team its lane changed: opened, reset by an edit, or the revision was released. */
export function laneNotifications(rev: Revision, reviews: Review[], members: User[], event: 'submitted' | 'reset' | 'changes_requested' | 'released'): AppNotification[] {
  const out: AppNotification[] = [];
  for (const r of reviews) {
    if (event === 'reset' && r.state !== 'pending') continue;
    const text =
      event === 'submitted'
        ? `Rev ${rev.label} is waiting for the ${TEAMS[r.team].label.en} lane`
        : event === 'reset'
          ? `Rev ${rev.label}: your ${TEAMS[r.team].label.en} approval was reset — ${r.resetReason ?? 'content changed'}`
          : event === 'changes_requested'
            ? `Rev ${rev.label} went back to draft (changes requested)`
            : `Rev ${rev.label} was released`;
    for (const m of members) if (m.teams.includes(r.team)) out.push(note(m.id, event === 'released' ? 'revision' : 'lane', text, `/revision/${rev.id}`));
  }
  return out;
}

/** Daily email digest body (sent by the worker; the transport is configured later). */
export function digest(user: User, items: AppNotification[]): string | null {
  const unread = items.filter((n) => n.userId === user.id && !n.read);
  if (!unread.length) return null;
  return [`Hi ${user.name.split(' ')[0]},`, '', `You have ${unread.length} update(s) in Furniture BOM Studio:`, '', ...unread.map((n) => `• ${n.text}`), '', '— BOM Studio'].join('\n');
}
