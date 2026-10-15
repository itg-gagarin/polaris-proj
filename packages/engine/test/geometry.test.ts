import { describe, it, expect } from 'vitest';
import { BoxTree, intersectBoxes, obbFrom, obbPenetration, obbToAabb, worldSize, v3, type Box } from '../src';

describe('geometry', () => {
  it('maps cut size to world axes', () => {
    expect(worldSize({ T: 18, W: 380, L: 600 }, { T: 'x', W: 'z', L: 'y' })).toEqual({ x: 18, y: 600, z: 380 });
  });
  it('finds overlapping pairs with the box tree, same as brute force', () => {
    const boxes: Box[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
      const min = v3(rnd() * 2000, rnd() * 1000, rnd() * 600);
      boxes.push({ min, max: v3(min.x + 20 + rnd() * 200, min.y + 20 + rnd() * 100, min.z + 20 + rnd() * 100) });
    }
    const tree = new BoxTree(boxes).pairs(0.05).map(([a, b]) => `${a}-${b}`).sort();
    const brute: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const h = intersectBoxes(boxes[i], boxes[j]);
      if (h && Math.min(h.box.max.x - h.box.min.x, h.box.max.y - h.box.min.y, h.box.max.z - h.box.min.z) > 0.05) brute.push(`${i}-${j}`);
    }
    expect(tree).toEqual(brute.sort());
  });
  it('separating-axis test handles rotated boxes', () => {
    const a = obbFrom(v3(0, 0, 0), v3(100, 10, 10), v3(0, 0, 0));
    const b = obbFrom(v3(0, 0, 0), v3(100, 10, 10), v3(0, 45, 0));
    expect(obbPenetration(a, b)).toBeGreaterThan(0);
    const far = obbFrom(v3(0, 0, 100), v3(100, 10, 10), v3(0, 45, 0));
    expect(obbPenetration(a, far)).toBe(0);
    const aabb = obbToAabb(obbFrom(v3(0, 0, 0), v3(100, 10, 10), v3(0, 90, 0)));
    expect(aabb.max.z).toBeCloseTo(50);
    expect(aabb.max.x).toBeCloseTo(5);
  });
});
