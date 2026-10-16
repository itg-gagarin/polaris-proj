/**
 * Server-side use cases shared by the route handlers. Everything goes through the same packages the
 * sync server and the worker use, so the browser, the API and the background jobs agree.
 */
import type { Repository, CheckResult } from '@bom/db';
import type { Patch, Product, Revision, Review, Thread, User, Workspace } from '@bom/domain';
import { applyPatch, classifyPatch, contentHash, DEFAULT_SETTINGS, makePatch, newId } from '@bom/domain';
import { analyze } from '@bom/engine';
import { auditFromPatch, createThread, laneNotifications, onContentChanged } from '@bom/workflow';
import { HttpError, notFound } from './http';
import { notifySyncPatch } from './sync';

export interface RevisionBundle {
  revision: Revision;
  product: Product;
  reviews: Review[];
  threads: Thread[];
  check: CheckResult | null;
  siblings: Pick<Revision, 'id' | 'label' | 'state' | 'branch' | 'updatedAt' | 'parentRevisionId' | 'submittedHash' | 'releasedAt'>[];
}

export async function loadRevision(repo: Repository, id: string): Promise<{ revision: Revision; product: Product }> {
  const revision = await repo.getRevision(id);
  if (!revision) throw notFound('Revision');
  const product = await repo.getProduct(revision.productId);
  if (!product) throw notFound('Product');
  return { revision, product };
}

export function assertCanView(user: User, product: Product) {
  if (user.external && !product.sharedWithBuyer) throw new HttpError(403, 'This product is not shared with you');
}

/** Latest stored check result for the content, computing (and storing) it when missing. */
export async function checksFor(repo: Repository, rev: Revision, ws: Workspace | null): Promise<CheckResult> {
  const hash = contentHash(rev.content);
  const cached = await repo.getCheckResult(rev.id, hash);
  if (cached) return cached;
  const a = analyze(rev.content, ws?.settings ?? DEFAULT_SETTINGS);
  const r: CheckResult = { revisionId: rev.id, contentHash: hash, findings: a.findings, summary: a.summary, computedAt: new Date().toISOString() };
  await repo.putCheckResult(r);
  return r;
}

export async function revisionBundle(repo: Repository, user: User, ws: Workspace, id: string): Promise<RevisionBundle> {
  const { revision, product } = await loadRevision(repo, id);
  assertCanView(user, product);
  const [reviews, threads, check, all] = await Promise.all([repo.listReviews(id), repo.listThreads({ revisionId: id }), checksFor(repo, revision, ws), repo.listRevisions(product.id)]);
  const siblings = all.map(({ id, label, state, branch, updatedAt, parentRevisionId, submittedHash, releasedAt }) => ({ id, label, state, branch, updatedAt, parentRevisionId, submittedHash, releasedAt }));
  return { revision, product, reviews, threads, check, siblings };
}

export interface PatchResult {
  revision: Revision;
  reviews: Review[];
  resetLanes: string[];
  suggestions: Thread[];
  denied: { reason: string }[];
  summary: CheckResult['summary'] | null;
  /** The ops actually applied (clients merge these into their live copy instead of resetting to the row). */
  patch: Patch | null;
}

/**
 * Apply a user's patch: permission per op (direct / suggestion / denied), content + lanes + audit +
 * notifications + server checks. Denied ops reject the whole request so the client can roll back.
 */
export async function applyUserPatch(repo: Repository, user: User, ws: Workspace, revisionId: string, patch: Patch): Promise<PatchResult> {
  const { revision, product } = await loadRevision(repo, revisionId);
  const settings = ws.settings ?? DEFAULT_SETTINGS;
  const cls = classifyPatch(user, revision.content, patch, settings, revision.state);
  if (cls.denied.length) throw new HttpError(403, cls.denied.map((d) => d.reason).filter((v, i, a) => a.indexOf(v) === i).join('; '));

  const users = await repo.listUsers(ws.id);
  const suggestions: Thread[] = [];
  for (const s of cls.suggestions) {
    const sp = makePatch(s.ops, patch.reason, patch.source, { authorId: user.id, team: s.team });
    const firstPart = s.ops.find((o) => 'partId' in o) as { partId: string } | undefined;
    const part = revision.content.parts.find((p) => p.id === firstPart?.partId);
    const t = createThread({
      productId: product.id,
      revisionId,
      anchor: part ? { kind: 'part', partId: part.id, stdCode: part.stdCode, position: part.position } : { kind: 'revision' },
      author: user,
      body: `Suggested change for ${s.team}: ${patch.reason}`,
      users,
      kind: 'changeRequest',
    });
    const thread: Thread = { ...t, suggestion: sp, task: { assigneeId: null, team: s.team, due: null, done: false } as Thread['task'] };
    await repo.upsertThread(thread);
    suggestions.push(thread);
  }

  if (!cls.direct.length) return { revision, reviews: await repo.listReviews(revisionId), resetLanes: [], suggestions, denied: [], summary: null, patch: null };

  const direct = makePatch(cls.direct, patch.reason, patch.source, { authorId: user.id, ruleId: patch.ruleId, confidence: patch.confidence, label: patch.label });
  const { content, inverse } = applyPatch(revision.content, direct);
  const changed = onContentChanged(revision, revision.content, content, await repo.listReviews(revisionId));
  await repo.upsertRevision(changed.revision);
  if (changed.reset.length) {
    await repo.upsertReviews(changed.reviews);
    await repo.addNotifications(laneNotifications(changed.revision, changed.reviews.filter((r) => changed.reset.includes(r.team)), users, 'reset'));
  }
  await repo.appendAudit([auditFromPatch({ workspaceId: ws.id, productId: product.id, revisionId, who: user.id, patch: direct, inverse })]);
  const check = await checksFor(repo, changed.revision, ws);
  await notifySyncPatch(revisionId, direct, user.id);
  return { revision: changed.revision, reviews: changed.reviews, resetLanes: changed.reset, suggestions, denied: [], summary: check.summary, patch: direct };
}

export async function acceptSuggestion(repo: Repository, user: User, ws: Workspace, thread: Thread): Promise<PatchResult> {
  if (!thread.suggestion) throw new HttpError(400, 'This thread carries no suggested change');
  const team = thread.task?.team;
  if (team && !(user.teams.includes(team) || user.role === 'lead' || user.role === 'admin')) throw new HttpError(403, `Only ${team} accepts this suggestion`);
  const res = await applyUserPatch(repo, user, ws, thread.revisionId, { ...thread.suggestion, id: newId('patch'), reason: `${thread.suggestion.reason} (suggestion accepted by ${user.name})` });
  await repo.upsertThread({ ...thread, status: 'resolved', task: thread.task ? { ...thread.task, done: true } : null });
  return res;
}
