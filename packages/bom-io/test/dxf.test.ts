import { describe, it, expect } from 'vitest';
import { parseDxf, DxfError } from '../src/dxf';

/** Build an ASCII DXF from [code, value] pairs. */
const dxf = (pairs: (string | number)[][]) => pairs.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
const header = (units: number) => [[0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, units], [0, 'ENDSEC']];
const file = (units: number, ents: (string | number)[][], blocks: (string | number)[][] = []) =>
  dxf([...header(units), [0, 'SECTION'], [2, 'BLOCKS'], ...blocks, [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES'], ...ents, [0, 'ENDSEC'], [0, 'EOF']]);

describe('DXF reader (AutoCAD detail drawings)', () => {
  it('reads a knob drawing in mm: profile lines, a Ø30 circle and a label', () => {
    const d = parseDxf(file(4, [
      [0, 'LINE'], [8, 'OUTLINE'], [10, 0], [20, 0], [11, 25], [21, 0],
      [0, 'CIRCLE'], [8, 'OUTLINE'], [10, 60], [20, 15], [40, 15],
      [0, 'TEXT'], [8, 'TEXT'], [10, 0], [20, 40], [40, 3.5], [1, 'KNOP Ø30'],
    ]));
    expect(d.units).toBe('mm');
    expect(d.shapes).toHaveLength(3);
    expect(d.shapes[1]).toEqual({ kind: 'circle', c: { x: 60, y: 15 }, r: 15, layer: 'OUTLINE' });
    expect(d.bounds).toEqual({ x0: 0, y0: 0, x1: 75, y1: 43.5 });
    expect(d.layers.sort()).toEqual(['OUTLINE', 'TEXT']);
  });

  it('converts inches to mm', () => {
    const d = parseDxf(file(1, [[0, 'LINE'], [10, 0], [20, 0], [11, 1], [21, 0]]));
    expect(d.shapes[0]).toMatchObject({ kind: 'line', b: { x: 25.4, y: 0 } });
    expect(d.unitScale).toBe(25.4);
  });

  it('turns a polyline bulge into an arc (a half circle of radius 10 bulges 10 mm out)', () => {
    const d = parseDxf(file(4, [[0, 'LWPOLYLINE'], [90, 2], [70, 0], [10, 0], [20, 0], [42, 1], [10, 20], [20, 0]]));
    const pts = (d.shapes[0] as { pts: { x: number; y: number }[] }).pts;
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 20, y: 0 });
    for (const p of pts) expect(Math.hypot(p.x - 10, p.y)).toBeCloseTo(10, 6);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(-10, 0);
  });

  it('expands a block inserted twice, scaled and rotated', () => {
    const blocks = [[0, 'BLOCK'], [2, 'HOLE'], [10, 0], [20, 0], [0, 'LINE'], [10, 0], [20, 0], [11, 10], [21, 0], [0, 'ENDBLK']];
    const d = parseDxf(file(4, [
      [0, 'INSERT'], [2, 'HOLE'], [10, 100], [20, 0],
      [0, 'INSERT'], [2, 'HOLE'], [10, 0], [20, 0], [41, 2], [42, 2], [50, 90],
    ], blocks));
    expect(d.shapes).toHaveLength(2);
    expect(d.shapes[0]).toMatchObject({ a: { x: 100, y: 0 }, b: { x: 110, y: 0 } });
    const b = (d.shapes[1] as { b: { x: number; y: number } }).b;
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(20, 6);
  });

  it('refuses DWG and files that are not DXF, with a plain message', () => {
    expect(() => parseDxf('AC1032 binary…')).toThrow(DxfError);
    expect(() => parseDxf('hello\nworld\n')).toThrow(/Not a DXF/);
    expect(() => parseDxf(file(4, [[0, 'HATCH']]))).toThrow(/no lines/);
  });
});
