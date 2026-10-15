import { hash52 } from './ids';
import type { RevisionContent } from './model';

/** JSON with sorted keys so the hash does not depend on property order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** Content hash of a revision; review approvals are tied to it. */
export function contentHash(content: RevisionContent): string {
  const s = canonicalJson(content);
  return `h${hash52(s).toString(36)}${hash52(s.split('').reverse().join('')).toString(36)}`;
}
