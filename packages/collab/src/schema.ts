/**
 * Shared board document (one Yjs doc per board, PRD §11). Draft revision content lives under
 * `rev:<id>` with one Y.Map per part, so two people editing different fields of the same part
 * both win, and the same field resolves last-write-wins.
 */
import * as Y from 'yjs';
import type { BoardItem, Part, Patch, PatchOp, RevisionContent } from '@bom/domain';
import { applyPatch, canonicalJson, clone } from '@bom/domain';

export const PART_FIELD_KEYS = ['dims.T', 'dims.W', 'dims.L'] as const;

export interface RevisionMaps {
  root: Y.Map<unknown>;
  parts: Y.Map<Y.Map<unknown>>;
  order: Y.Array<string>;
  assemblies: Y.Map<unknown>;
  joints: Y.Map<unknown>;
  parameters: Y.Map<unknown>;
  assumptions: Y.Map<unknown>;
  waivers: Y.Map<unknown>;
  meta: Y.Map<unknown>;
}

export function boardItems(doc: Y.Doc): Y.Map<BoardItem> {
  return doc.getMap<BoardItem>('items');
}

export function revisionMaps(doc: Y.Doc, revisionId: string): RevisionMaps {
  const root = doc.getMap<unknown>(`rev:${revisionId}`);
  const get = <T>(k: string, make: () => T): T => {
    let v = root.get(k) as T | undefined;
    if (!v) {
      v = make();
      root.set(k, v);
    }
    return v;
  };
  return {
    root,
    parts: get('parts', () => new Y.Map<Y.Map<unknown>>()),
    order: get('order', () => new Y.Array<string>()),
    assemblies: get('assemblies', () => new Y.Map()),
    joints: get('joints', () => new Y.Map()),
    parameters: get('parameters', () => new Y.Map()),
    assumptions: get('assumptions', () => new Y.Map()),
    waivers: get('waivers', () => new Y.Map()),
    meta: get('meta', () => new Y.Map()),
  };
}

function partRecord(p: Part): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'dims') for (const d of ['T', 'W', 'L'] as const) o[`dims.${d}`] = p.dims[d];
    else o[k] = clone(v);
  }
  return o;
}

function partToY(p: Part): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(partRecord(p))) m.set(k, v);
  return m;
}

function partFromY(m: Y.Map<unknown>): Part {
  const o: Record<string, unknown> = {};
  m.forEach((v, k) => {
    if (!k.startsWith('dims.')) o[k] = v;
  });
  o.dims = { T: m.get('dims.T'), W: m.get('dims.W'), L: m.get('dims.L') };
  return clone(o) as unknown as Part;
}

/** Load revision content into the doc (first open of a draft). */
export function initRevision(doc: Y.Doc, revisionId: string, content: RevisionContent, origin: unknown = 'init'): void {
  doc.transact(() => {
    const r = revisionMaps(doc, revisionId);
    if (r.meta.get('initialised')) return;
    r.meta.set('header', clone(content.header));
    r.meta.set('family', content.family);
    for (const p of content.parts) {
      r.parts.set(p.id, partToY(p));
      r.order.push([p.id]);
    }
    for (const a of content.assemblies) r.assemblies.set(a.id, clone(a));
    for (const j of content.joints) r.joints.set(j.id, clone(j));
    for (const [k, v] of Object.entries(content.parameters)) r.parameters.set(k, clone(v));
    for (const [k, v] of Object.entries(content.assumptions)) r.assumptions.set(k, clone(v));
    for (const [k, v] of Object.entries(content.waivers)) r.waivers.set(k, clone(v));
    r.meta.set('initialised', true);
  }, origin);
}

export function readRevision(doc: Y.Doc, revisionId: string): RevisionContent | null {
  const r = revisionMaps(doc, revisionId);
  if (!r.meta.get('initialised')) return null;
  const seen = new Set<string>();
  const parts: Part[] = [];
  for (const id of r.order.toArray()) {
    const m = r.parts.get(id);
    if (m && !seen.has(id)) {
      seen.add(id);
      parts.push(partFromY(m));
    }
  }
  const obj = <T>(m: Y.Map<unknown>) => clone(Object.fromEntries(m.entries())) as T;
  return {
    header: clone(r.meta.get('header')) as RevisionContent['header'],
    family: r.meta.get('family') as RevisionContent['family'],
    parts,
    assemblies: Object.values(obj<Record<string, RevisionContent['assemblies'][number]>>(r.assemblies)),
    joints: Object.values(obj<Record<string, RevisionContent['joints'][number]>>(r.joints)),
    parameters: obj(r.parameters),
    assumptions: obj(r.assumptions),
    waivers: obj(r.waivers),
  };
}

/** Apply a domain patch to the shared doc as field-level writes (origin = the editing user, for per-user undo). */
export function applyPatchToDoc(doc: Y.Doc, revisionId: string, patch: Patch, origin: unknown): void {
  const r = revisionMaps(doc, revisionId);
  const current = readRevision(doc, revisionId);
  if (!current) throw new Error(`Revision ${revisionId} not loaded in the board document`);
  // Validate with the domain patch engine first (throws on unknown parts etc.).
  applyPatch(current, patch);
  doc.transact(() => {
    for (const op of patch.ops) writeOp(r, op);
  }, origin);
}

function writeOp(r: RevisionMaps, op: PatchOp): void {
  switch (op.op) {
    case 'setDim':
      r.parts.get(op.partId)?.set(`dims.${op.dim}`, op.value);
      {
        const p = r.parts.get(op.partId);
        const ex = { ...((p?.get('expressions') as Record<string, string>) ?? {}) };
        if (ex[op.dim] !== undefined) {
          delete ex[op.dim];
          p?.set('expressions', ex);
        }
      }
      break;
    case 'setExpr': {
      const p = r.parts.get(op.partId);
      const ex = { ...((p?.get('expressions') as Record<string, string>) ?? {}) };
      if (op.expr === null || op.expr === '') delete ex[op.dim];
      else ex[op.dim] = op.expr;
      p?.set('expressions', ex);
      break;
    }
    case 'setField':
      r.parts.get(op.partId)?.set(op.field, clone(op.value));
      break;
    case 'setTransform': {
      const p = r.parts.get(op.partId);
      const t = { ...((p?.get('instanceTransforms') as Record<number, unknown>) ?? {}) };
      if (op.transform) t[op.instance] = clone(op.transform);
      else delete t[op.instance];
      p?.set('instanceTransforms', t);
      break;
    }
    case 'addPart':
      r.parts.set(op.part.id, partToY(op.part));
      r.order.push([op.part.id]);
      break;
    case 'removePart': {
      r.parts.delete(op.partId);
      const i = r.order.toArray().indexOf(op.partId);
      if (i >= 0) r.order.delete(i, 1);
      for (const [id, j] of r.joints.entries()) {
        const jj = j as { partA: string; partB: string };
        if (jj.partA === op.partId || jj.partB === op.partId) r.joints.delete(id);
      }
      break;
    }
    case 'setAssembly': {
      const a = r.assemblies.get(op.assemblyId) as Record<string, unknown> | undefined;
      if (a) r.assemblies.set(op.assemblyId, { ...a, [op.field]: clone(op.value) });
      break;
    }
    case 'addAssembly':
      r.assemblies.set(op.assembly.id, clone(op.assembly));
      break;
    case 'removeAssembly':
      r.assemblies.delete(op.assemblyId);
      break;
    case 'addJoint':
      r.joints.set(op.joint.id, clone(op.joint));
      break;
    case 'removeJoint':
      r.joints.delete(op.jointId);
      break;
    case 'setParameter':
      if (op.parameter) r.parameters.set(op.key, clone(op.parameter));
      else r.parameters.delete(op.key);
      break;
    case 'setAssumption':
      if (op.assumption) r.assumptions.set(op.key, clone(op.assumption));
      else r.assumptions.delete(op.key);
      break;
    case 'setHeader': {
      const h = (r.meta.get('header') as Record<string, unknown>) ?? {};
      r.meta.set('header', { ...h, [op.field]: clone(op.value) });
      break;
    }
    case 'setWaiver':
      if (op.waiver) r.waivers.set(op.findingKey, clone(op.waiver));
      else r.waivers.delete(op.findingKey);
      break;
  }
}

/**
 * Bring the live document to `content` with field-level writes only where values differ. Used when
 * the revision row changed while nobody had the document open (REST edit, AI accept, restore), so
 * offline replicas still merge field by field instead of one side replacing whole maps.
 */
export function syncDocTo(doc: Y.Doc, revisionId: string, content: RevisionContent, origin: unknown = 'server'): number {
  let writes = 0;
  const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
  doc.transact(() => {
    const r = revisionMaps(doc, revisionId);
    if (!r.meta.get('initialised')) {
      initRevision(doc, revisionId, content, origin);
      writes++;
      return;
    }
    const setIf = (m: Y.Map<unknown>, k: string, v: unknown) => {
      if (!same(m.get(k), v)) {
        m.set(k, clone(v));
        writes++;
      }
    };
    setIf(r.meta, 'header', content.header);
    setIf(r.meta, 'family', content.family);
    const want = new Set(content.parts.map((p) => p.id));
    for (const id of [...r.parts.keys()]) if (!want.has(id)) {
      r.parts.delete(id);
      writes++;
    }
    for (const p of content.parts) {
      const m = r.parts.get(p.id);
      if (!m) {
        r.parts.set(p.id, partToY(p));
        writes++;
        continue;
      }
      const target = partRecord(p);
      for (const [k, v] of Object.entries(target)) setIf(m, k, v);
      for (const k of [...m.keys()]) if (!(k in target)) {
        m.delete(k);
        writes++;
      }
    }
    const order = content.parts.map((p) => p.id);
    if (!same(r.order.toArray(), order)) {
      r.order.delete(0, r.order.length);
      r.order.push(order);
      writes++;
    }
    const syncMap = (m: Y.Map<unknown>, entries: [string, unknown][]) => {
      const keys = new Set(entries.map(([k]) => k));
      for (const k of [...m.keys()]) if (!keys.has(k)) {
        m.delete(k);
        writes++;
      }
      for (const [k, v] of entries) setIf(m, k, v);
    };
    syncMap(r.assemblies, content.assemblies.map((a) => [a.id, a]));
    syncMap(r.joints, content.joints.map((j) => [j.id, j]));
    syncMap(r.parameters, Object.entries(content.parameters));
    syncMap(r.assumptions, Object.entries(content.assumptions));
    syncMap(r.waivers, Object.entries(content.waivers));
  }, origin);
  return writes;
}
