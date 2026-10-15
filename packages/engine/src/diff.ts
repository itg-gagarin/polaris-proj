import type { Part, RevisionContent, Team, Assembly } from '@bom/domain';
import { canonicalJson } from '@bom/domain';
import { FIELD_OWNER } from '@bom/domain';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface RevisionDiff {
  added: Part[];
  removed: Part[];
  changed: { partId: string; name: string; stdCode: string | null; team: Team; changes: FieldChange[] }[];
  assemblies: { added: Assembly[]; removed: Assembly[]; changed: { id: string; name: string; changes: FieldChange[] }[] };
  parameters: FieldChange[];
  assumptions: FieldChange[];
  header: FieldChange[];
  /** Teams whose review scope changed (resets their lane, PRD §9). */
  teams: Team[];
}

const PART_FIELDS: (keyof Part)[] = ['stdCode', 'name', 'position', 'qty', 'unit', 'material', 'finishCode', 'hardwareSku', 'teamOwner', 'role', 'notes', 'kind', 'locked', 'asymmetric', 'expressions', 'instanceTransforms', 'axisMap'];

function partKey(p: Part): string {
  return `${p.stdCode ?? ''}|${p.originalName.trim().toLowerCase()}|${p.position ?? ''}`;
}

/** BOM diff between any two revisions: sizes, quantities, materials, finish, hardware, added and removed lines. */
export function diffRevisions(a: RevisionContent, b: RevisionContent): RevisionDiff {
  const byIdA = new Map(a.parts.map((p) => [p.id, p]));
  const byKeyA = new Map(a.parts.map((p) => [partKey(p), p]));
  const matched = new Set<string>();
  const diff: RevisionDiff = { added: [], removed: [], changed: [], assemblies: { added: [], removed: [], changed: [] }, parameters: [], assumptions: [], header: [], teams: [] };
  const teams = new Set<Team>();
  for (const pb of b.parts) {
    const pa = byIdA.get(pb.id) ?? byKeyA.get(partKey(pb));
    if (!pa || matched.has(pa.id)) {
      diff.added.push(pb);
      teams.add(pb.teamOwner);
      continue;
    }
    matched.add(pa.id);
    const changes: FieldChange[] = [];
    for (const d of ['T', 'W', 'L'] as const) if (pa.dims[d] !== pb.dims[d]) changes.push({ field: d, before: pa.dims[d], after: pb.dims[d] });
    for (const f of PART_FIELDS) if (canonicalJson(pa[f] ?? null) !== canonicalJson(pb[f] ?? null)) changes.push({ field: f, before: pa[f], after: pb[f] });
    if (changes.length) {
      diff.changed.push({ partId: pb.id, name: pb.originalName, stdCode: pb.stdCode, team: pb.teamOwner, changes });
      for (const c of changes) teams.add(FIELD_OWNER[c.field] ?? pb.teamOwner);
    }
  }
  for (const pa of a.parts) if (!matched.has(pa.id)) {
    diff.removed.push(pa);
    teams.add(pa.teamOwner);
  }
  const asmA = new Map(a.assemblies.map((x) => [x.id, x]));
  const asmB = new Map(b.assemblies.map((x) => [x.id, x]));
  for (const [id, x] of asmB) {
    const y = asmA.get(id);
    if (!y) diff.assemblies.added.push(x);
    else {
      const changes = (['qty', 'dims', 'finishCode', 'assemblyStep', 'explodeVector', 'name'] as const).filter((k) => canonicalJson(x[k] ?? null) !== canonicalJson(y[k] ?? null)).map((k) => ({ field: k, before: y[k], after: x[k] }));
      if (changes.length) {
        diff.assemblies.changed.push({ id, name: x.name, changes });
        if (changes.some((c) => c.field === 'assemblyStep')) teams.add('assembly');
        if (changes.some((c) => c.field === 'finishCode')) teams.add('finishing');
        if (changes.some((c) => c.field === 'qty' || c.field === 'dims')) teams.add('engineering');
      }
    }
  }
  for (const [id, x] of asmA) if (!asmB.has(id)) diff.assemblies.removed.push(x);
  const kv = (x: Record<string, unknown>, y: Record<string, unknown>, out: FieldChange[]) => {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (canonicalJson(x[k] ?? null) !== canonicalJson(y[k] ?? null)) out.push({ field: k, before: x[k], after: y[k] });
  };
  kv(a.parameters as Record<string, unknown>, b.parameters as Record<string, unknown>, diff.parameters);
  kv(a.assumptions as Record<string, unknown>, b.assumptions as Record<string, unknown>, diff.assumptions);
  kv(a.header as unknown as Record<string, unknown>, b.header as unknown as Record<string, unknown>, diff.header);
  if (diff.parameters.length || diff.header.some((h) => h.field === 'productSize')) teams.add('design');
  if (diff.header.some((h) => h.field === 'packingSizes')) teams.add('packing');
  diff.teams = [...teams];
  return diff;
}

export function diffIsEmpty(d: RevisionDiff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length && !d.assemblies.added.length && !d.assemblies.removed.length && !d.assemblies.changed.length && !d.parameters.length && !d.assumptions.length && !d.header.length;
}
