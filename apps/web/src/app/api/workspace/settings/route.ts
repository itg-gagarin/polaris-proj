import { canEditWorkspaceSettings, updateThresholds } from '@bom/domain';
import { auditEvent } from '@bom/workflow';
import { route, body, HttpError } from '@/server/http';
import { requireSession } from '@/server/auth';

/** Workspace check thresholds (Settings → Workspace). Leads and admins only; every change is audited. */
export const PATCH = route(async (req) => {
  const { user, workspace, repo } = await requireSession(req);
  if (!canEditWorkspaceSettings(user)) throw new HttpError(403, 'Only leads and admins change workspace settings');
  const b = await body<{ thresholds?: Record<string, unknown> }>(req);
  let r: ReturnType<typeof updateThresholds>;
  try {
    r = updateThresholds(workspace.settings, b.thresholds ?? {});
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  if (!Object.keys(r.changed).length) return { settings: workspace.settings, changed: {} };
  const fresh = (await repo.getWorkspace(workspace.id)) ?? workspace;
  await repo.upsertWorkspace({ ...fresh, settings: { ...fresh.settings, thresholds: r.settings.thresholds } });
  await repo.appendAudit([auditEvent({ workspaceId: workspace.id, productId: null, revisionId: null, who: user.id, what: `Changed check limits: ${Object.entries(r.changed).map(([k, v]) => `${k} ${v!.from} → ${v!.to}`).join(', ')}`, before: null, after: r.changed, source: 'user' })]);
  return { settings: r.settings, changed: r.changed };
});
