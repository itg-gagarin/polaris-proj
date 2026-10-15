import type { Patch, PatchOp, RevisionContent, Part, Assembly, Joint, PartField, ProductHeader } from './model';
import { DIM_KEYS } from './model';
import { canonicalJson } from './hash';
import { newId } from './ids';

export class PatchError extends Error {}

function indexOfId<T extends { id: string }>(arr: T[], id: string): number {
  for (let i = 0; i < arr.length; i++) if (arr[i].id === id) return i;
  return -1;
}

/** Deep clone for plain JSON data (structuredClone is not available in every worker polyfill). */
export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/**
 * Apply a patch immutably. Returns the new content and the inverse patch
 * (with `from` values filled in) so undo, audit and diff all share one code path.
 */
export function applyPatch(content: RevisionContent, patch: Patch): { content: RevisionContent; inverse: Patch } {
  let parts = content.parts;
  let assemblies = content.assemblies;
  let joints = content.joints;
  let parameters = content.parameters;
  let assumptions = content.assumptions;
  let header = content.header;
  let waivers = content.waivers;
  const inverseOps: PatchOp[] = [];

  const editPart = (partId: string, fn: (p: Part) => Part) => {
    const i = indexOfId(parts, partId);
    if (i < 0) throw new PatchError(`Unknown part ${partId}`);
    if (parts === content.parts) parts = parts.slice();
    parts[i] = fn(parts[i]);
  };

  for (const op of patch.ops) {
    switch (op.op) {
      case 'setDim':
        editPart(op.partId, (p) => {
          // A typed number breaks the expression link; the inverse restores the value, then the expression.
          const expressions = { ...p.expressions };
          if (expressions[op.dim] !== undefined) {
            inverseOps.unshift({ op: 'setExpr', partId: op.partId, dim: op.dim, expr: expressions[op.dim]!, from: null });
            delete expressions[op.dim];
          }
          inverseOps.unshift({ op: 'setDim', partId: op.partId, dim: op.dim, value: p.dims[op.dim], from: op.value });
          return { ...p, dims: { ...p.dims, [op.dim]: op.value }, expressions };
        });
        break;
      case 'setExpr':
        editPart(op.partId, (p) => {
          const prev = p.expressions[op.dim] ?? null;
          inverseOps.unshift({ op: 'setExpr', partId: op.partId, dim: op.dim, expr: prev, from: op.expr });
          const expressions = { ...p.expressions };
          if (op.expr === null || op.expr === '') delete expressions[op.dim];
          else expressions[op.dim] = op.expr;
          return { ...p, expressions };
        });
        break;
      case 'setField':
        editPart(op.partId, (p) => {
          inverseOps.unshift({ op: 'setField', partId: op.partId, field: op.field, value: clone((p as any)[op.field]), from: op.value });
          return { ...p, [op.field]: clone(op.value) } as Part;
        });
        break;
      case 'setTransform':
        editPart(op.partId, (p) => {
          const prev = p.instanceTransforms[op.instance] ?? null;
          inverseOps.unshift({ op: 'setTransform', partId: op.partId, instance: op.instance, transform: prev, from: op.transform });
          const instanceTransforms = { ...p.instanceTransforms };
          if (op.transform) instanceTransforms[op.instance] = clone(op.transform);
          else delete instanceTransforms[op.instance];
          return { ...p, instanceTransforms };
        });
        break;
      case 'addPart': {
        if (indexOfId(parts, op.part.id) >= 0) throw new PatchError(`Duplicate part ${op.part.id}`);
        parts = [...parts, clone(op.part)];
        inverseOps.unshift({ op: 'removePart', partId: op.part.id });
        break;
      }
      case 'removePart': {
        const i = indexOfId(parts, op.partId);
        if (i < 0) throw new PatchError(`Unknown part ${op.partId}`);
        const removed = parts[i];
        parts = parts.filter((_, k) => k !== i);
        // Remove joints referencing it so geometry stays consistent.
        const dangling = joints.filter((j) => j.partA === op.partId || j.partB === op.partId);
        if (dangling.length) {
          joints = joints.filter((j) => j.partA !== op.partId && j.partB !== op.partId);
          for (const j of dangling) inverseOps.unshift({ op: 'addJoint', joint: j });
        }
        inverseOps.unshift({ op: 'addPart', part: removed });
        break;
      }
      case 'setAssembly': {
        const i = indexOfId(assemblies, op.assemblyId);
        if (i < 0) throw new PatchError(`Unknown assembly ${op.assemblyId}`);
        if (assemblies === content.assemblies) assemblies = assemblies.slice();
        const a = assemblies[i];
        inverseOps.unshift({ op: 'setAssembly', assemblyId: op.assemblyId, field: op.field, value: clone(a[op.field]), from: op.value });
        assemblies[i] = { ...a, [op.field]: clone(op.value) } as Assembly;
        break;
      }
      case 'addAssembly':
        if (indexOfId(assemblies, op.assembly.id) >= 0) throw new PatchError(`Duplicate assembly ${op.assembly.id}`);
        assemblies = [...assemblies, clone(op.assembly)];
        inverseOps.unshift({ op: 'removeAssembly', assemblyId: op.assembly.id });
        break;
      case 'removeAssembly': {
        const i = indexOfId(assemblies, op.assemblyId);
        if (i < 0) throw new PatchError(`Unknown assembly ${op.assemblyId}`);
        inverseOps.unshift({ op: 'addAssembly', assembly: assemblies[i] });
        assemblies = assemblies.filter((_, k) => k !== i);
        break;
      }
      case 'addJoint':
        joints = [...joints, clone(op.joint)];
        inverseOps.unshift({ op: 'removeJoint', jointId: op.joint.id });
        break;
      case 'removeJoint': {
        const i = indexOfId(joints, op.jointId);
        if (i < 0) throw new PatchError(`Unknown joint ${op.jointId}`);
        inverseOps.unshift({ op: 'addJoint', joint: joints[i] as Joint });
        joints = joints.filter((_, k) => k !== i);
        break;
      }
      case 'setParameter': {
        const prev = parameters[op.key] ?? null;
        inverseOps.unshift({ op: 'setParameter', key: op.key, parameter: prev, from: op.parameter });
        parameters = { ...parameters };
        if (op.parameter) parameters[op.key] = clone(op.parameter);
        else delete parameters[op.key];
        break;
      }
      case 'setAssumption': {
        const prev = assumptions[op.key] ?? null;
        inverseOps.unshift({ op: 'setAssumption', key: op.key, assumption: prev, from: op.assumption });
        assumptions = { ...assumptions };
        if (op.assumption) assumptions[op.key] = clone(op.assumption);
        else delete assumptions[op.key];
        break;
      }
      case 'setHeader':
        inverseOps.unshift({ op: 'setHeader', field: op.field, value: clone(header[op.field]), from: op.value });
        header = { ...header, [op.field]: clone(op.value) };
        break;
      case 'setWaiver': {
        const prev = waivers[op.findingKey] ?? null;
        inverseOps.unshift({ op: 'setWaiver', findingKey: op.findingKey, waiver: prev, from: op.waiver });
        waivers = { ...waivers };
        if (op.waiver) waivers[op.findingKey] = clone(op.waiver);
        else delete waivers[op.findingKey];
        break;
      }
      default: {
        const never: never = op;
        throw new PatchError(`Unknown op ${(never as PatchOp).op}`);
      }
    }
  }

  return {
    content: { ...content, parts, assemblies, joints, parameters, assumptions, header, waivers },
    inverse: { ...patch, id: newId('patch'), ops: inverseOps, reason: `Undo: ${patch.reason}` },
  };
}

/** Apply several patches in order. */
export function applyPatches(content: RevisionContent, patches: Patch[]): RevisionContent {
  return patches.reduce((c, p) => applyPatch(c, p).content, content);
}

/** Part ids touched by a patch (for lane resets, AI tinting, per-user undo). */
export function touchedPartIds(patch: Patch): string[] {
  const ids = new Set<string>();
  for (const op of patch.ops) {
    if ('partId' in op && op.partId) ids.add(op.partId);
    if (op.op === 'addPart') ids.add(op.part.id);
  }
  return [...ids];
}

export function makePatch(ops: PatchOp[], reason: string, source: Patch['source'] = 'user', extra: Partial<Patch> = {}): Patch {
  return { id: newId('patch'), ops, reason, source, ...extra };
}

/**
 * The patch that turns `before` into `after` (field level). Used to persist edits that arrive as
 * document changes (undo/redo, multi-field drags) and to audit snapshots.
 */
export function diffToPatch(before: RevisionContent, after: RevisionContent, reason: string, source: Patch['source'] = 'user'): Patch {
  const ops: PatchOp[] = [];
  const eq = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
  const bParts = new Map(before.parts.map((p) => [p.id, p]));
  const aParts = new Map(after.parts.map((p) => [p.id, p]));
  for (const p of before.parts) if (!aParts.has(p.id)) ops.push({ op: 'removePart', partId: p.id });
  for (const p of after.parts) {
    const b = bParts.get(p.id);
    if (!b) {
      ops.push({ op: 'addPart', part: clone(p) });
      continue;
    }
    for (const d of DIM_KEYS) {
      if (b.dims[d] !== p.dims[d]) ops.push({ op: 'setDim', partId: p.id, dim: d, value: p.dims[d] });
      if ((b.expressions[d] ?? null) !== (p.expressions[d] ?? null)) ops.push({ op: 'setExpr', partId: p.id, dim: d, expr: p.expressions[d] ?? null });
    }
    const idx = new Set([...Object.keys(b.instanceTransforms), ...Object.keys(p.instanceTransforms)].map(Number));
    for (const i of idx) if (!eq(b.instanceTransforms[i], p.instanceTransforms[i])) ops.push({ op: 'setTransform', partId: p.id, instance: i, transform: p.instanceTransforms[i] ? clone(p.instanceTransforms[i]) : null });
    for (const k of Object.keys({ ...b, ...p }) as (keyof Part)[]) {
      if (k === 'id' || k === 'dims' || k === 'expressions' || k === 'instanceTransforms') continue;
      if (!eq(b[k], p[k])) ops.push({ op: 'setField', partId: p.id, field: k as PartField, value: clone(p[k]) });
    }
  }
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const bA = byId(before.assemblies);
  const aA = byId(after.assemblies);
  for (const a of before.assemblies) if (!aA.has(a.id)) ops.push({ op: 'removeAssembly', assemblyId: a.id });
  for (const a of after.assemblies) {
    const b = bA.get(a.id);
    if (!b) ops.push({ op: 'addAssembly', assembly: clone(a) });
    else for (const k of Object.keys({ ...b, ...a }) as (keyof Assembly)[]) if (k !== 'id' && !eq(b[k], a[k])) ops.push({ op: 'setAssembly', assemblyId: a.id, field: k, value: clone(a[k]) });
  }
  const bJ = byId(before.joints);
  const aJ = byId(after.joints);
  for (const j of before.joints) if (!aJ.has(j.id) || !eq(j, aJ.get(j.id))) ops.push({ op: 'removeJoint', jointId: j.id });
  for (const j of after.joints) if (!bJ.has(j.id) || !eq(j, bJ.get(j.id))) ops.push({ op: 'addJoint', joint: clone(j) });
  for (const k of new Set([...Object.keys(before.parameters), ...Object.keys(after.parameters)])) if (!eq(before.parameters[k], after.parameters[k])) ops.push({ op: 'setParameter', key: k, parameter: after.parameters[k] ? clone(after.parameters[k]) : null });
  for (const k of new Set([...Object.keys(before.assumptions), ...Object.keys(after.assumptions)])) if (!eq(before.assumptions[k], after.assumptions[k])) ops.push({ op: 'setAssumption', key: k, assumption: after.assumptions[k] ? clone(after.assumptions[k]) : null });
  for (const k of new Set([...Object.keys(before.waivers), ...Object.keys(after.waivers)])) if (!eq(before.waivers[k], after.waivers[k])) ops.push({ op: 'setWaiver', findingKey: k, waiver: after.waivers[k] ? clone(after.waivers[k]) : null });
  for (const k of Object.keys({ ...before.header, ...after.header }) as (keyof ProductHeader)[]) if (!eq(before.header[k], after.header[k])) ops.push({ op: 'setHeader', field: k, value: clone(after.header[k]) });
  return makePatch(ops, reason, source);
}
