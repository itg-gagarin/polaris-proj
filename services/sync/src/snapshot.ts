import type { Y } from '@bom/collab';
import { readRevision } from '@bom/collab';
import type { Repository } from '@bom/db';
import { contentHash, DEFAULT_SETTINGS } from '@bom/domain';
import { analyze } from '@bom/engine';
import { auditEvent, laneNotifications, onContentChanged } from '@bom/workflow';

export type SnapshotStatus = 'saved' | 'unchanged' | 'not-loaded' | 'released' | 'missing';

export interface SnapshotResult {
  revisionId: string;
  status: SnapshotStatus;
  hash?: string;
  reset?: string[];
  summary?: { fail: number; warn: number; info: number };
  ms?: number;
}

/**
 * Write the live draft back to its revision row (PRD §11: every 30 s), reset review lanes whose
 * scope changed, record one audit event naming the editors, and re-run the checks server-side so
 * findings never depend on a client being honest.
 */
export async function snapshotRevision(repo: Repository, doc: Y.Doc, revisionId: string, editors: string[]): Promise<SnapshotResult> {
  const t0 = performance.now();
  const content = readRevision(doc, revisionId);
  if (!content) return { revisionId, status: 'not-loaded' };
  const rev = await repo.getRevision(revisionId);
  if (!rev) return { revisionId, status: 'missing' };
  if (rev.state === 'released') return { revisionId, status: 'released' };
  const hash = contentHash(content);
  if (hash === contentHash(rev.content)) return { revisionId, status: 'unchanged', hash };

  const product = await repo.getProduct(rev.productId);
  const workspace = product ? await repo.getWorkspace(product.workspaceId) : null;
  const reviews = await repo.listReviews(revisionId);
  const changed = onContentChanged(rev, rev.content, content, reviews);
  await repo.upsertRevision(changed.revision);
  if (changed.reset.length) {
    await repo.upsertReviews(changed.reviews);
    const members = workspace ? await repo.listUsers(workspace.id) : [];
    await repo.addNotifications(laneNotifications(changed.revision, changed.reviews.filter((r) => changed.reset.includes(r.team)), members, 'reset'));
  }
  const d = changed.diff;
  await repo.appendAudit([
    auditEvent({
      workspaceId: product?.workspaceId ?? '',
      productId: rev.productId,
      revisionId,
      who: editors.length ? editors.join(',') : 'system',
      what: `Live edits saved (${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed)`,
      before: { hash: contentHash(rev.content) },
      after: { hash, changed: d.changed.map((c) => ({ partId: c.partId, fields: c.changes.map((x) => x.field) })), added: d.added.map((p) => p.id), removed: d.removed.map((p) => p.id), resetLanes: changed.reset },
      source: 'user',
    }),
  ]);

  const a = analyze(content, workspace?.settings ?? DEFAULT_SETTINGS);
  await repo.putCheckResult({ revisionId, contentHash: hash, findings: a.findings, summary: a.summary, computedAt: new Date().toISOString() });
  return { revisionId, status: 'saved', hash, reset: changed.reset, summary: { fail: a.summary.fail, warn: a.summary.warn, info: a.summary.info }, ms: Math.round(performance.now() - t0) };
}
