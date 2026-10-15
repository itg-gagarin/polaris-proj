import type { StdPart, MatchCandidate, MatchStatus } from '@bom/domain';
import { inferRole } from './roles';
import {
  normalizeName, stripAssemblyPrefix, splitVariantNumbers, tokens, trigrams, dice, tokenSimilarity, BASE_POSITIONS,
} from './normalize';

export interface MatchInput {
  stdCode?: string | null;
  name: string;
  /** L1 head name (assembly context) — helps disambiguate component names. */
  l1?: string | null;
  position?: string | null;
  category?: string | null;
  subCategory?: string | null;
  /** Prefer L1 (head) or L2 (component) entries. */
  level?: 1 | 2 | null;
}

export interface MatchResult {
  status: Extract<MatchStatus, 'code' | 'exact' | 'fuzzy' | 'unmatched'>;
  stdCode: string | null;
  entry: StdPart | null;
  score: number;
  candidates: MatchCandidate[];
  /** Position words split off the name ("Kiri", "Atas"…). */
  position: string | null;
}

interface Prepared {
  entry: StdPart;
  role: string | null;
  forms: { norm: string; toks: string[]; tri: Set<string> }[];
}

/** Steps 3 and 4 always need a person to confirm; below this score the part is unmatched. */
export const FUZZY_MIN = 0.55;
export const CANDIDATE_MIN = 0.35;

export class DictionaryIndex {
  readonly entries: StdPart[];
  private byCode = new Map<string, StdPart>();
  private exact = new Map<string, StdPart[]>();
  private prepared: Prepared[] = [];
  private positions: Set<string>;

  constructor(entries: StdPart[]) {
    this.entries = entries;
    const posWords = new Set(BASE_POSITIONS);
    for (const e of entries) {
      this.byCode.set(e.stdCode, e);
      for (const p of e.positions) for (const t of tokens(normalizeName(p))) posWords.add(t);
      const forms = new Set<string>([normalizeName(e.name), ...e.mergedNames.map(normalizeName)]);
      if (e.level === 2 && e.l2) forms.add(normalizeName(e.l2));
      if (e.nameEn) forms.add(normalizeName(e.nameEn));
      const prepared: Prepared = { entry: e, role: e.defaultRole ?? inferRole(e.l2 ?? e.name, e.l1).role, forms: [] };
      for (const f of forms) {
        if (!f) continue;
        const list = this.exact.get(f) ?? [];
        list.push(e);
        this.exact.set(f, list);
        prepared.forms.push({ norm: f, toks: tokens(f), tri: trigrams(f) });
      }
      this.prepared.push(prepared);
    }
    // "corner", "footboard" etc. are positions in the dictionary but also real name words; keep only short positional vocabulary.
    for (const w of ['footboard', 'headboard', 'panjang', 'pendek', 'tegak', 'datar']) posWords.delete(w);
    this.positions = posWords;
  }

  get(code: string): StdPart | undefined {
    return this.byCode.get(code);
  }

  children(code: string): StdPart[] {
    return this.entries.filter((e) => e.parentCode === code);
  }

  categories(): { category: string; subCategories: string[] }[] {
    const m = new Map<string, Set<string>>();
    for (const e of this.entries) {
      const s = m.get(e.category) ?? new Set();
      s.add(e.subCategory);
      m.set(e.category, s);
    }
    return [...m].map(([category, subs]) => ({ category, subCategories: [...subs].sort() }));
  }

  private scope(e: StdPart, input: MatchInput): number {
    let s = 0.82;
    if (input.category && e.category === input.category) s = 0.93;
    if (input.subCategory && e.subCategory === input.subCategory && (!input.category || e.category === input.category)) s = 1;
    if (!input.category && !input.subCategory) s = 1;
    if (input.level && e.level !== input.level) s *= 0.95;
    return s;
  }

  /** Split trailing/leading position words: "skid panjang atas" → ("skid panjang", "Atas"). */
  splitPosition(norm: string): { name: string; position: string | null } {
    const t = tokens(norm);
    const pos: string[] = [];
    while (t.length > 1 && this.positions.has(t[t.length - 1])) pos.unshift(t.pop()!);
    return { name: t.join(' '), position: pos.length ? pos.map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') : null };
  }

  /** Name matching order (PRD §4): 1 exact code, 2 exact name / merged name (+ position), 3 fuzzy. Step 4 (AI) lives in @bom/ai. */
  match(input: MatchInput): MatchResult {
    const code = input.stdCode?.trim();
    if (code) {
      const e = this.byCode.get(code);
      if (e) return { status: 'code', stdCode: e.stdCode, entry: e, score: 1, candidates: [cand(e, 1, 'Std Code given')], position: input.position ?? null };
    }

    const raw = stripAssemblyPrefix(normalizeName(input.name));
    const { name: noNumbers } = splitVariantNumbers(raw);
    const variants = [...new Set([raw, noNumbers])].filter(Boolean);

    // 2. exact name or merged name, then with position words split off.
    for (const v of variants) {
      const direct = this.pickExact(v, input);
      if (direct) return { status: 'exact', stdCode: direct.stdCode, entry: direct, score: 1, candidates: [cand(direct, 1, 'exact name')], position: input.position ?? null };
      // Strip one trailing position word at a time ("dinding samping kiri" → "dinding samping" + Kiri).
      const t = tokens(v);
      const pos: string[] = [];
      while (t.length > 1 && this.positions.has(t[t.length - 1])) {
        pos.unshift(t.pop()!);
        const hit = this.pickExact(t.join(' '), input);
        if (hit) {
          const position = pos.map((p) => p[0].toUpperCase() + p.slice(1)).join(' ');
          return { status: 'exact', stdCode: hit.stdCode, entry: hit, score: 1, candidates: [cand(hit, 1, `exact name + position ${position}`)], position: input.position ?? position };
        }
      }
    }

    // 3. fuzzy
    const q = noNumbers || raw;
    const qt = tokens(q);
    const qtri = trigrams(q);
    const ctx = tokens(stripAssemblyPrefix(normalizeName(input.l1 ?? '')));
    const qRole = inferRole(input.name, input.l1).role;
    const scored: { e: StdPart; score: number; reason: string }[] = [];
    for (const p of this.prepared) {
      let best = 0;
      let bestForm = '';
      for (const f of p.forms) {
        const s = 0.65 * tokenSimilarity(qt, f.toks) + 0.35 * dice(qtri, f.tri);
        if (s > best) {
          best = s;
          bestForm = f.norm;
        }
      }
      if (best < 0.2) continue;
      // Assembly context: a component of "Rakitan Laci" leans towards "Laci" entries.
      if (ctx.length && ctx.some((t) => tokens(normalizeName(p.entry.name)).includes(t))) best = Math.min(1, best + 0.04);
      // Role consistency: same placement role is strong evidence, a different one weak counter-evidence.
      if (qRole && p.role) best = qRole === p.role ? Math.min(1, best + 0.08) : best - 0.04;
      const score = best * this.scope(p.entry, input);
      scored.push({ e: p.entry, score, reason: `fuzzy "${bestForm}"${p.entry.subCategory !== input.subCategory && input.subCategory ? ` (from ${p.entry.subCategory})` : ''}` });
    }
    scored.sort((a, b) => b.score - a.score || b.e.sgLines - a.e.sgLines);
    const seen = new Set<string>();
    const candidates: MatchCandidate[] = [];
    for (const s of scored) {
      if (seen.has(s.e.stdCode) || s.score < CANDIDATE_MIN) continue;
      seen.add(s.e.stdCode);
      candidates.push(cand(s.e, round3(s.score), s.reason));
      if (candidates.length === 3) break;
    }
    const top = candidates[0];
    const position = input.position ?? this.splitPosition(q).position;
    if (top && top.score >= FUZZY_MIN) {
      return { status: 'fuzzy', stdCode: top.stdCode, entry: this.byCode.get(top.stdCode)!, score: top.score, candidates, position };
    }
    return { status: 'unmatched', stdCode: null, entry: null, score: top?.score ?? 0, candidates, position };
  }

  private pickExact(norm: string, input: MatchInput): StdPart | null {
    const hits = this.exact.get(norm);
    if (!hits?.length) return null;
    const ranked = hits
      .map((e) => ({ e, s: this.scope(e, input) + (e.sgLines / 1e5) }))
      .sort((a, b) => b.s - a.s);
    const best = ranked[0];
    // Exact names in an unrelated category are only a candidate, not a match.
    if (input.category && best.e.category !== input.category) return null;
    return best.e;
  }

  /** Free-text search for the Add-part picker and the dictionary browser. */
  search(query: string, opts: { category?: string; subCategory?: string; level?: 1 | 2; limit?: number } = {}): { entry: StdPart; score: number }[] {
    const q = normalizeName(query);
    const limit = opts.limit ?? 25;
    const pool = this.prepared.filter(
      (p) => (!opts.category || p.entry.category === opts.category) && (!opts.subCategory || p.entry.subCategory === opts.subCategory) && (!opts.level || p.entry.level === opts.level),
    );
    if (!q) return pool.slice(0, limit).map((p) => ({ entry: p.entry, score: 1 }));
    const qt = tokens(q);
    const qtri = trigrams(q);
    const codeQ = query.trim().toUpperCase();
    return pool
      .map((p) => {
        if (p.entry.stdCode.startsWith(codeQ)) return { entry: p.entry, score: 2 };
        let best = 0;
        for (const f of p.forms) {
          const contains = f.norm.includes(q) ? 0.3 : 0;
          best = Math.max(best, 0.6 * tokenSimilarity(qt, f.toks) + 0.4 * dice(qtri, f.tri) + contains);
        }
        return { entry: p.entry, score: best };
      })
      .filter((r) => r.score > 0.3)
      .sort((a, b) => b.score - a.score || b.entry.sgLines - a.entry.sgLines)
      .slice(0, limit);
  }
}

function cand(e: StdPart, score: number, reason: string): MatchCandidate {
  return { stdCode: e.stdCode, name: e.name, score, reason };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
