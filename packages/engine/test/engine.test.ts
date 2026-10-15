import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import type { RevisionContent, Part } from '@bom/domain';
import { applyPatch, makePatch, DEFAULT_SETTINGS } from '@bom/domain';
import { loadHollan, loadSets, goldenOf, fixturePath, type FixtureProduct, type FixtureSet } from '@bom/fixtures';
import { analyze, optimize, diffRevisions, prepareContent, worldSize, dimOnAxis } from '../src';

let products: FixtureProduct[];
let sets: FixtureSet[];
const get = (code: string) => products.find((p) => p.code === code)!.content;
const set = (code: string) => sets.find((s) => s.code === code)!.content;
const part = (c: RevisionContent, name: string) => c.parts.find((p) => p.originalName === name)!;
const setAxis = (c: RevisionContent, p: Part, axis: 'x' | 'y' | 'z', v: number) => applyPatch(c, makePatch([{ op: 'setDim', partId: p.id, dim: dimOnAxis(p.axisMap, axis), value: v }], 'seed')).content;

beforeAll(async () => {
  products = await loadHollan();
  sets = await loadSets();
});

describe('golden results (fixtures/expected)', () => {
  it('every fixture product matches its golden file', async () => {
    for (const p of [...products, ...sets]) {
      const a = analyze(p.content, DEFAULT_SETTINGS, { requireConfirmed: true });
      const expected = JSON.parse(readFileSync(fixturePath('expected', `${p.code}.json`), 'utf8'));
      expect(goldenOf(a), p.code).toEqual(expected);
    }
  });
});

describe('phase-1 gate', () => {
  it('every product and bed set places all parts once matches are confirmed (zero unplaced)', () => {
    for (const p of [...products, ...sets]) {
      const a = analyze(p.content, DEFAULT_SETTINGS, { requireConfirmed: true });
      expect(a.summary.unplaced, p.code).toBe(0);
    }
  });

  it('unconfirmed fuzzy matches go to the Unplaced tray (PRD §4)', () => {
    const c = get('HH-CC-NIGHT-STAND');
    const p = c.parts.find((x) => x.role === 'drawerFront')!;
    const fuzzy = applyPatch(c, makePatch([{ op: 'setField', partId: p.id, field: 'match', value: { status: 'fuzzy', score: 0.7, candidates: [] } }], 'x')).content;
    const a = analyze(fuzzy, DEFAULT_SETTINGS, { requireConfirmed: true });
    expect(a.layout.unplaced.find((u) => u.partId === p.id)?.reason).toMatch(/not confirmed/);
  });

  it('infers drawer rows that agree with the runner counts on the BOM', () => {
    const rows = (code: string) => analyze(get(code)).layout.rows.map((r) => r.perRow);
    expect(rows('HH-CC-NIGHT-STAND')).toEqual([1, 1]);
    expect(rows('HH-CC-DRAWER-CHEST')).toEqual([2, 1, 1, 1, 1]);
    expect(rows('HH-CC-DRAWER-DRESSER')).toEqual([4, 2, 2]);
    for (const code of ['HH-CC-NIGHT-STAND', 'HH-CC-DRAWER-CHEST', 'HH-CC-DRAWER-DRESSER']) {
      const req = analyze(get(code)).layout.requirements.filter((r) => r.role === 'runner' || r.role === 'midRunner');
      for (const r of req) expect(r.have, `${code} ${r.role}`).toBe(r.required);
    }
  });

  it('auto-orients the dresser back panel whose W/L are swapped on the sheet', () => {
    const back = get('HH-CC-DRAWER-DRESSER').parts.find((p) => p.role === 'back')!;
    expect(worldSize(back.dims, back.axisMap).x).toBe(1555);
  });

  it('the parts give the header height (case goods: legs + top within 2 mm)', () => {
    for (const code of ['HH-CC-NIGHT-STAND', 'HH-CC-DRAWER-CHEST', 'HH-CC-DRAWER-DRESSER']) {
      expect(analyze(get(code)).findings.filter((f) => f.ruleId === 'overall-dimensions'), code).toEqual([]);
    }
  });
});

describe('seeded issues (PRD §13 phase-1 gate)', () => {
  it('Drawer Dresser fronts at 590 mm fail the front-width check', () => {
    const c = get('HH-CC-DRAWER-DRESSER');
    const seeded = setAxis(c, part(c, 'panel muka laci bawah'), 'x', 590);
    const f = analyze(seeded).findings.find((x) => x.ruleId === 'front-width' && x.numbers.front === 590);
    expect(f).toBeDefined();
    expect(f!.severity).toBe('fail');
    expect(f!.confidence).toBe('medium');
    expect(f!.message).toMatch(/590 mm in 716 mm openings/);
  });

  it('Queen bed slats at 1550 mm with no ledger fail the slat check', () => {
    let c = set('HH-CC-QUEEN-PANEL-BED');
    for (const s of c.parts.filter((p) => p.role === 'slat')) c = setAxis(c, s, 'x', 1550);
    c = applyPatch(c, makePatch(c.parts.filter((p) => p.role === 'slatLedger').map((p) => ({ op: 'removePart' as const, partId: p.id })), 'seed: no ledger')).content;
    const slat = analyze(c).findings.filter((x) => x.ruleId === 'bed-slats' && x.severity === 'fail');
    expect(slat.map((f) => f.message).join(' ')).toMatch(/no ledger/);
  });

  it('a too-wide drawer box hits the runners (moving vs carcass clash)', () => {
    const c = get('HH-CC-NIGHT-STAND');
    const fb = c.parts.find((p) => p.role === 'drawerBoxFrontBack')!;
    const a = analyze(setAxis(c, fb, 'x', 470));
    expect(a.findings.some((f) => f.ruleId === 'clash' && /hits/.test(f.message))).toBe(true);
    expect(a.findings.some((f) => f.ruleId === 'drawer-box-vs-slide' && f.numbers.box === 470)).toBe(true);
  });

  it('a declared joint stops intended overlap counting as a clash, growth beyond it does', () => {
    const c = get('HH-CC-NIGHT-STAND');
    expect(c.joints.length).toBeGreaterThan(0);
    const before = analyze(c).findings.filter((f) => f.ruleId === 'clash').length;
    const j = c.joints[0];
    const shrunk = { ...c, joints: c.joints.map((x) => (x.id === j.id ? { ...x, allowedOverlapMm: 0 } : x)) };
    expect(analyze(shrunk).findings.filter((f) => f.ruleId === 'clash').length).toBeGreaterThan(before);
  });
});

describe('optimize (deterministic fixes, up to 4 passes)', () => {
  it('clears every rule-fixable failure on the dresser and leaves people-only findings', () => {
    const r = optimize(get('HH-CC-DRAWER-DRESSER'));
    expect(r.before.summary.fail).toBeGreaterThan(10);
    expect(r.after.findings.filter((f) => f.severity === 'fail').map((f) => f.ruleId)).toEqual(['finish-coverage']);
    expect(r.passes).toBeLessThanOrEqual(4);
    expect(r.patches.every((p) => p.source === 'rule' && p.ruleId && p.reason)).toBe(true);
  });
  it('never touches locked parts', () => {
    const c = get('HH-CC-DRAWER-DRESSER');
    const front = c.parts.find((p) => p.originalName === 'panel muka laci atas')!;
    const locked = applyPatch(c, makePatch([{ op: 'setField', partId: front.id, field: 'locked', value: true }], 'lock')).content;
    const r = optimize(locked);
    expect(r.patches.some((p) => p.ops.some((o) => 'partId' in o && o.partId === front.id))).toBe(false);
    expect(r.skipped.some((s) => s.reason.includes('locked'))).toBe(true);
  });
});

describe('waivers and diff', () => {
  it('a waived finding stays visible, marked waived', () => {
    const c = get('HH-CC-DRAWER-DRESSER');
    const f = analyze(c).findings.find((x) => x.ruleId === 'finish-coverage')!;
    const waived = applyPatch(c, makePatch([{ op: 'setWaiver', findingKey: f.key, waiver: { findingKey: f.key, kind: 'accepted-risk', reason: 'side profile is raw by design', by: 'u1', at: '2026-10-15' } }], 'waive')).content;
    const a = analyze(waived);
    expect(a.findings.find((x) => x.key === f.key)?.waived?.reason).toMatch(/raw by design/);
    expect(a.summary.waived).toBe(1);
  });
  it('diffs two revisions and names the teams whose scope changed', () => {
    const a = get('HH-CC-NIGHT-STAND');
    const b = get('HH-CC-NIGHT-STAND-2');
    const d = diffRevisions(a, b);
    expect(d.changed.length).toBeGreaterThan(5); // PB E2 → PB E1, finish codes
    expect(d.changed.some((c) => c.changes.some((x) => x.field === 'material' && x.after === 'PARTICLE BOARD E1'))).toBe(true);
    expect(d.teams.length).toBeGreaterThan(0);
  });
});

describe('performance budget (PRD §7, §12)', () => {
  it('runs layout + clash + every check under 200 ms for a ~340-instance dresser', () => {
    const c = get('HH-CC-DRAWER-DRESSER');
    analyze(c); // warm up
    const t = performance.now();
    const a = analyze(c);
    const ms = performance.now() - t;
    expect(a.summary.instances).toBeGreaterThan(300);
    expect(ms).toBeLessThan(200);
  });
  it('prepare is idempotent', () => {
    const c = get('HH-CC-NIGHT-STAND');
    expect(prepareContent(c).joints).toEqual(c.joints);
  });
});
