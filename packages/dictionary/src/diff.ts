import type { StdPart } from '@bom/domain';
import { canonicalJson } from '@bom/domain';

export interface DictionaryDiff {
  added: StdPart[];
  removed: StdPart[];
  changed: { stdCode: string; fields: { field: keyof StdPart; before: unknown; after: unknown }[] }[];
  unchanged: number;
}

/** Re-import merges by Std Code and shows added / changed / removed before saving (PRD §10). */
export function diffDictionaries(before: StdPart[], after: StdPart[]): DictionaryDiff {
  const a = new Map(before.map((e) => [e.stdCode, e]));
  const b = new Map(after.map((e) => [e.stdCode, e]));
  const diff: DictionaryDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [code, e] of b) {
    const prev = a.get(code);
    if (!prev) {
      diff.added.push(e);
      continue;
    }
    const fields: DictionaryDiff['changed'][number]['fields'] = [];
    for (const k of Object.keys(e) as (keyof StdPart)[]) {
      if (canonicalJson(prev[k] ?? null) !== canonicalJson(e[k] ?? null)) fields.push({ field: k, before: prev[k], after: e[k] });
    }
    if (fields.length) diff.changed.push({ stdCode: code, fields });
    else diff.unchanged++;
  }
  for (const [code, e] of a) if (!b.has(code)) diff.removed.push(e);
  return diff;
}

/**
 * Merge a re-import into the current dictionary. Hand-entered enrichment
 * (axis map, default role, owner team) survives when the new sheet leaves it blank.
 */
export function mergeDictionaries(current: StdPart[], incoming: StdPart[], opts: { keepRemoved?: boolean } = {}): StdPart[] {
  const cur = new Map(current.map((e) => [e.stdCode, e]));
  const out: StdPart[] = incoming.map((e) => {
    const prev = cur.get(e.stdCode);
    if (!prev) return e;
    return { ...e, axisMap: e.axisMap ?? prev.axisMap, defaultRole: e.defaultRole ?? prev.defaultRole, ownerTeam: e.ownerTeam ?? prev.ownerTeam, nameEn: e.nameEn ?? prev.nameEn };
  });
  if (opts.keepRemoved) {
    const inc = new Set(incoming.map((e) => e.stdCode));
    for (const e of current) if (!inc.has(e.stdCode)) out.push(e);
  }
  return out;
}
