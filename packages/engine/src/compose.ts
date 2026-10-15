import type { RevisionContent, Assembly, Part } from '@bom/domain';
import { emptyContent, clone } from '@bom/domain';

export interface Component {
  key: string;
  content: RevisionContent;
}

/**
 * Combine component products (headboard, footboard, side rails) into one bed set so the
 * slat, rail and mattress checks can run on the whole bed.
 */
export function composeSet(name: string, components: Component[], family: RevisionContent['family'] = 'bed'): RevisionContent {
  const out = emptyContent(family);
  out.header = { ...clone(components[0]?.content.header ?? out.header), description: name, productSize: null, packingSizes: components.flatMap((c) => c.content.header.packingSizes) };
  for (const c of components) {
    const asmIds = new Map<string, string>();
    for (const a of c.content.assemblies) {
      const id = `${c.key}__${a.id}`;
      asmIds.set(a.id, id);
      out.assemblies.push({ ...clone(a), id, notes: `${a.notes} component:${c.key}`.trim() } as Assembly);
    }
    for (const p of c.content.parts) {
      out.parts.push({ ...clone(p), id: `${c.key}__${p.id}`, assemblyId: p.assemblyId ? asmIds.get(p.assemblyId) ?? null : null, attrs: { ...p.attrs, component: c.key } } as Part);
    }
    for (const [k, v] of Object.entries(c.content.parameters)) out.parameters[`${c.key}.${k}`] = { ...v, key: `${c.key}.${k}` };
    if (c.content.header.productSize && /hb|head/i.test(c.key)) out.parameters['hb.height'] = { key: 'hb.height', expr: null, value: c.content.header.productSize.H, source: 'import', note: 'Headboard height' };
  }
  const hb = components.find((c) => /hb|head/i.test(c.key))?.content.header.productSize;
  if (hb) out.header.productSize = null;
  return out;
}
