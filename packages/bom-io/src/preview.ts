import type { Patch, PatchOp, RevisionContent, PartRole, StdPart } from '@bom/domain';
import { makePatch } from '@bom/domain';
import { roleInfo } from '@bom/dictionary';

/** A person confirms a fuzzy / AI match (or picks another candidate). */
export function confirmMatchPatch(content: RevisionContent, partId: string, stdCode: string, by: string, entry?: StdPart | null): Patch {
  const part = content.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`Unknown part ${partId}`);
  const manual = !part.match.candidates.some((c) => c.stdCode === stdCode);
  const ops: PatchOp[] = [
    { op: 'setField', partId, field: 'stdCode', value: stdCode, from: part.stdCode },
    { op: 'setField', partId, field: 'match', value: { ...part.match, status: manual ? 'manual' : 'confirmed', confirmedBy: by }, from: part.match },
  ];
  if (entry?.defaultRole && !part.role) ops.push({ op: 'setField', partId, field: 'role', value: entry.defaultRole, from: null });
  return makePatch(ops, `Confirm ${part.originalName} → ${stdCode}`, 'import', { authorId: by });
}

/** Bulk-confirm every fuzzy/AI match at or above a score. */
export function confirmAllPatch(content: RevisionContent, by: string, minScore = 0.7): Patch {
  const ops: PatchOp[] = [];
  for (const p of content.parts) {
    if ((p.match.status === 'fuzzy' || p.match.status === 'ai') && p.stdCode && (p.match.score ?? 0) >= minScore) {
      ops.push({ op: 'setField', partId: p.id, field: 'match', value: { ...p.match, status: 'confirmed', confirmedBy: by }, from: p.match });
    }
  }
  return makePatch(ops, `Confirm ${ops.length} suggested matches (score ≥ ${minScore})`, 'import', { authorId: by });
}

export function setRolePatch(content: RevisionContent, partId: string, role: PartRole, by: string): Patch {
  const part = content.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`Unknown part ${partId}`);
  const ri = roleInfo(role);
  const ops: PatchOp[] = [
    { op: 'setField', partId, field: 'role', value: role, from: part.role },
    { op: 'setField', partId, field: 'axisMap', value: ri?.axis ?? part.axisMap, from: part.axisMap },
  ];
  return makePatch(ops, `Set role of ${part.originalName} to ${role}`, 'user', { authorId: by });
}

export function matchSummary(content: RevisionContent): Record<string, number> {
  const out: Record<string, number> = { code: 0, exact: 0, fuzzy: 0, ai: 0, confirmed: 0, manual: 0, unmatched: 0 };
  for (const p of content.parts) out[p.match.status] = (out[p.match.status] ?? 0) + 1;
  return out;
}

/** A match counts as settled when it is exact or a person confirmed it (PRD §4: steps 3 and 4 need a person). */
export function isMatchSettled(status: string): boolean {
  return status === 'code' || status === 'exact' || status === 'confirmed' || status === 'manual';
}
