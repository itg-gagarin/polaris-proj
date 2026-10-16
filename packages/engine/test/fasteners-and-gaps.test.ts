import { describe, it, expect, beforeAll } from 'vitest';
import { DEFAULT_SETTINGS, applyPatch, makePatch } from '@bom/domain';
import { loadHollan, type FixtureProduct } from '@bom/fixtures';
import { analyze, planFasteners, classifyFastener, dimOnAxis } from '../src';

let products: FixtureProduct[];
const plan = (code: string) => {
  const a = analyze(products.find((p) => p.code === code)!.content, DEFAULT_SETTINGS, { requireConfirmed: true });
  return { a, plan: planFasteners(a.content, a.layout) };
};
const line = (r: ReturnType<typeof plan>, name: string) => r.plan.lines.find((l) => r.a.content.parts.find((p) => p.id === l.partId)!.originalName.trim() === name)!;

beforeAll(async () => {
  products = await loadHollan();
});

describe('fasteners (positions suggested from the template, quantities from the BOM)', () => {
  it('classifies the Hollan fastener names', () => {
    expect(classifyFastener('sekrup')).toBe('screw');
    expect(classifyFastener('mur nanas')).toBe('insertNut');
    expect(classifyFastener('t nut')).toBe('tNut');
    expect(classifyFastener('hanger bolt')).toBe('hangerBolt');
    expect(classifyFastener('baut JCBC')).toBe('connectorBolt');
    expect(classifyFastener('mur payung')).toBe('capNut');
    expect(classifyFastener('kunci L')).toBe('tool');
  });

  it('Night Stand: 4 mur nanas sit on top of the 4 glides; all 60 screws get a place', () => {
    const r = plan('HH-CC-NIGHT-STAND');
    const nuts = r.plan.marks.filter((m) => m.kind === 'insertNut');
    expect(nuts).toHaveLength(4);
    const glides = r.a.layout.instances.filter((i) => i.role === 'glide');
    expect(glides).toHaveLength(4);
    for (const n of nuts) expect(glides.some((g) => Math.abs(g.max.y - n.at.y) < 1e-6 && n.at.x > g.min.x && n.at.x < g.max.x)).toBe(true);
    expect(line(r, 'sekrup')).toMatchObject({ qty: 60, shown: 60, note: null });
    // Every kind of screw site gets some: blocks, runners, slides, drawer fronts.
    const sites = new Set(r.plan.marks.filter((m) => m.kind === 'screw').map((m) => m.site));
    for (const s of ['block', 'runner', 'slide', 'drawerFront'] as const) expect(sites.has(s), s).toBe(true);
  });

  it('every mark lies on or inside the model bounds', () => {
    const r = plan('HH-CC-DRAWER-DRESSER');
    const b = r.a.layout.bounds;
    for (const m of r.plan.marks) for (const k of ['x', 'y', 'z'] as const) {
      expect(m.at[k], `${m.key} ${k}`).toBeGreaterThanOrEqual(b.min[k] - 1);
      expect(m.at[k], `${m.key} ${k}`).toBeLessThanOrEqual(b.max[k] + 1);
    }
    expect(line(r, 'hanger bolt')).toMatchObject({ qty: 1, shown: 1 });
  });

  it('Queen headboard: the Allen key is loose in the bag; bolts beyond the places are counted, not dropped', () => {
    const r = plan('HH-CC-QUEEN-PANEL-BED-HB');
    expect(line(r, 'kunci L')).toMatchObject({ kind: 'tool', qty: 1, shown: 0, note: 'loose in the hardware bag' });
    const jcbc = line(r, 'baut JCBC');
    expect(jcbc.qty).toBe(14);
    expect(jcbc.shown).toBeGreaterThan(0);
    expect(jcbc.shown + Number(/^(\d+)/.exec(jcbc.note ?? '0')?.[1] ?? 0)).toBe(14);
  });

  it('side rails delivered alone: threaded rods and nuts go to the rail ends', () => {
    const r = plan('HH-CC-QUEEN-KING-PANEL-SIDE-RAIL');
    const rods = r.plan.marks.filter((m) => m.kind === 'connectorBolt');
    expect(rods).toHaveLength(8);
    const rails = r.a.layout.instances.filter((i) => i.role === 'bedRail');
    for (const m of rods) expect(rails.some((x) => Math.abs(x.min[m.axis] - m.at[m.axis]) < 1e-6 || Math.abs(x.max[m.axis] - m.at[m.axis]) < 1e-6)).toBe(true);
  });

  it('is deterministic', () => {
    expect(plan('HH-CC-DRAWER-CHEST').plan).toEqual(plan('HH-CC-DRAWER-CHEST').plan);
  });
});

describe('face-frame-gap check', () => {
  it('Night Stand: the 489 mm top and bottom profiles leave 41 mm at each end of the 571 mm between the legs', () => {
    const r = plan('HH-CC-NIGHT-STAND');
    const f = r.a.findings.filter((x) => x.ruleId === 'face-frame-gap');
    expect(f.map((x) => r.a.content.parts.find((p) => p.id === x.partIds[0])!.originalName.trim()).sort()).toEqual(['frame depan datar bawah', 'frame profil datar atas - bwh']);
    for (const x of f) {
      expect(x).toMatchObject({ severity: 'warn', confidence: 'medium', ownerTeam: 'engineering', fix: null });
      expect(x.numbers).toMatchObject({ length: 489, opening: 571, gap: 41 });
    }
  });

  it('no finding once the profile spans the legs (the threshold comes from settings)', () => {
    const p = products.find((x) => x.code === 'HH-CC-NIGHT-STAND')!.content;
    const prof = p.parts.filter((x) => x.role === 'frontProfile' || x.role === 'frontRailBottom');
    const patched = prof.reduce((c, x) => applyPatch(c, makePatch([{ op: 'setDim', partId: x.id, dim: dimOnAxis(x.axisMap, 'x'), value: 571 }], 'span')).content, p);
    const a = analyze(patched, DEFAULT_SETTINGS, { requireConfirmed: true });
    expect(a.findings.filter((x) => x.ruleId === 'face-frame-gap')).toEqual([]);
    const loose = analyze(p, { ...DEFAULT_SETTINGS, thresholds: { ...DEFAULT_SETTINGS.thresholds, fitTolerance: 45 } }, { requireConfirmed: true });
    expect(loose.findings.filter((x) => x.ruleId === 'face-frame-gap')).toEqual([]);
  });
});

describe('knobs, pulls and the drawer-pull check', () => {
  const pullsBySlot = (code: string) => {
    const a = analyze(products.find((p) => p.code === code)!.content, DEFAULT_SETTINGS, { requireConfirmed: true });
    return { a, by: a.layout.rows.flatMap((r) => r.slots).map((s) => ({ w: Math.round(s.cell.x1 - s.cell.x0), roles: a.layout.instances.filter((i) => (i.role === 'knob' || i.role === 'handle') && i.group === `${s.assemblyId}#${s.asmInstance}`).map((i) => i.role) })) };
  };
  it('Drawer Chest: the 2 knobs go on the two 361 mm drawers, the 4 pulls on the four 766 mm drawers', () => {
    const { a, by } = pullsBySlot('HH-CC-DRAWER-CHEST');
    expect(by.filter((x) => x.w === 361).map((x) => x.roles)).toEqual([['knob'], ['knob']]);
    expect(by.filter((x) => x.w === 766).map((x) => x.roles)).toEqual([['handle'], ['handle'], ['handle'], ['handle']]);
    expect(a.findings.some((f) => f.ruleId === 'drawer-pull')).toBe(false);
  });
  it('Drawer Dresser: 6 knobs/pulls for 8 drawers leaves 2 drawers bare, reported with the numbers', () => {
    const { a } = pullsBySlot('HH-CC-DRAWER-DRESSER');
    const f = a.findings.find((x) => x.ruleId === 'drawer-pull')!;
    expect(f).toMatchObject({ severity: 'warn', confidence: 'medium', ownerTeam: 'hardware' });
    expect(f.numbers).toEqual({ drawers: 8, handles: 6, without: 2 });
  });
});
