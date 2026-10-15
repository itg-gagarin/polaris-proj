import type { Part, RevisionContent, DimKey } from '@bom/domain';
import { resolveAll } from './expressions';

export interface Resolved {
  content: RevisionContent;
  params: Record<string, number>;
  errors: { target: string; partId?: string; dim?: DimKey; message: string }[];
  /** Expression scope names for parts, e.g. part.panel_muka_laci.W */
  partRefs: Record<string, { partId: string; dim: DimKey }>;
}

export function partSlug(p: Part): string {
  return p.originalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Evaluate parameter and part-size expressions. Stored numbers are never rounded. */
export function resolveContent(content: RevisionContent): Resolved {
  const errors: Resolved['errors'] = [];
  const base: Record<string, number> = {};
  const exprs: Record<string, string> = {};
  for (const prm of Object.values(content.parameters)) {
    if (prm.expr) exprs[prm.key] = prm.expr;
    else base[prm.key] = prm.value;
  }
  const partRefs: Resolved['partRefs'] = {};
  const used = new Map<string, number>();
  for (const p of content.parts) {
    let slug = partSlug(p) || p.id;
    const n = (used.get(slug) ?? 0) + 1;
    used.set(slug, n);
    if (n > 1) slug = `${slug}_${n}`;
    for (const d of ['T', 'W', 'L'] as DimKey[]) {
      const names = [`part.${slug}.${d}`, `${p.id}.${d}`];
      const e = p.expressions[d];
      for (const name of names) {
        partRefs[name] = { partId: p.id, dim: d };
        if (e) exprs[name] = e;
        else base[name] = p.dims[d];
      }
    }
  }
  const { values, errors: errs } = resolveAll(exprs, base);
  for (const [k, m] of Object.entries(errs)) {
    const ref = partRefs[k];
    if (ref && k.startsWith('part.')) continue; // reported once via the id alias
    errors.push({ target: k, partId: ref?.partId, dim: ref?.dim, message: m });
  }
  const params: Record<string, number> = {};
  for (const prm of Object.values(content.parameters)) params[prm.key] = values[prm.key] ?? prm.value;
  const parts = content.parts.map((p) => {
    if (!Object.keys(p.expressions).length) return p;
    const dims = { ...p.dims };
    for (const d of Object.keys(p.expressions) as DimKey[]) {
      const v = values[`${p.id}.${d}`];
      if (v !== undefined && Number.isFinite(v)) dims[d] = v;
    }
    return { ...p, dims };
  });
  const parameters = { ...content.parameters };
  for (const k of Object.keys(parameters)) if (parameters[k].expr && values[k] !== undefined) parameters[k] = { ...parameters[k], value: values[k] };
  return { content: { ...content, parts, parameters }, params, errors, partRefs };
}
