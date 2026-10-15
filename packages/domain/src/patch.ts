import type { Patch, PatchOp, RevisionContent, Part, Assembly, Joint } from './model';
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
