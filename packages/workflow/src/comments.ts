import type { Anchor, Comment, Thread, User, Task, Part, RevisionContent, NoteTag, Team } from '@bom/domain';
import { newId, can } from '@bom/domain';
import { WorkflowError } from './errors';

const now = () => new Date().toISOString();

/** "@Budi please check" → ids of mentioned users (matches by first name or full name, case-insensitive). */
export function parseMentions(body: string, users: User[]): string[] {
  const ids = new Set<string>();
  const re = /@([\p{L}\d._-]+(?:\s[\p{L}\d._-]+)?)/gu;
  for (const m of body.matchAll(re)) {
    const handle = m[1].toLowerCase();
    const u =
      users.find((x) => x.name.toLowerCase() === handle) ??
      users.find((x) => x.name.toLowerCase().split(' ')[0] === handle.split(' ')[0]) ??
      users.find((x) => x.email.split('@')[0].toLowerCase() === handle);
    if (u) ids.add(u.id);
  }
  return [...ids];
}

export function createThread(opts: { productId: string; revisionId: string; anchor: Anchor; author: User; body: string; users: User[]; kind?: Thread['kind']; tag?: NoteTag | null; meetingId?: string | null; productSharedWithBuyer?: boolean }): Thread {
  const perm = can(opts.author, 'comment', { productSharedWithBuyer: opts.productSharedWithBuyer });
  if (!perm.allowed) throw new WorkflowError(perm.reason, 'forbidden');
  const id = newId('thread');
  const first: Comment = { id: newId('cmt'), threadId: id, authorId: opts.author.id, body: opts.body, mentions: parseMentions(opts.body, opts.users), attachments: [], createdAt: now(), editedAt: null };
  return { id, productId: opts.productId, revisionId: opts.revisionId, anchor: opts.anchor, status: 'open', kind: opts.kind ?? 'comment', tag: opts.tag ?? null, comments: [first], task: null, createdAt: now(), carriedFromThreadId: null, meetingId: opts.meetingId ?? null };
}

export function reply(thread: Thread, author: User, body: string, users: User[]): Thread {
  const c: Comment = { id: newId('cmt'), threadId: thread.id, authorId: author.id, body, mentions: parseMentions(body, users), attachments: [], createdAt: now(), editedAt: null };
  return { ...thread, comments: [...thread.comments, c] };
}

export const resolveThread = (t: Thread): Thread => ({ ...t, status: 'resolved' });
export const reopenThread = (t: Thread): Thread => ({ ...t, status: 'open' });

/** A comment can become a task with an assignee and a due date; tasks show in the team's review lane. */
export function toTask(t: Thread, task: Partial<Task> & { team?: Team | null }): Thread {
  return { ...t, task: { assigneeId: task.assigneeId ?? null, team: task.team ?? null, due: task.due ?? null, done: task.done ?? false } };
}

/** Find the part a thread points at in another revision: by id, then Std Code + position + name (PRD §9). */
export function relocatePart(anchorPart: Pick<Part, 'id' | 'stdCode' | 'position' | 'originalName'>, content: RevisionContent): Part | undefined {
  return (
    content.parts.find((p) => p.id === anchorPart.id) ??
    content.parts.find((p) => p.stdCode === anchorPart.stdCode && p.position === anchorPart.position && p.originalName === anchorPart.originalName) ??
    content.parts.find((p) => p.stdCode && p.stdCode === anchorPart.stdCode && p.position === anchorPart.position)
  );
}

/** Open threads carry forward to the next draft; anchors follow the part by Std Code + position. */
export function carryForward(threads: Thread[], from: RevisionContent, to: RevisionContent, newRevisionId: string): Thread[] {
  return threads
    .filter((t) => t.status === 'open')
    .map((t) => {
      let anchor = t.anchor;
      if (anchor.kind === 'part' || anchor.kind === 'bomCell') {
        const a = anchor;
        const old = from.parts.find((p) => p.id === a.partId);
        const moved = old ? relocatePart(old, to) : undefined;
        anchor = moved ? { ...a, partId: moved.id } : { kind: 'revision' };
      }
      return { ...t, id: newId('thread'), revisionId: newRevisionId, anchor, carriedFromThreadId: t.id };
    });
}
