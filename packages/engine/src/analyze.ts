import type { Finding, RevisionContent, WorkspaceSettings } from '@bom/domain';
import { DEFAULT_SETTINGS } from '@bom/domain';
import { resolveContent } from './resolve';
import { computeLayout, type Layout } from './layout';
import { detectClashes, deriveTemplateJoints, type ClashResult } from './clash';
import { ContentIndex } from './model';
import { RULES } from './checks/rules';
import type { CheckRule } from './checks/types';
import { withInferred } from './infer';
import { autoOrient, type OrientChange } from './orient';

export interface Analysis {
  content: RevisionContent;
  params: Record<string, number>;
  layout: Layout;
  clashes: ClashResult[];
  findings: Finding[];
  errors: { target: string; partId?: string; message: string }[];
  ms: number;
  summary: { fail: number; warn: number; info: number; waived: number; parts: number; instances: number; unplaced: number };
}

export interface AnalyzeOptions {
  /** PRD §4: fuzzy/AI matches go to the Unplaced tray until confirmed. */
  requireConfirmed?: boolean;
  rules?: CheckRule[];
  only?: string[];
}

const SEV = { fail: 0, warn: 1, info: 2 } as const;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Run geometry, layout and every check. Pure: same input → same output in browser, server and AI service. */
export function analyze(content: RevisionContent, settings: WorkspaceSettings = DEFAULT_SETTINGS, opts: AnalyzeOptions = {}): Analysis {
  const t0 = now();
  const resolved = resolveContent(content);
  const layout = computeLayout(resolved.content, resolved.params, settings, { requireConfirmed: opts.requireConfirmed });
  const clashes = detectClashes(resolved.content, layout, settings);
  const ctx = {
    content: resolved.content,
    ix: new ContentIndex(resolved.content),
    layout,
    params: resolved.params,
    settings,
    t: settings.thresholds,
    clashes,
    resolveErrors: resolved.errors,
  };
  const rules = (opts.rules ?? RULES).filter((r) => (!r.families || r.families.includes(content.family)) && (!opts.only || opts.only.includes(r.id)));
  const findings: Finding[] = [];
  for (const r of rules) {
    try {
      findings.push(...r.run(ctx));
    } catch (err) {
      findings.push({ key: `${r.id}:error`, ruleId: r.id, title: r.title, severity: 'warn', confidence: 'low', ownerTeam: r.team, partIds: [], message: `Check failed to run: ${(err as Error).message}`, numbers: {}, assumptionKeys: [], fix: null });
    }
  }
  for (const f of findings) {
    const w = content.waivers[f.key];
    if (w) f.waived = w;
  }
  findings.sort((a, b) => Number(!!a.waived) - Number(!!b.waived) || SEV[a.severity] - SEV[b.severity] || a.ruleId.localeCompare(b.ruleId));
  const active = findings.filter((f) => !f.waived);
  return {
    content: resolved.content,
    params: resolved.params,
    layout,
    clashes,
    findings,
    errors: resolved.errors,
    ms: now() - t0,
    summary: {
      fail: active.filter((f) => f.severity === 'fail').length,
      warn: active.filter((f) => f.severity === 'warn').length,
      info: active.filter((f) => f.severity === 'info').length,
      waived: findings.length - active.length,
      parts: content.parts.length,
      instances: layout.instances.filter((i) => i.source !== 'tray').length,
      unplaced: layout.unplaced.reduce((s, u) => s + u.count, 0),
    },
  };
}

/**
 * Prepare imported content: infer parameters/assumptions, then declare the carcass joints the
 * template implies (PRD §7: joints allow intended overlap). Run once at import or "Reset to template".
 */
export function prepareContent(content: RevisionContent, settings: WorkspaceSettings = DEFAULT_SETTINGS): RevisionContent {
  return prepareContentWithReport(content, settings).content;
}

export function prepareContentWithReport(content: RevisionContent, settings: WorkspaceSettings = DEFAULT_SETTINGS): { content: RevisionContent; oriented: OrientChange[] } {
  const inferred = withInferred(content, settings);
  const oriented = autoOrient(inferred, resolveContent(inferred).params);
  const resolved = resolveContent(oriented.content);
  const layout = computeLayout(resolved.content, resolved.params, settings);
  return { content: { ...oriented.content, joints: deriveTemplateJoints(oriented.content, layout, settings) }, oriented: oriented.changes };
}
