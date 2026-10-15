/**
 * AI optimize (PRD §8): rule fixes (≤ 4 passes) → model pass (structured JSON) → every model patch
 * re-validated by the engine → a suggested revision people accept or reject per change.
 * The AI never approves, releases, edits locked parts or touches released revisions.
 */
import type { Confidence, Patch, PatchOp, Revision, RevisionContent, StdPart, Team, User, WorkspaceSettings, Finding } from '@bom/domain';
import { applyPatch, makePatch, newId } from '@bom/domain';
import { analyze, optimize, type Analysis } from '@bom/engine';
import { AiError, type AiProvider } from './provider';
import { SYSTEM } from './prompts';
import { optimizePayload } from './payload';
import type { AiOp, OptimizeOutput } from './schemas';

export interface ValuePin {
  partId: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface SuggestedChange {
  id: string;
  patch: Patch;
  source: 'rule' | 'ai';
  /** "Rule fix", "Mapping", or "Suggestion" (model idea with no rule behind it — starts unticked). */
  label: 'Rule fix' | 'Mapping' | 'Suggestion';
  title: string;
  reason: string;
  confidence: Confidence;
  team: Team;
  ruleId: string | null;
  assumptionKeys: string[];
  /** Low-confidence and rule-less changes start unticked. */
  checked: boolean;
  pins: ValuePin[];
}

export interface SuggestedRevision {
  id: string;
  revisionId: string;
  createdAt: string;
  model: string;
  changes: SuggestedChange[];
  notApplied: { title: string; reason: string; why: string }[];
  /** Set when the model pass failed; rule fixes are still shown. */
  explanationError: string | null;
  before: Analysis['summary'];
  afterAllAccepted: Analysis['summary'];
  ms: number;
}

export interface OptimizeRunLog {
  request: unknown;
  response: unknown;
  status: 'ok' | 'error' | 'timeout' | 'disabled';
  model: string | null;
  ms: number;
}

const running = new Set<string>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new AiError(`Timed out after ${ms / 1000} s`, 'timeout')), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

function pinsOf(content: RevisionContent, patch: Patch): ValuePin[] {
  const pins: ValuePin[] = [];
  for (const op of patch.ops) {
    if (op.op === 'setDim') pins.push({ partId: op.partId, field: op.dim, from: content.parts.find((p) => p.id === op.partId)?.dims[op.dim], to: op.value });
    else if (op.op === 'setField' && op.field !== 'match') pins.push({ partId: op.partId, field: op.field, from: (content.parts.find((p) => p.id === op.partId) as unknown as Record<string, unknown>)?.[op.field], to: op.value });
  }
  return pins;
}

const SAFE_FIELDS = new Set(['material', 'finishCode', 'hardwareSku', 'notes', 'position']);

/** Turn a model op into a domain op, or explain why not. */
export function toPatchOp(content: RevisionContent, op: AiOp): PatchOp | string {
  const part = content.parts.find((p) => p.id === op.partId);
  if (!part) return `unknown part ${op.partId}`;
  if (part.locked) return `${part.originalName} is locked`;
  if (op.op === 'setDim') {
    if (!op.dim || typeof op.value !== 'number' || !(op.value > 0 && op.value < 6000)) return 'size out of range';
    return { op: 'setDim', partId: part.id, dim: op.dim, value: op.value, from: part.dims[op.dim] };
  }
  if (op.op === 'setQty') {
    if (typeof op.value !== 'number' || !Number.isInteger(op.value) || op.value < 0 || op.value > 500) return 'quantity out of range';
    return { op: 'setField', partId: part.id, field: 'qty', value: op.value, from: part.qty };
  }
  if (!op.field || !SAFE_FIELDS.has(op.field)) return `field ${op.field} may not be changed by the AI`;
  return { op: 'setField', partId: part.id, field: op.field, value: String(op.value), from: (part as unknown as Record<string, unknown>)[op.field] };
}

const failKeys = (a: Analysis) => new Set(a.findings.filter((f) => f.severity === 'fail' && !f.waived).map((f) => f.key));

export interface RunOptimizeOptions {
  revision: Revision;
  category: string;
  subCategory: string;
  settings: WorkspaceSettings;
  dictionary: StdPart[];
  provider: AiProvider | null;
  user: User;
  onLog?: (log: OptimizeRunLog) => void;
}

export async function runOptimize(o: RunOptimizeOptions): Promise<SuggestedRevision> {
  const t0 = Date.now();
  if (o.revision.state === 'released') throw new AiError('Released revisions are read-only — AI optimize runs on drafts', 'disabled');
  if (!o.settings.ai.enabled) throw new AiError('AI optimize is turned off for this workspace', 'disabled');
  if (running.has(o.revision.id)) throw new AiError('An optimize run is already in progress for this revision', 'disabled');
  running.add(o.revision.id);
  try {
    // 1-2. Checks + deterministic fixes (up to 4 passes).
    const det = optimize(o.revision.content, o.settings);
    const base = det.content;
    const changes: SuggestedChange[] = det.patches.map((p) => ({
      id: newId('chg'),
      patch: p,
      source: 'rule',
      label: 'Rule fix',
      title: p.label ?? p.ruleId ?? 'Rule fix',
      reason: p.reason,
      confidence: p.confidence ?? 'medium',
      team: p.team ?? 'engineering',
      ruleId: p.ruleId ?? null,
      assumptionKeys: det.before.findings.find((f) => f.fix?.id === p.id)?.assumptionKeys ?? [],
      checked: p.confidence !== 'low',
      pins: pinsOf(o.revision.content, p),
    }));
    const notApplied: SuggestedRevision['notApplied'] = det.skipped.map((s) => ({ title: s.patch.reason, reason: s.patch.reason, why: s.reason }));
    let explanationError: string | null = null;
    let model = 'rules-only';

    // 3. Model pass (optional per workspace).
    if (o.settings.ai.modelPass && o.provider) {
      model = o.provider.model;
      const input = optimizePayload({ content: o.revision.content, findings: det.before.findings, fixes: det.patches, dictionary: o.dictionary, category: o.category, subCategory: o.subCategory });
      const started = Date.now();
      try {
        const res = await withTimeout(o.provider.complete({ task: 'optimize', system: SYSTEM.optimize, input, timeoutMs: o.settings.ai.timeoutMs }), o.settings.ai.timeoutMs);
        o.onLog?.({ request: input, response: res.raw, status: 'ok', model: res.model, ms: Date.now() - started });
        applyModelOutput(res.data, o.revision.content, base, changes, notApplied);
      } catch (err) {
        const e = err as AiError;
        explanationError = `The explanation step failed (${e.message}); the rule fixes below are still valid.`;
        o.onLog?.({ request: input, response: { error: e.message }, status: e.kind === 'timeout' ? 'timeout' : 'error', model: o.provider.model, ms: Date.now() - started });
      }
    }

    // Projected result if everything ticked is accepted.
    const accepted = changes.filter((c) => c.checked);
    let projected = o.revision.content;
    for (const c of accepted) {
      try {
        projected = applyPatch(projected, c.patch).content;
      } catch {
        /* conflicting change; reported at accept time */
      }
    }
    return {
      id: newId('sugg'),
      revisionId: o.revision.id,
      createdAt: new Date().toISOString(),
      model,
      changes,
      notApplied,
      explanationError,
      before: det.before.summary,
      afterAllAccepted: analyze(projected, o.settings).summary,
      ms: Date.now() - t0,
    };
  } finally {
    running.delete(o.revision.id);
  }
}

/** 4. Validate: every model patch runs through the same rules; one that creates a new failure is dropped. */
function applyModelOutput(out: OptimizeOutput, original: RevisionContent, base: RevisionContent, changes: SuggestedChange[], notApplied: SuggestedRevision['notApplied']): void {
  for (const e of out.explanations) {
    const c = changes.find((x) => x.patch.id === e.patchId);
    if (c && e.reason.trim()) c.reason = e.reason;
  }
  for (const m of out.mappings) {
    const part = original.parts.find((p) => p.id === m.partId);
    if (!part || part.stdCode || part.locked) continue;
    const patch = makePatch(
      [
        { op: 'setField', partId: part.id, field: 'stdCode', value: m.stdCode, from: null },
        { op: 'setField', partId: part.id, field: 'match', value: { ...part.match, status: 'ai', score: null, confirmedBy: null }, from: part.match },
      ],
      `${part.originalName} → ${m.stdCode}`,
      'ai',
      { confidence: m.confidence, label: 'Mapping' },
    );
    changes.push({ id: newId('chg'), patch, source: 'ai', label: 'Mapping', title: `Std Code for ${part.originalName}`, reason: m.reason, confidence: m.confidence, team: part.teamOwner, ruleId: null, assumptionKeys: [], checked: m.confidence === 'high', pins: [{ partId: part.id, field: 'stdCode', from: null, to: m.stdCode }] });
  }
  const before = failKeys(analyze(base));
  for (const s of out.suggestions) {
    const ops: PatchOp[] = [];
    const bad: string[] = [];
    for (const op of s.ops) {
      const r = toPatchOp(base, op);
      if (typeof r === 'string') bad.push(r);
      else ops.push(r);
    }
    if (bad.length || !ops.length) {
      notApplied.push({ title: s.title, reason: s.reason, why: bad.join('; ') || 'no changes' });
      continue;
    }
    const patch = makePatch(ops, s.title, 'ai', { confidence: s.confidence, ruleId: s.ruleId, team: s.team, label: s.ruleId ? 'AI fix' : 'Suggestion' });
    let after: Analysis;
    try {
      after = analyze(applyPatch(base, patch).content);
    } catch (err) {
      notApplied.push({ title: s.title, reason: s.reason, why: (err as Error).message });
      continue;
    }
    const worse = [...failKeys(after)].filter((k) => !before.has(k));
    if (worse.length) {
      const f = after.findings.find((x) => x.key === worse[0]) as Finding;
      notApplied.push({ title: s.title, reason: s.reason, why: `Not applied, made things worse: ${f.message}` });
      continue;
    }
    changes.push({
      id: newId('chg'),
      patch,
      source: 'ai',
      label: s.ruleId ? 'Rule fix' : 'Suggestion',
      title: s.title,
      reason: s.reason,
      confidence: s.confidence,
      team: s.team,
      ruleId: s.ruleId,
      assumptionKeys: s.assumptionKeys,
      checked: !!s.ruleId && s.confidence !== 'low',
      pins: pinsOf(base, patch),
    });
  }
}

/** 6. Accepted changes land in the draft as one history step, authored "AI optimize, accepted by Name". */
export function acceptChanges(revision: Revision, suggestion: SuggestedRevision, acceptedIds: string[], user: User): { content: RevisionContent; patch: Patch; rejected: { id: string; why: string }[] } {
  if (revision.state === 'released') throw new AiError('Released revisions are read-only', 'disabled');
  if (suggestion.revisionId !== revision.id) throw new AiError('This suggestion belongs to another revision', 'disabled');
  let content = revision.content;
  const ops: PatchOp[] = [];
  const rejected: { id: string; why: string }[] = [];
  for (const c of suggestion.changes.filter((x) => acceptedIds.includes(x.id))) {
    // Accepting a mapping in the review is the person's confirmation (PRD §4).
    const patch: Patch = {
      ...c.patch,
      ops: c.patch.ops.map((op) => (op.op === 'setField' && op.field === 'match' ? { ...op, value: { ...(op.value as object), status: 'confirmed', confirmedBy: user.id } } : op)),
    };
    if (patch.ops.some((op) => 'partId' in op && content.parts.find((p) => p.id === op.partId)?.locked)) {
      rejected.push({ id: c.id, why: 'part is locked' });
      continue;
    }
    try {
      content = applyPatch(content, patch).content;
      ops.push(...patch.ops);
    } catch (err) {
      rejected.push({ id: c.id, why: (err as Error).message });
    }
  }
  return { content, patch: makePatch(ops, `AI optimize, accepted by ${user.name}`, 'ai', { authorId: user.id }), rejected };
}
