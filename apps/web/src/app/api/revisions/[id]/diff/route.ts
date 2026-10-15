import { diffRevisions } from '@bom/engine';
import { route, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { assertCanView, loadRevision } from '@/server/service';

/** Diff between any two revisions (PRD §9): ?against=<revisionId> (defaults to the parent). */
export const GET = route(async (req, { params }) => {
  const { user, repo } = await requireSession(req);
  const { revision, product } = await loadRevision(repo, (await params).id);
  assertCanView(user, product);
  const againstId = new URL(req.url).searchParams.get('against') ?? revision.parentRevisionId;
  if (!againstId) throw new HttpError(400, 'This revision has no parent; pass ?against=');
  const { revision: base } = await loadRevision(repo, againstId);
  if (base.productId !== revision.productId) throw new HttpError(400, 'Both revisions must belong to the same product');
  return { base: { id: base.id, label: base.label }, head: { id: revision.id, label: revision.label }, diff: diffRevisions(base.content, revision.content), baseContent: base.content };
});
