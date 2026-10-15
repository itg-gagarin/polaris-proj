import { acceptChanges, type SuggestedRevision } from '@bom/ai';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';
import { applyUserPatch, loadRevision } from '@/server/service';

/** Accepted changes land in the draft as one history step: "AI optimize, accepted by Name". */
export const POST = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  const { revisionId, suggestion, acceptedIds } = await body<{ revisionId: string; suggestion: SuggestedRevision; acceptedIds: string[] }>(req);
  if (suggestion.revisionId !== revisionId) throw new HttpError(400, 'Suggestion belongs to another revision');
  const { revision } = await loadRevision(repo, revisionId);
  const res = acceptChanges(revision, suggestion, acceptedIds, user);
  if (!res.patch.ops.length) return { rejected: res.rejected, applied: 0 };
  const out = await applyUserPatch(repo, user, workspace, revisionId, res.patch);
  return { ...out, rejected: res.rejected, applied: res.patch.ops.length, patch: res.patch };
});
