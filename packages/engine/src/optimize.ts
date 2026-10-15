import type { Finding, Patch, PatchOp, RevisionContent, WorkspaceSettings } from '@bom/domain';
import { DEFAULT_SETTINGS, applyPatch, touchedPartIds } from '@bom/domain';
import { analyze, type Analysis } from './analyze';

export interface OptimizeResult {
  /** Patches in the order they were applied; each names its rule and reason. */
  patches: Patch[];
  before: Analysis;
  after: Analysis;
  passes: number;
  /** Fix patches that were not applied and why. */
  skipped: { patch: Patch; reason: string }[];
  content: RevisionContent;
}

const fieldKey = (op: PatchOp) => ('partId' in op ? `${op.partId}:${op.op === 'setDim' || op.op === 'setExpr' ? op.dim : op.op === 'setField' ? op.field : op.op}` : op.op);

/**
 * Deterministic fixes (PRD §8 step 2): every failing rule with a fix patch produces a change.
 * Up to 4 passes because one fix can change another (a narrower box changes the bottom panel).
 * Never touches locked parts; never undoes a waiver.
 */
export function optimize(content: RevisionContent, settings: WorkspaceSettings = DEFAULT_SETTINGS, maxPasses = 4): OptimizeResult {
  const before = analyze(content, settings);
  let current = content;
  let last = before;
  const patches: Patch[] = [];
  const skipped: OptimizeResult['skipped'] = [];
  const locked = new Set(content.parts.filter((p) => p.locked).map((p) => p.id));
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    const candidates = last.findings.filter((f): f is Finding & { fix: Patch } => !!f.fix && !f.waived && f.severity === 'fail');
    if (!candidates.length) break;
    const used = new Set<string>();
    let applied = 0;
    for (const f of candidates) {
      const fix = f.fix;
      if (touchedPartIds(fix).some((id) => locked.has(id))) {
        skipped.push({ patch: fix, reason: 'touches a locked part' });
        continue;
      }
      const keys = fix.ops.map(fieldKey);
      if (keys.some((k) => used.has(k))) continue; // another fix in this pass already changed it
      keys.forEach((k) => used.add(k));
      try {
        current = applyPatch(current, fix).content;
        patches.push({ ...fix, label: fix.label ?? f.title });
        applied++;
      } catch (err) {
        skipped.push({ patch: fix, reason: (err as Error).message });
      }
    }
    if (!applied) break;
    last = analyze(current, settings);
  }
  return { patches, before, after: last, passes, skipped, content: current };
}
