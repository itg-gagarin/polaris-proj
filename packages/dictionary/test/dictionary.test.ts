import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkbook, type WorkbookGrid } from '@bom/sheets';
import type { StdPart } from '@bom/domain';
import {
  importDictionary, qualityReport, diffDictionaries, mergeDictionaries, DictionaryIndex, applyOverlay, parseAxisMap,
  inferRole, normalizeName, exportDictionary, type Overlay,
} from '../src';

const ROOT = resolve(__dirname, '../../..');
let grid: WorkbookGrid;
let entries: StdPart[];

beforeAll(async () => {
  grid = await readWorkbook(readFileSync(resolve(ROOT, 'fixtures/dictionary/ref.xlsx')));
  const overlay = JSON.parse(readFileSync(resolve(ROOT, 'fixtures/dictionary/axis-role-overlay.json'), 'utf8')) as Overlay;
  entries = applyOverlay(importDictionary(grid).entries, overlay);
});

describe('reference workbook import (PRD §4, phase-0 gate)', () => {
  it('has 1,920 entries: 423 L1 heads and 1,497 L2 components', () => {
    const r = qualityReport(entries);
    expect(r.totals.entries).toBe(1920);
    expect(r.totals.l1).toBe(423);
    expect(r.totals.l2).toBe(1497);
    expect(r.totals.distinctL1).toBe(155);
    expect(r.totals.distinctL2).toBe(382);
    expect(r.totals.categories).toBe(8);
    // PRD text says 42 sub-categories; the workbook has 41 category/sub-category pairs.
    expect(r.totals.subCategories).toBe(41);
  });

  it('matches the PRD category table', () => {
    expect(qualityReport(entries).byCategory).toEqual({
      'Storage & Casegoods': 808, Beds: 506, Tables: 345, Seating: 147, 'Other Furniture': 72, 'Dining Set': 21, Unclassified: 15, 'NON FURNITURE': 6,
    });
  });

  it('lists the data problems: 106 "Please specify" and two misspellings', () => {
    const issues = qualityReport(entries).issues;
    expect(issues.find((i) => i.code === 'please-specify')?.count).toBe(106);
    const typos = issues.filter((i) => i.code === 'misspelling').map((i) => i.message);
    expect(typos).toHaveLength(2);
    expect(typos.join(' ')).toMatch(/Extention/);
    expect(typos.join(' ')).toMatch(/Entertaiment/);
  });

  it('fills Axis Map and Default Role for the 50 most-used Std Codes', () => {
    const issues = qualityReport(entries).issues.filter((i) => i.severity === 'error' && (i.code === 'missing-axis-map' || i.code === 'missing-default-role'));
    expect(issues).toEqual([]);
  });

  it('builds parent links and the L1 → L2 tree', () => {
    const idx = new DictionaryIndex(entries);
    expect(idx.get('CAN-02-01')?.parentCode).toBe('CAN-02');
    expect(idx.children('CAN-02').map((e) => e.stdCode)).toEqual(['CAN-02-01', 'CAN-02-02']);
    expect(idx.get('NST-01-01')?.positions).toEqual(['Kanan', 'Kiri']);
  });
});

describe('flexible layout', () => {
  it('reads a sheet with reordered columns, extra columns and one sheet per category', () => {
    const g: WorkbookGrid = {
      sheets: [
        {
          name: 'Beds',
          errors: [],
          rows: [
            ['Some title'],
            [],
            ['Std Code', 'Sub category', 'Standard SG Name', 'L1 (Head)', 'L2', 'Axis Map', 'Default Role', 'Owner Team', 'Comment'],
            ['RLS-02', 'Rails', 'Side Rail', 'Side Rail', null, null, null, 'design', 'x'],
            ['RLS-02-03', 'Rails', 'Panel', 'Side Rail', 'Panel', 'T:x W:y L:z', 'bedRail', 'Engineering', null],
          ],
        },
      ],
    };
    const r = importDictionary(g);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ stdCode: 'RLS-02', level: 1, category: 'Beds', subCategory: 'Rails', ownerTeam: 'design' });
    expect(r.entries[1]).toMatchObject({ level: 2, parentCode: 'RLS-02', axisMap: { T: 'x', W: 'y', L: 'z' }, defaultRole: 'bedRail', ownerTeam: 'engineering' });
  });

  it('parses axis maps strictly', () => {
    expect(parseAxisMap('T:x W:z L:y')).toEqual({ T: 'x', W: 'z', L: 'y' });
    expect(parseAxisMap('T=y, W=z, L=x')).toEqual({ T: 'y', W: 'z', L: 'x' });
    expect(parseAxisMap('y z x')).toEqual({ T: 'y', W: 'z', L: 'x' });
    expect(parseAxisMap('T:x W:x L:y')).toBeNull();
    expect(parseAxisMap('')).toBeNull();
  });

  it('round-trips through the enriched export', async () => {
    const bytes = await exportDictionary(entries.slice(0, 60));
    const back = importDictionary(await readWorkbook(bytes)).entries;
    expect(back).toHaveLength(60);
    const d = diffDictionaries(entries.slice(0, 60), back);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toEqual([]);
  });
});

describe('re-import diff', () => {
  it('shows added, changed and removed entries and keeps enrichment', () => {
    const a = entries.slice(0, 5);
    const b = [{ ...a[0], name: 'Renamed', axisMap: null }, ...a.slice(2), { ...a[1], stdCode: 'NEW-01' }];
    const d = diffDictionaries(a, b);
    expect(d.added.map((e) => e.stdCode)).toEqual(['NEW-01']);
    expect(d.removed.map((e) => e.stdCode)).toEqual([a[1].stdCode]);
    expect(d.changed[0].stdCode).toBe(a[0].stdCode);
    const merged = mergeDictionaries([{ ...a[0], axisMap: { T: 'x', W: 'y', L: 'z' } }], [{ ...a[0], axisMap: null }]);
    expect(merged[0].axisMap).toEqual({ T: 'x', W: 'y', L: 'z' });
  });
});

describe('name matching (PRD §4 order)', () => {
  const nightstand = { category: 'Storage & Casegoods', subCategory: 'Nightstands' };
  it('1. exact Std Code', () => {
    const m = new DictionaryIndex(entries).match({ stdCode: 'NST-01-01', name: 'whatever' });
    expect(m).toMatchObject({ status: 'code', stdCode: 'NST-01-01', score: 1 });
  });
  it('2. exact standard or merged name, abbreviations expanded', () => {
    const idx = new DictionaryIndex(entries);
    expect(idx.match({ name: 'panel samp ', ...nightstand, level: 2 })).toMatchObject({ status: 'exact', stdCode: 'NST-01-01' }); // merged "Panel Samping"
    expect(idx.match({ name: 'RAKITAN LACI ', ...nightstand, level: 1 })).toMatchObject({ status: 'exact', stdCode: 'NST-01-02' });
    expect(idx.match({ name: 'dust panel', ...nightstand })).toMatchObject({ status: 'exact' });
  });
  it('2b. position words are split off for the exact match', () => {
    const idx = new DictionaryIndex(entries);
    const m = idx.match({ name: 'Dinding Samping Kiri', ...nightstand });
    expect(m).toMatchObject({ status: 'exact', stdCode: 'NST-01-01', position: 'Kiri' });
  });
  it('3. fuzzy with score and top-3 candidates; never auto-confirmed', () => {
    const m = new DictionaryIndex(entries).match({ name: 'frame kaki depan', l1: 'RAKITAN PANEL SAMP', ...nightstand, level: 2 });
    expect(m.status).toBe('fuzzy');
    expect(m.entry?.name).toBe('Kaki Depan');
    expect(m.candidates.length).toBeLessThanOrEqual(3);
    expect(m.score).toBeGreaterThan(0.55);
    expect(m.score).toBeLessThan(1);
  });
  it('unknown names stay unmatched', () => {
    expect(new DictionaryIndex(entries).match({ name: 'zzqx blorp', ...nightstand }).status).toBe('unmatched');
  });
  it('search finds codes and names', () => {
    const idx = new DictionaryIndex(entries);
    expect(idx.search('NST-01-0')[0].entry.stdCode.startsWith('NST-01-0')).toBe(true);
    expect(idx.search('kaki depan', { category: 'Storage & Casegoods' })[0].entry.name).toBe('Kaki Depan');
  });
});

describe('role rules', () => {
  it.each([
    ['panel top ', 'RAKITAN PANEL TOP', 'top'],
    ['penebal top (samp)', 'RAKITAN PANEL TOP', 'topThickener'],
    ['frame kaki depan', 'RAKITAN PANEL SAMP', 'legFront'],
    ['frame peluncur laci', 'RAKITAN PANEL SAMP', 'runner'],
    ['panel muka laci ', 'RAKITAN LACI', 'drawerFront'],
    ['papan samp laci', 'RAKITAN LACI', 'drawerSide'],
    ['klos segitiga laci', 'RAKITAN LACI', 'drawerBlock'],
    ['penebal kaki bawah', 'RAKITAN KAKI BAWAH', 'legThickener'],
    ['tonggak kaki bawah', 'RAKITAN KAKI BAWAH', 'lowerLeg'],
    ['klos slats', 'RAKITAN PANEL SIDE RAIL', 'slatLedger'],
    ['peluncur side mounted full ext  Soft Closing (SH - ABC)', null, 'slide'],
    ['handle knop HOONE VNA10785S', null, 'knob'],
    ['mur nanas', null, 'fastener'],
    ['STYROFOAM', null, 'packingMaterial'],
  ])('%s → %s', (name, ctx, role) => {
    expect(inferRole(name, ctx, { family: 'caseWithDrawers' }).role).toBe(role);
  });
  it('leg support is a slat support leg on beds, a leg support on case goods', () => {
    expect(inferRole('leg support', null, { family: 'bedComponent' }).role).toBe('slatSupportLeg');
    expect(inferRole('leg support', null, { family: 'caseWithDrawers' }).role).toBe('legSupport');
  });
  it('normalises shop-floor abbreviations', () => {
    expect(normalizeName('Penebal top (muka - blk)')).toBe('penebalan top muka belakang');
    expect(normalizeName('frame tempelan tegak tgh ')).toBe('frame tempelan tegak tengah');
  });
});
