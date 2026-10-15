/**
 * Size expressions, e.g. "=case.innerWidth/2 - 22.5 - 3" or "opening.width - 2*slideClearance".
 * A tiny recursive-descent parser — no eval, no globals.
 */

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'ref'; name: string }
  | { t: 'neg'; e: Ast }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Ast; b: Ast }
  | { t: 'call'; fn: string; args: Ast[] };

export class ExprError extends Error {}

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: (x, step = 1) => Math.round(x / step) * step,
  floor: (x, step = 1) => Math.floor(x / step) * step,
  ceil: (x, step = 1) => Math.ceil(x / step) * step,
};

export function isExpression(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.trim();
  return s.startsWith('=') || /[a-z_]/i.test(s);
}

export function parseExpr(src: string): Ast {
  const s = src.trim().replace(/^=/, '');
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const peek = () => {
    ws();
    return s[i];
  };
  const expr = (): Ast => {
    let a = term();
    for (;;) {
      const c = peek();
      if (c === '+' || c === '-') {
        i++;
        a = { t: 'bin', op: c, a, b: term() };
      } else return a;
    }
  };
  const term = (): Ast => {
    let a = factor();
    for (;;) {
      const c = peek();
      if (c === '*' || c === '/') {
        i++;
        a = { t: 'bin', op: c, a, b: factor() };
      } else return a;
    }
  };
  const factor = (): Ast => {
    const c = peek();
    if (c === '-') {
      i++;
      return { t: 'neg', e: factor() };
    }
    if (c === '+') {
      i++;
      return factor();
    }
    return primary();
  };
  const primary = (): Ast => {
    const c = peek();
    if (c === '(') {
      i++;
      const e = expr();
      if (peek() !== ')') throw new ExprError(`Expected ) at ${i}`);
      i++;
      return e;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)/.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return { t: 'num', v: Number(num[0]) };
    }
    const id = /^[a-z_][\w.]*/i.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      if (peek() === '(') {
        i++;
        const args: Ast[] = [];
        if (peek() !== ')') {
          args.push(expr());
          while (peek() === ',') {
            i++;
            args.push(expr());
          }
        }
        if (peek() !== ')') throw new ExprError(`Expected ) after arguments of ${id[0]}`);
        i++;
        if (!FUNCS[id[0].toLowerCase()]) throw new ExprError(`Unknown function ${id[0]}`);
        return { t: 'call', fn: id[0].toLowerCase(), args };
      }
      return { t: 'ref', name: id[0] };
    }
    throw new ExprError(c === undefined ? 'Unexpected end of expression' : `Unexpected "${c}" at ${i}`);
  };
  const ast = expr();
  if (peek() !== undefined) throw new ExprError(`Unexpected "${s[i]}" at ${i}`);
  return ast;
}

export function refsOf(ast: Ast, out = new Set<string>()): Set<string> {
  switch (ast.t) {
    case 'ref':
      out.add(ast.name);
      break;
    case 'neg':
      refsOf(ast.e, out);
      break;
    case 'bin':
      refsOf(ast.a, out);
      refsOf(ast.b, out);
      break;
    case 'call':
      ast.args.forEach((a) => refsOf(a, out));
      break;
  }
  return out;
}

export function evalAst(ast: Ast, lookup: (name: string) => number | undefined): number {
  switch (ast.t) {
    case 'num':
      return ast.v;
    case 'ref': {
      const v = lookup(ast.name);
      if (v === undefined || !Number.isFinite(v)) throw new ExprError(`Unknown name "${ast.name}"`);
      return v;
    }
    case 'neg':
      return -evalAst(ast.e, lookup);
    case 'bin': {
      const a = evalAst(ast.a, lookup);
      const b = evalAst(ast.b, lookup);
      if (ast.op === '/' && b === 0) throw new ExprError('Division by zero');
      return ast.op === '+' ? a + b : ast.op === '-' ? a - b : ast.op === '*' ? a * b : a / b;
    }
    case 'call':
      return FUNCS[ast.fn](...ast.args.map((a) => evalAst(a, lookup)));
  }
}

export function evaluate(src: string, scope: Record<string, number> | ((name: string) => number | undefined)): number {
  const lookup = typeof scope === 'function' ? scope : (n: string) => scope[n];
  return evalAst(parseExpr(src), lookup);
}

/**
 * Resolve a set of named expressions that may reference each other.
 * Returns values and errors (including cycles) per name.
 */
export function resolveAll(
  exprs: Record<string, string>,
  base: Record<string, number>,
): { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = { ...base };
  const errors: Record<string, string> = {};
  const asts: Record<string, Ast> = {};
  for (const [k, e] of Object.entries(exprs)) {
    try {
      asts[k] = parseExpr(e);
    } catch (err) {
      errors[k] = (err as Error).message;
    }
  }
  const state: Record<string, 0 | 1 | 2> = {};
  const visit = (k: string, stack: string[]): number | undefined => {
    if (!(k in asts)) return values[k];
    if (state[k] === 2) return values[k];
    if (state[k] === 1) {
      const cycle = [...stack.slice(stack.indexOf(k)), k].join(' → ');
      for (const n of stack.slice(stack.indexOf(k))) errors[n] = `Circular reference: ${cycle}`;
      return undefined;
    }
    state[k] = 1;
    try {
      const v = evalAst(asts[k], (n) => (n === k ? undefined : visit(n, [...stack, k])));
      if (!errors[k]) values[k] = v;
    } catch (err) {
      if (!errors[k]) errors[k] = (err as Error).message;
    }
    state[k] = 2;
    return errors[k] ? undefined : values[k];
  };
  for (const k of Object.keys(asts)) visit(k, []);
  return { values, errors };
}
