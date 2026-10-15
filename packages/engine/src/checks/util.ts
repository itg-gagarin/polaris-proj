import type { Finding, Patch, PatchOp, Part, Axis } from '@bom/domain';
import { makePatch } from '@bom/domain';
import { worldSize, dimOnAxis } from '../geometry';
import type { CheckRule } from './types';

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const mm = (n: number) => `${r1(n)}`;

export function finding(rule: CheckRule, f: Omit<Finding, 'key' | 'ruleId' | 'title' | 'ownerTeam' | 'fix' | 'assumptionKeys' | 'numbers'> & Partial<Pick<Finding, 'fix' | 'assumptionKeys' | 'numbers' | 'ownerTeam'>> & { disc?: string }): Finding {
  const ids = [...new Set(f.partIds)].sort();
  return {
    key: `${rule.id}:${f.disc ?? ''}:${ids.join(',')}`,
    ruleId: rule.id,
    title: rule.title,
    severity: f.severity,
    confidence: f.confidence,
    ownerTeam: f.ownerTeam ?? rule.team,
    partIds: ids,
    message: f.message,
    numbers: f.numbers ?? {},
    assumptionKeys: f.assumptionKeys ?? [],
    fix: f.fix ?? null,
    at: f.at,
  };
}

export function fixPatch(rule: CheckRule, ops: PatchOp[], reason: string, confidence: Finding['confidence']): Patch {
  return makePatch(ops, reason, 'rule', { ruleId: rule.id, confidence, team: rule.team });
}

export const setDim = (p: Part, dim: 'T' | 'W' | 'L', value: number): PatchOp => ({ op: 'setDim', partId: p.id, dim, value: r1(value), from: p.dims[dim] });

/** Size of a part along a world axis (respects its axis map, so W/L swaps can't fool a check). */
export const ext = (p: Part, axis: Axis): number => worldSize(p.dims, p.axisMap)[axis];

/** Set the cut dimension that runs along a world axis. */
export const setAxis = (p: Part, axis: Axis, value: number): PatchOp => setDim(p, dimOnAxis(p.axisMap, axis), value);
