import type { FrameItem, Product, RevisionContent } from '@bom/domain';
import { newId, stableId } from '@bom/domain';
import { prepareContent } from '@bom/engine';
import { auditEvent, newRevision } from '@bom/workflow';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';

interface CommitItem {
  product: { code: string; name: string; category: string; subCategory: string };
  revisionLabel: string;
  content: RevisionContent;
}

/** Create products + draft revisions from a confirmed preview and drop frames for them on the board. */
export const POST = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  if (user.external || user.role === 'viewer' || user.role === 'reviewer') throw new HttpError(403, 'Only editors import products');
  const { items, boardId, fileName } = await body<{ items: CommitItem[]; boardId?: string; fileName: string }>(req);
  if (!items?.length) throw new HttpError(400, 'Nothing to import');
  const existing = await repo.listProducts(workspace.id);
  const created: { productId: string; revisionId: string; code: string }[] = [];
  const now = new Date().toISOString();
  for (const it of items) {
    let product: Product | undefined = existing.find((p) => p.code === it.product.code);
    const content = prepareContent(it.content, workspace.settings);
    if (!product) {
      product = { id: stableId('prod', `${workspace.id}|${it.product.code}|${now}`), workspaceId: workspace.id, code: it.product.code, name: it.product.name, category: it.product.category, subCategory: it.product.subCategory, currentRevisionId: null, sharedWithBuyer: false, componentProductIds: [], createdAt: now };
      await repo.upsertProduct(product);
    }
    const siblings = await repo.listRevisions(product.id);
    const label = siblings.some((r) => r.label === it.revisionLabel) ? `${it.revisionLabel}-import-${siblings.length + 1}` : it.revisionLabel;
    const rev = { ...newRevision(product.id, label, content, user, `Imported from ${fileName}`) };
    await repo.upsertRevision(rev);
    await repo.upsertProduct({ ...product, currentRevisionId: rev.id });
    await repo.appendAudit([auditEvent({ workspaceId: workspace.id, productId: product.id, revisionId: rev.id, who: user.id, what: `Imported ${it.product.code} ${label} from ${fileName} (${content.parts.length} lines)`, before: null, after: { parts: content.parts.length }, source: 'import' })]);
    created.push({ productId: product.id, revisionId: rev.id, code: product.code });
  }
  if (boardId) {
    const board = await repo.getBoard(boardId);
    if (board && board.workspaceId === workspace.id) {
      const maxY = Math.max(0, ...board.items.map((i) => i.rect.y + i.rect.h));
      const frames: FrameItem[] = created.flatMap((c, i) => [
        { id: newId('frame'), kind: 'frame' as const, type: 'viewport' as const, rect: { x: i * 1600, y: maxY + 200, w: 760, h: 560 }, z: 1, title: `3D · ${c.code}`, productId: c.productId, revisionId: c.revisionId, props: { shading: 'material', lens: 'none', view: 'iso' } },
        { id: newId('frame'), kind: 'frame' as const, type: 'bom' as const, rect: { x: i * 1600 + 800, y: maxY + 200, w: 760, h: 560 }, z: 1, title: `BOM · ${c.code}`, productId: c.productId, revisionId: c.revisionId, props: {} },
      ]);
      await repo.upsertBoard({ ...board, items: [...board.items, ...frames] });
    }
  }
  return { created };
});
