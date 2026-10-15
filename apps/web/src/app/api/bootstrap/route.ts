import { route } from '@/server/http';
import { requireSession } from '@/server/auth';

/** Everything the editor shell needs on load (content is fetched per revision). */
export const GET = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  const [users, products, boards, notifications] = await Promise.all([repo.listUsers(workspace.id), repo.listProducts(workspace.id), repo.listBoards(workspace.id), repo.listNotifications(user.id)]);
  const visible = user.external ? products.filter((p) => p.sharedWithBuyer) : products;
  const revisions = (await Promise.all(visible.map((p) => repo.listRevisions(p.id)))).flat().map(({ content, ...r }) => ({ ...r, parts: content.parts.length, family: content.family }));
  return { user, workspace, users, products: visible, revisions, boards: user.external ? [] : boards, notifications, syncUrl: process.env.NEXT_PUBLIC_SYNC_URL ?? null, ai: { provider: process.env.AI_PROVIDER ?? 'mock', enabled: workspace.settings.ai.enabled } };
});
