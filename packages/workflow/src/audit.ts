import type { AuditEvent, Patch, ChangeSource } from '@bom/domain';
import { newId } from '@bom/domain';

/** Every change records who, what, before, after, when and the source (PRD §9). */
export function auditFromPatch(opts: { workspaceId: string; productId: string | null; revisionId: string | null; who: string; patch: Patch; inverse: Patch; source?: ChangeSource }): AuditEvent {
  return {
    id: newId('audit'),
    workspaceId: opts.workspaceId,
    productId: opts.productId,
    revisionId: opts.revisionId,
    who: opts.who,
    what: opts.patch.reason,
    before: opts.inverse.ops,
    after: opts.patch.ops,
    at: new Date().toISOString(),
    source: opts.source ?? opts.patch.source,
  };
}

export function auditEvent(opts: Omit<AuditEvent, 'id' | 'at'>): AuditEvent {
  return { ...opts, id: newId('audit'), at: new Date().toISOString() };
}
