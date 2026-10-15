import type { User } from './collab';
import type { Part, PartField, RevisionState } from './model';
import type { Team, Role } from './teams';
import type { WorkspaceSettings } from './settings';

export type Action =
  | 'view'
  | 'comment'
  | 'editGeometry'
  | 'editBom'
  | 'approveLane'
  | 'releaseRevision'
  | 'manageUsers'
  | 'approveSample'
  | 'runAi'
  | 'manageMeeting';

export interface PermissionContext {
  part?: Part | null;
  field?: PartField | 'dims' | 'transform' | 'expr' | null;
  /** Lane team for approveLane. */
  team?: Team | null;
  settings?: WorkspaceSettings;
  revisionState?: RevisionState;
  productSharedWithBuyer?: boolean;
}

export interface PermissionResult {
  allowed: boolean;
  /** 'suggestion' = allowed, but recorded as a suggestion for the owning team to accept. */
  mode: 'direct' | 'suggestion' | 'denied';
  reason: string;
}

/** PRD §2 role matrix. */
const MATRIX: Record<Role, Record<Action, boolean>> = {
  viewer: { view: true, comment: true, editGeometry: false, editBom: false, approveLane: false, releaseRevision: false, manageUsers: false, approveSample: false, runAi: false, manageMeeting: false },
  reviewer: { view: true, comment: true, editGeometry: false, editBom: false, approveLane: true, releaseRevision: false, manageUsers: false, approveSample: false, runAi: false, manageMeeting: false },
  editor: { view: true, comment: true, editGeometry: true, editBom: true, approveLane: true, releaseRevision: false, manageUsers: false, approveSample: false, runAi: true, manageMeeting: true },
  lead: { view: true, comment: true, editGeometry: true, editBom: true, approveLane: true, releaseRevision: true, manageUsers: false, approveSample: true, runAi: true, manageMeeting: true },
  admin: { view: true, comment: true, editGeometry: true, editBom: true, approveLane: true, releaseRevision: true, manageUsers: true, approveSample: true, runAi: true, manageMeeting: true },
};

/** Fields owned by a team regardless of the part's owner. */
export const FIELD_OWNER: Partial<Record<string, Team>> = {
  finishCode: 'finishing',
  hardwareSku: 'hardware',
};

const ok = (reason = 'allowed'): PermissionResult => ({ allowed: true, mode: 'direct', reason });
const deny = (reason: string): PermissionResult => ({ allowed: false, mode: 'denied', reason });

export function can(user: User, action: Action, ctx: PermissionContext = {}): PermissionResult {
  if (user.external) {
    if (ctx.productSharedWithBuyer === false) return deny('Product is not shared with external buyers');
    if (action === 'view' || action === 'comment' || action === 'approveSample') return ok();
    return deny('External buyers can view, comment and approve the sample only');
  }

  if (!MATRIX[user.role][action]) return deny(`Role "${user.role}" cannot ${action}`);

  const editing = action === 'editGeometry' || action === 'editBom';
  if (editing && ctx.revisionState === 'released') {
    return deny('Released revisions are read-only — start a new draft');
  }
  if (editing && (ctx.revisionState === 'in_review' || ctx.revisionState === 'approved')) {
    // Edits during review are allowed but reset the affected lanes (handled by workflow).
  }
  if (editing && ctx.part?.locked) {
    return deny('Part is locked');
  }

  if (action === 'approveLane') {
    if (!ctx.team) return ok();
    if (user.role === 'lead' || user.role === 'admin' || user.teams.includes(ctx.team)) return ok();
    return deny(`Only ${ctx.team} reviewers approve the ${ctx.team} lane`);
  }

  if (editing && ctx.part) {
    if (user.role === 'lead' || user.role === 'admin') return ok();
    const owner = (ctx.field && FIELD_OWNER[ctx.field]) || ctx.part.teamOwner;
    if (user.teams.includes(owner)) return ok('in team scope');
    const mode = ctx.settings?.outOfScopeEdit ?? 'suggest';
    if (mode === 'block') return deny(`Outside your team scope (owned by ${owner})`);
    return { allowed: true, mode: 'suggestion', reason: `Outside your team scope — saved as a suggestion for ${owner}` };
  }

  return ok();
}
