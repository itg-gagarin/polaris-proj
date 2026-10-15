import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbook, readCsv, type WorkbookGrid, type CellValue } from '@bom/sheets';
import { applyPatch } from '@bom/domain';
import type { DictionaryIndex } from '@bom/dictionary';
import { loadDictionary, loadHollan, privateHollanPath, fixturePath } from '@bom/fixtures';
import {
  importGrid, importFile, parseLegacySheet, extractSku, confirmAllPatch, confirmMatchPatch, matchSummary, isMatchSettled,
  exportBomWorkbook, materialTakeOff, cutListRows,
} from '../src';

let dict: DictionaryIndex;
beforeAll(async () => {
  dict = (await loadDictionary()).index;
});

/** A small "MATERIAL BREAKDOWN FORM" sheet laid out like the factory costing sheets (cost columns filled with junk). */
function legacySheet(): WorkbookGrid {
  const rows: CellValue[][] = Array.from({ length: 60 }, () => Array(40).fill(null));
  const set = (r: number, c: string, v: CellValue) => {
    const col = c.split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    rows[r - 1][col] = v;
  };
  set(1, 'D', 'MATERIAL BREAKDOWN FORM');
  set(1, 'Q', 'Note');
  set(1, 'S', 'Rev. 2 (test)');
  set(2, 'D', 'Buyer'); set(2, 'F', ';'); set(2, 'G', 'TEST BUYER');
  set(4, 'D', 'Series'); set(4, 'G', 'TEST SERIES');
  set(5, 'D', 'DESCRIPTION'); set(5, 'G', 'NIGHT STAND');
  set(5, 'Q', 'SET UP'); set(5, 'V', 'FULL EXT SIDE MOUNTED');
  set(6, 'D', 'PRODUCT SIZE'); set(6, 'G', 600); set(6, 'J', 400); set(6, 'N', 650); set(6, 'P', 'mm');
  set(8, 'D', 'PACKING SIZE box 1'); set(8, 'G', 700); set(8, 'J', 500); set(8, 'N', 760);
  set(16, 'A', 'NO'); set(16, 'B', 'ASSEMBLY / COMPONENT'); set(16, 'D', 'SIZE (mm)'); set(16, 'G', 'QTY'); set(16, 'H', 'WOOD'); set(16, 'I', ' M / P / Y /L'); set(16, 'K', 'COST / SHEET'); set(16, 'V', 'FINISHING');
  set(17, 'D', 'T'); set(17, 'E', 'L'); set(17, 'F', 'P'); set(17, 'V', 'TYPE'); set(17, 'X', 'COST / M²');
  set(18, 'B', 'RAKITAN PANEL TOP'); set(18, 'D', 73); set(18, 'E', 400); set(18, 'F', 600); set(18, 'G', 1);
  set(19, 'B', 'panel top '); set(19, 'D', 9); set(19, 'E', 410); set(19, 'F', 610); set(19, 'G', 1); set(19, 'I', 'p'); set(19, 'K', 999.5); set(19, 'V', 'cd'); set(19, 'AC', 'AMBIL SISA POTONGAN');
  // blank row closes the group
  set(21, 'B', 'frame depan datar bawah'); set(21, 'D', 18); set(21, 'E', 45); set(21, 'F', 400); set(21, 'G', 1); set(21, 'H', 'm');
  set(23, 'B', 'RAKITAN LACI'); set(23, 'D', 200); set(23, 'E', 300); set(23, 'F', 400); set(23, 'G', 2);
  set(24, 'B', 'panel muka laci'); set(24, 'D', 15); set(24, 'E', 200); set(24, 'F', 420); set(24, 'G', 2); set(24, 'I', 'p'); set(24, 'V', 'cd');
  set(25, 'B', 'papan samp laci'); set(25, 'D', 12); set(25, 'E', 180); set(25, 'F', 300); set(25, 'G', 4); set(25, 'I', 'l');
  set(40, 'B', 'VENEER'); set(41, 'D', 'T'); set(41, 'E', 'L'); set(41, 'F', 'P'); set(41, 'G', 'SIDE'); set(41, 'M', 'SIDE');
  set(42, 'B', 'panel top '); set(42, 'D', 0.6); set(42, 'E', 430); set(42, 'F', 630); set(42, 'G', 1); set(42, 'M', 1);
  set(45, 'B', 'PACKING'); set(46, 'D', 'P'); set(46, 'E', 'L'); set(46, 'F', 'T');
  set(47, 'B', 'CARTON FA'); set(47, 'D', 700); set(47, 'E', 500); set(47, 'F', 760); set(47, 'G', 1);
  set(48, 'B', 'STYROFOAM'); set(48, 'G', 0);
  set(50, 'B', 'ADDED COST ( HW  / JASA / OTHERS )'); set(51, 'D', 'W'); set(51, 'E', 'D'); set(51, 'F', 'H');
  set(52, 'B', 'handle knop HOONE VNA10785S'); set(52, 'G', 2); set(52, 'H', 26250);
  set(53, 'B', 'peluncur side mounted full ext (SH - ABC)'); set(53, 'E', 45); set(53, 'F', 300); set(53, 'G', 2);
  set(54, 'B', 'sekrup'); set(54, 'G', 40);
  set(55, 'B', 'name plate'); set(55, 'G', null);
  set(58, 'A', 'Prepared by:');
  return { sheets: [{ name: 'NIGHT STAND', rows, errors: [{ row: 18, col: 11, error: '#N/A' }] }, { name: 'NOTE', rows: [['MDF : $180 /m3'], ['Full Ext Side Mounted 300 mm']], errors: [] }] };
}

describe('legacy "Material Breakdown Form" adapter', () => {
  it('reads the header block, sections and assembly groups; never costs', () => {
    const res = importGrid(legacySheet(), { dictionary: dict });
    expect(res.workbookNotes).toEqual(['Full Ext Side Mounted 300 mm']); // the price line is dropped
    const p = res.products[0];
    expect(p.format).toBe('legacy-mbf');
    expect(p.product).toMatchObject({ category: 'Storage & Casegoods', subCategory: 'Nightstands', family: 'caseWithDrawers' });
    expect(p.revisionLabel).toBe('R2');
    expect(p.content.header).toMatchObject({ buyer: 'TEST BUYER', productSize: { W: 600, D: 400, H: 650 }, setup: 'FULL EXT SIDE MOUNTED' });
    const byName = (n: string) => p.content.parts.find((x) => x.originalName === n)!;
    expect(byName('panel top')).toMatchObject({ dims: { T: 9, W: 410, L: 610 }, material: 'PARTICLE BOARD E2', finishCode: 'cd', notes: 'AMBIL SISA POTONGAN', role: 'top' });
    expect(JSON.stringify(p.content)).not.toMatch(/999\.5|26250/); // cost columns never imported
    // the blank row closed "RAKITAN PANEL TOP": the front rail is a Body part
    const top = p.content.assemblies.find((a) => a.originalName === 'RAKITAN PANEL TOP')!;
    expect(byName('frame depan datar bawah').assemblyId).not.toBe(top.id);
    expect(p.content.assemblies.find((a) => a.originalName === 'RAKITAN LACI')!.qty).toBe(2);
    expect(byName('papan samp laci')).toMatchObject({ material: 'LVL SENGON', role: 'drawerSide' });
    // sections
    expect(byName('veneer panel top')).toMatchObject({ kind: 'veneer', qty: 2 });
    expect(byName('CARTON FA')).toMatchObject({ kind: 'packing' });
    expect(p.content.parts.find((x) => x.originalName === 'STYROFOAM')).toBeUndefined(); // qty 0 lines are template options
    expect(byName('peluncur side mounted full ext (SH - ABC)')).toMatchObject({ role: 'slide', unit: 'pair', dims: { T: 12.7, W: 45, L: 300 } });
    expect(byName('handle knop HOONE VNA10785S').hardwareSku).toBe('HOONE VNA10785S');
    expect(p.content.parts.find((x) => x.originalName === 'name plate')).toBeUndefined();
  });

  it('extracts SKUs only when a model code is present', () => {
    expect(extractSku('handle pull HOONE A11383')).toBe('HOONE A11383');
    expect(extractSku('mur nanas')).toBeNull();
  });

  it('skips sheets that are not product BOMs', () => {
    const r = importGrid({ sheets: [{ name: 'Cost', rows: [['x', 1]], errors: [] }] });
    expect(r.products).toHaveLength(0);
    expect(r.skippedSheets[0].name).toBe('Cost');
  });

  it.skipIf(!privateHollanPath() || !process.env.HOLLAN_PASSWORD)('imports the original password-protected Hollan House workbook', async () => {
    const r = await importFile(readFileSync(privateHollanPath()!), 'hollan.xlsx', { dictionary: dict, password: process.env.HOLLAN_PASSWORD });
    expect(r.products.map((p) => p.sheet)).toHaveLength(11);
    expect(r.skippedSheets.map((s) => s.name)).toEqual(['summary price', 'SUMMARY', 'NOTE', 'Tgl - Ket', 'Cost']);
  });
});

describe('standard import format (PRD §4)', () => {
  it('reads header block, head rows, explicit X/Y/Z and team columns', () => {
    const rows: CellValue[][] = [
      ['Product Code', 'NS-0420'],
      ['Product Name', 'Nightstand'],
      ['Category', 'Storage & Casegoods'],
      ['Sub-category', 'Nightstands'],
      ['Revision', 'A'],
      ['Product Size', '600 x 400 x 650'],
      [],
      ['Std Code', 'L1', 'L2', 'Part Name', 'Position', 'T', 'W', 'L', 'Qty', 'Unit', 'Material / Species', 'Finish Code', 'Hardware SKU', 'Team Owner', 'X', 'Y', 'Z', 'RotX', 'RotY', 'RotZ', 'Notes'],
      [null, 'Rakitan Laci', null, null, null, 200, 300, 400, 3, null, null, 'F-12', null, null, null, null, null, null, null, null, null],
      ['NST-01-01', 'Body', 'Dinding Samping', 'Panel Samping', 'Kiri', 18, 380, 600, 1, 'pcs', 'MAHOGANY', 'F-12 Walnut satin', null, null, 0, 0, 0, 0, 0, 0, 'Overlay front'],
      [null, 'Rakitan Laci', 'Panel Muka Laci', 'Panel Muka Laci', null, 18, 205, 590, 3, null, 'PLYWOOD', null, null, 'design', null, null, null, null, null, null, null],
      [null, null, null, 'Slide 45x350 FE', null, 12.7, 45, 350, 3, 'pair', null, null, 'Slide 45×350 FE', 'Hardware', null, null, null, null, null, null, null],
    ];
    const r = importGrid({ sheets: [{ name: 'NS', rows, errors: [] }] }, { dictionary: dict });
    const p = r.products[0];
    expect(p.format).toBe('standard');
    expect(p.product).toMatchObject({ code: 'NS-0420', name: 'Nightstand' });
    expect(p.revisionLabel).toBe('A');
    const side = p.content.parts.find((x) => x.originalName === 'Panel Samping')!;
    expect(side).toMatchObject({ stdCode: 'NST-01-01', match: { status: 'code' }, position: 'Kiri', instanceTransforms: { 0: { position: { x: 0, y: 0, z: 0 } } } });
    expect(p.content.assemblies.find((a) => a.originalName === 'Rakitan Laci')).toMatchObject({ qty: 3, finishCode: 'F-12' });
    expect(p.content.parts.find((x) => x.originalName === 'Slide 45x350 FE')).toMatchObject({ teamOwner: 'hardware', kind: 'hardware', unit: 'pair', hardwareSku: 'Slide 45×350 FE' });
  });

  it('reads CSV', () => {
    const csv = 'Product Code;NS-1\nPart Name;T;W;L;Qty\npanel top;18;400;600;1\n';
    const r = importGrid(readCsv(csv));
    expect(r.products[0].content.parts[0].dims).toEqual({ T: 18, W: 400, L: 600 });
  });
});

describe('Hollan House fixture', () => {
  it('has the 11 products with settled matches (confirmed in the import preview)', async () => {
    const products = await loadHollan();
    expect(products).toHaveLength(11);
    for (const p of products) {
      const s = matchSummary(p.content);
      expect(s.fuzzy + s.ai).toBe(0);
      expect(p.content.parts.every((x) => x.match.status === 'unmatched' || isMatchSettled(x.match.status))).toBe(true);
    }
  });

  it('export → import round-trips the BOM', async () => {
    const [p] = await loadHollan();
    const bytes = await exportBomWorkbook({ productCode: p.code, productName: p.name, category: p.category, subCategory: p.subCategory, revisionLabel: p.revisionLabel, content: p.content });
    const back = (await importFile(bytes, 'x.xlsx', { dictionary: dict })).products[0];
    expect(back.content.parts.map((x) => [x.originalName, x.dims, x.qty, x.material, x.finishCode, x.role])).toEqual(p.content.parts.map((x) => [x.originalName, x.dims, x.qty, x.material, x.finishCode, x.role]));
    expect(back.content.header.productSize).toEqual(p.content.header.productSize);
  });

  it('computes the material take-off at cut size', async () => {
    const ns = (await loadHollan()).find((p) => p.code === 'HH-CC-NIGHT-STAND')!;
    const t = materialTakeOff(ns.content);
    const mahogany = t.find((r) => r.material === 'MAHOGANY')!;
    // frame kaki depan 70×70×684 ×2 alone is 0.0067 m³
    expect(mahogany.volumeM3).toBeGreaterThan(0.0067);
    expect(t.every((r) => r.pieces > 0)).toBe(true);
    expect(cutListRows(ns.content).length).toBeGreaterThan(30);
  });
});

describe('import preview confirmation', () => {
  it('confirms fuzzy matches by score and lets a person pick another candidate', async () => {
    const res = importGrid(legacySheet(), { dictionary: dict });
    const c = res.products[0].content;
    const fuzzy = c.parts.filter((p) => p.match.status === 'fuzzy');
    const all = applyPatch(c, confirmAllPatch(c, 'u1', 0)).content;
    expect(all.parts.filter((p) => p.match.status === 'confirmed')).toHaveLength(fuzzy.length);
    const one = applyPatch(c, confirmMatchPatch(c, c.parts[0].id, 'NST-01-01', 'u1')).content;
    expect(['confirmed', 'manual']).toContain(one.parts[0].match.status);
    expect(one.parts[0].stdCode).toBe('NST-01-01');
  });
});

void readWorkbook;
void fixturePath;
