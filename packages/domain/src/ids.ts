/** Short, sortable-enough random ids. Works in Node >= 19 and every modern browser. */
export type Id = string;

let counter = 0;

export function newId(prefix: string): Id {
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${rand}`;
}

/** Deterministic id from a seed string (FNV-1a 52-bit) — used by importers so re-imports are stable. */
export function stableId(prefix: string, seed: string): Id {
  return `${prefix}_${hash52(seed).toString(36)}`;
}

export function hash52(input: string): number {
  // FNV-1a over UTF-16 code units, folded into 52 bits to stay a safe integer.
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193) ^ (h1 >>> 7);
  }
  return (h1 >>> 0) * 0x100000 + ((h2 >>> 0) & 0xfffff);
}
