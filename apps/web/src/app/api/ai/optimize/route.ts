import { runOptimize } from '@bom/ai';
import { can, newId } from '@bom/domain';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { getAi } from '@/server/context';
import { loadRevision } from '@/server/service';

export const runtime = 'nodejs';
export const maxDuration = 90;

/** AI optimize (PRD §8): rule fixes + model pass, every model patch re-validated by the engine. */
export const POST = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  if (!can(user, 'runAi').allowed) throw new HttpError(403, 'Your role cannot run AI optimize');
  const { revisionId } = await body<{ revisionId: string }>(req);
  const { revision, product } = await loadRevision(repo, revisionId);
  const suggestion = await runOptimize({
    revision,
    category: product.category,
    subCategory: product.subCategory,
    settings: workspace.settings,
    dictionary: await repo.listStdParts(),
    provider: getAi(),
    user,
    onLog: (l) => void repo.appendAiRun({ id: newId('airun'), workspaceId: workspace.id, revisionId, kind: 'optimize', userId: user.id, model: l.model, request: l.request, response: l.response, status: l.status, ms: l.ms, at: new Date().toISOString() }),
  });
  return { suggestion };
});
