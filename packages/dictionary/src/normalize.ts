/**
 * Name normalisation for Indonesian shop-floor part names.
 * Part names are kept exactly as written for display; normalisation is only for matching.
 */

/** Shop-floor abbreviations → full words. */
export const ABBREVIATIONS: Record<string, string> = {
  samp: 'samping',
  smp: 'samping',
  sp: 'samping',
  tgh: 'tengah',
  tng: 'tengah',
  blk: 'belakang',
  blkg: 'belakang',
  bwh: 'bawah',
  bawh: 'bawah',
  dpn: 'depan',
  ats: 'atas',
  kn: 'kanan',
  kr: 'kiri',
  fr: 'frame',
  frm: 'frame',
  pnl: 'panel',
  penebal: 'penebalan',
  strecher: 'stretcher',
  streccher: 'stretcher',
  stretcer: 'stretcher',
  lis: 'list',
  hb: 'headboard',
  fb: 'footboard',
  ply: 'plywood',
  ext: 'extension',
  extention: 'extension',
  profile: 'profil',
  mdf: 'mdf',
  klos: 'klos',
  kloss: 'klos',
};

/** Words that describe where a part sits; collected from the dictionary's "Positions Seen" too. */
export const BASE_POSITIONS = [
  'kanan', 'kiri', 'atas', 'bawah', 'depan', 'belakang', 'tengah', 'samping', 'dalam', 'luar', 'tepi', 'sudut', 'corner',
];

/** Words that carry no meaning for matching. */
const STOP = new Set(['dan', 'and', 'utk', 'untuk', 'the', 'of', 'x', '+', '&']);

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Lowercase, expand abbreviations, drop punctuation and parenthesis markers, collapse spaces. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = stripDiacritics(String(raw))
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/[,./\;:'"!?_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s
    .split(' ')
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => t && !STOP.has(t))
    .join(' ');
}

export function tokens(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

/** Strip the "Rakitan" (assembly) prefix used on L1 head rows. */
export function stripAssemblyPrefix(normalized: string): string {
  return normalized.replace(/^(rakitan|rakit|assy|assembly)\s+/, '');
}

/** Numeric tokens (e.g. "klos 350") are variants, not names. */
export function splitVariantNumbers(normalized: string): { name: string; numbers: number[] } {
  const numbers: number[] = [];
  const name = tokens(normalized)
    .filter((t) => {
      if (/^\d+(\.\d+)?$/.test(t)) {
        numbers.push(Number(t));
        return false;
      }
      return true;
    })
    .join(' ');
  return { name, numbers };
}

/** Character trigram set (with padding) for fuzzy similarity. */
export function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

export function dice<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** Token similarity that also credits prefixes ("penebal" ~ "penebalan"). */
export function tokenSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const used = new Set<number>();
  let score = 0;
  for (const t of a) {
    let best = 0;
    let bestJ = -1;
    b.forEach((u, j) => {
      if (used.has(j)) return;
      const s = t === u ? 1 : t.length >= 4 && u.length >= 4 && (t.startsWith(u) || u.startsWith(t)) ? 0.85 : 0;
      if (s > best) {
        best = s;
        bestJ = j;
      }
    });
    if (bestJ >= 0) used.add(bestJ);
    score += best;
  }
  return (2 * score) / (a.length + b.length);
}

/** Levenshtein distance (small strings only). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
