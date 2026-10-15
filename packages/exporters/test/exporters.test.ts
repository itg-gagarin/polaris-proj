import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import { WebIO } from '@gltf-transform/core';
import DxfParser from 'dxf-parser';
import type { RevisionContent } from '@bom/domain';
import { analyze, type Layout } from '@bom/engine';
import { loadHollan } from '@bom/fixtures';
import { drawingSheetPdf, personalSheetPdf, glbExport, dxfExport, stepExport, project, sheetInstances, section, fitScale, filterForTeam } from '../src';

let content: RevisionContent;
let layout: Layout;
const info = { productCode: 'HH-CC-NIGHT-STAND', productName: 'Night Stand', revisionLabel: 'R5', revisionState: 'in_review', date: '2026-10-15' };

beforeAll(async () => {
  content = (await loadHollan()).find((p) => p.code === 'HH-CC-NIGHT-STAND')!.content;
  layout = analyze(content).layout;
});

describe('projections', () => {
  it('front view spans the product width and height', () => {
    const v = project(sheetInstances(layout, { hardware: false }), 'front');
    expect(v.bounds.x1 - v.bounds.x0).toBeCloseTo(711, 0);
    expect(v.bounds.y1 - v.bounds.y0).toBeCloseTo(702, 0);
    const side = project(sheetInstances(layout, { hardware: false }), 'side');
    expect(side.bounds.x1 - side.bounds.x0).toBeCloseTo(420, 0);
  });
  it('section cuts only parts crossing the plane', () => {
    const s = section(sheetInstances(layout), 'x', 355);
    expect(s.rects.length).toBeGreaterThan(5);
    expect(s.rects.every((r) => r.cut)).toBe(true);
  });
  it('picks standard scales', () => {
    expect(fitScale({ x0: 0, y0: 0, x1: 711, y1: 702 }, 180, 100)).toBe(10);
  });
});

describe('PDF sheets', () => {
  it('drawing sheet: views + title block + part list (2 pages)', async () => {
    const bytes = await drawingSheetPdf(content, layout, { ...info, reviews: [] }, { section: { axis: 'x', at: 355 } });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toBe('HH-CC-NIGHT-STAND rev R5');
  });
  it('personal spec sheet with a QR code per part, filtered by team', async () => {
    const bytes = await personalSheetPdf(content, layout, { ...info, person: 'Rina Kartika', team: 'hardware' });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(filterForTeam(content.parts, 'hardware').every((p) => p.kind === 'hardware')).toBe(true);
  });
});

describe('GLB', () => {
  it('is valid glTF 2.0 with one node per placed instance', async () => {
    const glb = glbExport(content, layout);
    const doc = await new WebIO().readBinary(glb);
    const nodes = doc.getRoot().listNodes();
    const placed = layout.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && !i.packing).length;
    expect(nodes.length).toBe(placed);
    expect(nodes[0].getExtras()).toHaveProperty('partId');
  });
});

describe('DXF', () => {
  it('parses with three view layers in millimetres', () => {
    const dxf = dxfExport(content, layout, { title: 'Night Stand R5' });
    const parsed = new DxfParser().parseSync(dxf)!;
    const layers = new Set(parsed.entities.map((e) => e.layer));
    expect([...layers].sort()).toEqual(['DIMENSIONS', 'FRONT', 'SIDE', 'TEXT', 'TOP']);
    expect(parsed.entities.filter((e) => e.type === 'LINE').length).toBeGreaterThan(300);
  });
});

describe('STEP (phase-6 feasibility spike)', () => {
  it('OpenCascade reads every exported solid', async () => {
    const step = stepExport(content, layout, { name: 'Night Stand', code: 'HH-CC-NIGHT-STAND' });
    const require = createRequire(import.meta.url);
    const occtFactory = require('occt-import-js');
    const occt = await occtFactory();
    const res = occt.ReadStepFile(new TextEncoder().encode(step), null);
    expect(res.success).toBe(true);
    const placed = layout.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && !i.packing).length;
    expect(res.meshes.length).toBe(placed);
    // A box imports as 12 triangles.
    expect(res.meshes[0].index.array.length).toBe(36);
  }, 60_000);
});
