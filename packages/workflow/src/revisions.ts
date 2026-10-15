import type { Revision, Review, User, WorkspaceSettings, Team, RevisionContent, Product } from '@bom/domain';
import { can, contentHash, newId, requiredLanesFor, clone } from '@bom/domain';
import { diffRevisions, type RevisionDiff } from '@bom/engine';
import { WorkflowError } from './errors';
import { checklistFor } from './checklists';

const now = () => new Date().toISOString();

/** A → B, Z → AA, R5 → R6, B-wood → B-wood-2 (alternatives keep their name). */
export function nextLabel(label: string): string {
  const m = label.match(/^(.*?)(\d+)$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  if (/^[A-Z]+$/.test(label)) {
    const chars = label.split('');
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] !== 'Z') {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        return chars.join('');
      }
      chars[i] = 'A';
      i--;
    }
    return `A${chars.join('')}`;
  }
  return `${label}-2`;
}

export function newRevision(productId: string, label: string, content: RevisionContent, author: User, notes = ''): Revision {
  return {
    id: newId('rev'),
    productId,
    label,
    state: 'draft',
    notes,
    authorId: author.id,
    createdAt: now(),
    updatedAt: now(),
    parentRevisionId: null,
    branch: null,
    content,
    submittedHash: null,
    releasedAt: null,
    meetingIds: [],
  };
}

export function assertEditable(rev: Revision): void {
  if (rev.state === 'released') throw new WorkflowError('Released revisions are read-only — start a new draft', 'invalid-state');
}

/** Submit a draft for review: freezes the content hash and opens one lane per required team (PRD §9). */
export function submitRevision(rev: Revision, product: Product, user: User, note: string, settings: WorkspaceSettings): { revision: Revision; reviews: Review[] } {
  if (rev.state !== 'draft' && rev.state !== 'changes_requested') throw new WorkflowError(`Cannot submit a revision in state ${rev.state}`, 'invalid-state');
  if (!note.trim()) throw new WorkflowError('A revision note is required when submitting', 'missing-note');
  if (!can(user, 'editBom').allowed) throw new WorkflowError('Only editors submit revisions', 'forbidden');
  const hash = contentHash(rev.content);
  const teams = requiredLanesFor(settings, product.category, product.subCategory);
  const reviews: Review[] = teams.map((team) => ({
    id: newId('review'),
    revisionId: rev.id,
    team,
    state: 'pending',
    reviewerId: null,
    hash,
    checklist: Object.fromEntries(checklistFor(team).map((c) => [c.id, false])),
    comment: '',
    at: null,
    resetReason: null,
  }));
  return { revision: { ...rev, state: 'in_review', notes: note, submittedHash: hash, updatedAt: now() }, reviews };
}

/** Approve a lane. The approval is tied to the content hash the reviewer looked at. */
export function approveLane(rev: Revision, review: Review, user: User, opts: { hash: string; checklist?: Record<string, boolean>; comment?: string }): Review {
  if (rev.state !== 'in_review' && rev.state !== 'approved') throw new WorkflowError('The revision is not in review', 'invalid-state');
  const perm = can(user, 'approveLane', { team: review.team });
  if (!perm.allowed) throw new WorkflowError(perm.reason, 'forbidden');
  const current = contentHash(rev.content);
  if (opts.hash !== current) throw new WorkflowError('The revision changed since you opened it — review the latest version', 'stale-hash');
  return { ...review, state: 'approved', reviewerId: user.id, hash: current, checklist: { ...review.checklist, ...(opts.checklist ?? {}) }, comment: opts.comment ?? review.comment, at: now(), resetReason: null };
}

/** Any lane can send the revision back to draft with its comments. */
export function requestChanges(rev: Revision, review: Review, user: User, comment: string): { revision: Revision; review: Review } {
  const perm = can(user, 'approveLane', { team: review.team });
  if (!perm.allowed) throw new WorkflowError(perm.reason, 'forbidden');
  if (!comment.trim()) throw new WorkflowError('Say what needs to change', 'missing-note');
  return {
    revision: { ...rev, state: 'changes_requested', updatedAt: now() },
    review: { ...review, state: 'changes_requested', reviewerId: user.id, comment, at: now() },
  };
}

/** Revision state after a lane decision: approved when every required lane approved the current hash. */
export function reconcileState(rev: Revision, reviews: Review[]): Revision {
  if (rev.state === 'released' || rev.state === 'draft') return rev;
  if (reviews.some((r) => r.state === 'changes_requested')) return { ...rev, state: 'changes_requested' };
  const hash = contentHash(rev.content);
  const allOk = reviews.length > 0 && reviews.every((r) => r.state === 'approved' && r.hash === hash);
  return { ...rev, state: allOk ? 'approved' : 'in_review' };
}

/** Release: only when every required lane approved the current content (PRD §13 phase-3 gate). */
export function releaseRevision(rev: Revision, reviews: Review[], user: User): Revision {
  const perm = can(user, 'releaseRevision');
  if (!perm.allowed) throw new WorkflowError(perm.reason, 'forbidden');
  const hash = contentHash(rev.content);
  const pending = reviews.filter((r) => r.state !== 'approved' || r.hash !== hash);
  if (pending.length) throw new WorkflowError(`Lanes not approved for this content: ${pending.map((r) => r.team).join(', ')}`, 'lanes-pending');
  if (rev.state !== 'approved') throw new WorkflowError(`Cannot release from state ${rev.state}`, 'invalid-state');
  return { ...rev, state: 'released', releasedAt: now(), updatedAt: now() };
}

/**
 * An edit during review resets the lanes whose scope changed (PRD §9) and tells them what changed.
 * Editing a changes-requested revision moves it back to draft.
 */
export function onContentChanged(rev: Revision, before: RevisionContent, after: RevisionContent, reviews: Review[]): { revision: Revision; reviews: Review[]; diff: RevisionDiff; reset: Team[] } {
  assertEditable(rev);
  const diff = diffRevisions(before, after);
  const scope = new Set(diff.teams);
  const reset: Team[] = [];
  const next = reviews.map((r) => {
    if (r.state === 'approved' && scope.has(r.team)) {
      reset.push(r.team);
      const what = [...diff.changed.filter((c) => c.team === r.team).map((c) => `${c.name}: ${c.changes.map((x) => x.field).join(', ')}`), ...diff.added.filter((p) => p.teamOwner === r.team).map((p) => `added ${p.originalName}`), ...diff.removed.filter((p) => p.teamOwner === r.team).map((p) => `removed ${p.originalName}`)];
      return { ...r, state: 'pending' as const, resetReason: what.length ? what.slice(0, 8).join('; ') : 'Content in your scope changed' };
    }
    return r;
  });
  let state = rev.state;
  if (state === 'changes_requested') state = 'draft';
  if (state === 'approved' && reset.length) state = 'in_review';
  return { revision: { ...rev, content: after, state, updatedAt: now() }, reviews: next, diff, reset };
}

/** Editing a released product starts the next draft (Rev B from Rev A). */
export function startNextDraft(released: Revision, user: User): Revision {
  if (released.state !== 'released') throw new WorkflowError('Only a released revision starts a new draft', 'invalid-state');
  return { ...newRevision(released.productId, nextLabel(released.label), clone(released.content), user), parentRevisionId: released.id };
}

/** Fork an alternative (e.g. B-wood vs B-metal slides). */
export function forkAlternative(from: Revision, name: string, user: User): Revision {
  assertEditable(from);
  const base = from.branch ? from.label.replace(/-.*$/, '') : from.label;
  return { ...newRevision(from.productId, `${base}-${name}`, clone(from.content), user), parentRevisionId: from.id, branch: { name, status: 'active' } };
}

/** Promote one alternative; its siblings are archived. */
export function promoteAlternative(chosen: Revision, siblings: Revision[]): { promoted: Revision; archived: Revision[] } {
  if (!chosen.branch) throw new WorkflowError('Not an alternative', 'invalid-state');
  return {
    promoted: { ...chosen, branch: { ...chosen.branch, status: 'promoted' } },
    archived: siblings.filter((s) => s.id !== chosen.id && s.branch && s.parentRevisionId === chosen.parentRevisionId).map((s) => ({ ...s, branch: { ...s.branch!, status: 'archived' } })),
  };
}

/** Review assistant (PRD §8): what changed in a team's scope since its last approval. */
export function changesSinceApproval(team: Team, approvedContent: RevisionContent, current: RevisionContent): string[] {
  const d = diffRevisions(approvedContent, current);
  return [
    ...d.changed.filter((c) => c.team === team || c.changes.some((x) => (team === 'finishing' && x.field === 'finishCode') || (team === 'hardware' && x.field === 'hardwareSku'))).map((c) => `${c.name}: ${c.changes.map((x) => `${x.field} ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`).join(', ')}`),
    ...d.added.filter((p) => p.teamOwner === team).map((p) => `Added ${p.originalName}`),
    ...d.removed.filter((p) => p.teamOwner === team).map((p) => `Removed ${p.originalName}`),
  ];
}
