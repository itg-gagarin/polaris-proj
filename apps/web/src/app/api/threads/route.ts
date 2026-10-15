import type { Anchor, NoteTag } from '@bom/domain';
import { createThread, mentionNotifications } from '@bom/workflow';
import { route, body } from '@/server/http';
import { requireSession } from '@/server/auth';
import { assertCanView, loadRevision } from '@/server/service';

export const GET = route(async (req) => {
  const { user, repo } = await requireSession(req);
  const revisionId = new URL(req.url).searchParams.get('revisionId')!;
  const { product } = await loadRevision(repo, revisionId);
  assertCanView(user, product);
  return { threads: await repo.listThreads({ revisionId }) };
});

export const POST = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  const b = await body<{ revisionId: string; anchor: Anchor; body: string; tag?: NoteTag | null }>(req);
  const { product } = await loadRevision(repo, b.revisionId);
  assertCanView(user, product);
  const users = await repo.listUsers(workspace.id);
  const t = createThread({ productId: product.id, revisionId: b.revisionId, anchor: b.anchor, author: user, body: b.body, users, tag: b.tag ?? null, productSharedWithBuyer: product.sharedWithBuyer });
  await repo.upsertThread(t);
  await repo.addNotifications(mentionNotifications(t, user));
  return { thread: t };
});
