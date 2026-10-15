/**
 * Privacy: only the BOM, the findings and the dictionary rows involved are sent — never drawings,
 * comments, meeting notes or people (PRD §8 cost and privacy).
 */
import type { Finding, Part, Patch, RevisionContent, StdPart } from '@bom/domain';

export interface BomLine {
  id: string;
  name: string;
  stdCode: string | null;
  l1: string | null;
  position: string | null;
  T: number;
  W: number;
  L: number;
  qty: number;
  unit: string;
  material: string | null;
  finishCode: string | null;
  hardwareSku: string | null;
  role: string | null;
  team: string;
  locked: boolean;
}

export const bomLine = (p: Part): BomLine => ({
  id: p.id,
  name: p.originalName,
  stdCode: p.stdCode,
  l1: p.l1,
  position: p.position,
  T: p.dims.T,
  W: p.dims.W,
  L: p.dims.L,
  qty: p.qty,
  unit: p.unit,
  material: p.material,
  finishCode: p.finishCode,
  hardwareSku: p.hardwareSku,
  role: p.role,
  team: p.teamOwner,
  locked: p.locked,
});

const dictRow = (e: StdPart) => ({ stdCode: e.stdCode, name: e.name, l1: e.l1, l2: e.l2, category: e.category, subCategory: e.subCategory, positions: e.positions, mergedNames: e.mergedNames.slice(0, 8), axisMap: e.axisMap, defaultRole: e.defaultRole });

export function optimizePayload(opts: { content: RevisionContent; findings: Finding[]; fixes: Patch[]; dictionary: StdPart[]; category: string; subCategory: string }) {
  const involved = new Set<string>();
  for (const f of opts.findings) f.partIds.forEach((id) => involved.add(id));
  for (const p of opts.fixes) for (const op of p.ops) if ('partId' in op) involved.add(op.partId);
  const unmatched = opts.content.parts.filter((p) => !p.stdCode && p.kind !== 'packing');
  unmatched.forEach((p) => involved.add(p.id));
  // Context: the other parts of the assemblies involved (BOM lines only), capped.
  const asm = new Set(opts.content.parts.filter((p) => involved.has(p.id)).map((p) => p.assemblyId));
  const parts = opts.content.parts.filter((p) => involved.has(p.id) || (asm.has(p.assemblyId) && p.kind !== 'packing')).slice(0, 200).map(bomLine);
  const codes = new Set([...parts.map((p) => p.stdCode).filter(Boolean), ...unmatched.flatMap((p) => p.match.candidates.map((c) => c.stdCode))]);
  const dict = opts.dictionary.filter((e) => codes.has(e.stdCode) || (e.category === opts.category && e.subCategory === opts.subCategory)).slice(0, 300).map(dictRow);
  return {
    product: { family: opts.content.family, category: opts.category, subCategory: opts.subCategory, size: opts.content.header.productSize },
    assumptions: Object.values(opts.content.assumptions).map((a) => ({ key: a.key, value: a.value, confidence: a.confidence, note: a.note })),
    parameters: Object.fromEntries(Object.values(opts.content.parameters).map((p) => [p.key, p.value])),
    findings: opts.findings.filter((f) => !f.waived).map((f) => ({ key: f.key, rule: f.ruleId, severity: f.severity, confidence: f.confidence, team: f.ownerTeam, parts: f.partIds, message: f.message, numbers: f.numbers, assumptions: f.assumptionKeys })),
    computedFixes: opts.fixes.map((p) => ({ patchId: p.id, rule: p.ruleId, reason: p.reason, ops: p.ops })),
    bom: parts,
    unmatched: unmatched.map((p) => ({ id: p.id, name: p.originalName, l1: p.l1, candidates: p.match.candidates })),
    dictionary: dict,
  };
}
