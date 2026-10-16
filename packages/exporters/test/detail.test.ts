import { describe, it, expect, beforeAll } from 'vitest';
import { DEFAULT_SETTINGS } from '@bom/domain';
import { analyze } from '@bom/engine';
import { loadHollan, type FixtureProduct } from '@bom/fixtures';
import { partDetail, assemblySheet } from '../src/detail';

let products: FixtureProduct[];
beforeAll(async () => {
  products = await loadHollan();
});
const nightStand = () => analyze(products.find((p) => p.code === 'HH-CC-NIGHT-STAND')!.content, DEFAULT_SETTINGS, { requireConfirmed: true });
const byName = (a: ReturnType<typeof nightStand>, n: string) => a.content.parts.find((p) => p.originalName.trim() === n)!;

describe('detail drawings', () => {
  it('Night Stand top front profile: front face, 489 × 55 mm cut size, corners meet the front legs', () => {
    const a = nightStand();
    const prof = byName(a, 'frame profil datar atas - bwh');
    const d = partDetail(a.layout, a.content, prof.id)!;
    expect(d.faceView).toBe('front');
    const front = d.views.find((v) => v.view === 'front')!.rect;
    expect([front.x1 - front.x0, front.y1 - front.y0]).toEqual([489, 55]);
    expect(d.stretched).toBe(41);
    const leg = byName(a, 'frame kaki depan');
    // Corner A (top-left) and D (bottom-left) both show the left front leg next to the profile.
    for (const label of ['A', 'D'] as const) expect(d.corners.find((c) => c.label === label)!.neighbours).toContain(leg.id);
    // The focus part is drawn in every corner, clipped to the window.
    for (const c of d.corners) {
      const f = c.rects.find((r) => r.focus)!;
      expect(f.x0).toBeGreaterThanOrEqual(c.window.x0);
      expect(f.x1).toBeLessThanOrEqual(c.window.x1);
    }
    expect(d.joints.map((j) => j.partId)).toContain(leg.id);
  });

  it('drawer assembly sheet: one drawer of two, numbered parts with per-drawer quantities', () => {
    const a = nightStand();
    const drawer = a.content.assemblies.find((x) => x.role === 'drawer')!;
    const s = assemblySheet(a.layout, a.content, drawer.id)!;
    expect(s.count).toBe(drawer.qty);
    expect(s.items.map((i) => i.no)).toEqual(s.items.map((_, n) => n + 1));
    const front = s.items.find((i) => a.content.parts.find((p) => p.id === i.partId)!.role === 'drawerFront')!;
    expect(front.qty).toBe(1);
    expect(s.balloons).toHaveLength(s.items.length);
    expect(s.views.map((v) => v.view)).toEqual(['front', 'side', 'top']);
  });

  it('returns null for a part that is not drawn (a screw line)', () => {
    const a = nightStand();
    expect(partDetail(a.layout, a.content, byName(a, 'sekrup').id)).toBeNull();
  });
});

describe('detail views use the cut size', () => {
  it('Chest top front profile: drawn 876 mm leg to leg, the detail shows the 794 mm cut length', () => {
    const a = analyze(products.find((p) => p.code === 'HH-CC-DRAWER-CHEST')!.content, DEFAULT_SETTINGS, { requireConfirmed: true });
    const prof = a.content.parts.find((p) => p.originalName.trim() === 'frame profil datar atas - bwh')!;
    const d = partDetail(a.layout, a.content, prof.id)!;
    const front = d.views.find((v) => v.view === 'front')!.rect;
    expect(front.x1 - front.x0).toBe(794);
    expect(d.stretched).toBe(41);
  });
});
