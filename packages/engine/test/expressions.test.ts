import { describe, it, expect } from 'vitest';
import { evaluate, parseExpr, resolveAll, refsOf, ExprError } from '../src';

describe('expressions', () => {
  it('evaluates arithmetic with precedence, unary minus and functions', () => {
    expect(evaluate('=case.innerWidth/2 - 22.5 - 3', { 'case.innerWidth': 531 })).toBe(240);
    expect(evaluate('opening.width - 2*slideClearance', { 'opening.width': 461, slideClearance: 12.7 })).toBeCloseTo(435.6);
    expect(evaluate('-(2+3)*4', {})).toBe(-20);
    expect(evaluate('max(10, min(4, 7)) + round(12.26, 0.5)', {})).toBe(22.5);
  });
  it('lists references', () => {
    expect([...refsOf(parseExpr('a.b + c*(d - 1)'))]).toEqual(['a.b', 'c', 'd']);
  });
  it('rejects bad input without eval', () => {
    expect(() => evaluate('process.exit()', {})).toThrow(ExprError);
    expect(() => evaluate('1 +', {})).toThrow(ExprError);
    expect(() => evaluate('x', {})).toThrow(/Unknown name/);
    expect(() => evaluate('1/0', {})).toThrow(/Division/);
  });
  it('resolves dependencies and reports cycles', () => {
    const r = resolveAll({ a: 'b + 1', b: 'c * 2', x: 'y', y: 'x' }, { c: 5 });
    expect(r.values.a).toBe(11);
    expect(r.errors.x).toMatch(/Circular/);
    expect(r.errors.y).toMatch(/Circular/);
  });
});
