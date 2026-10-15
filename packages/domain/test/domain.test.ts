import { describe, it, expect } from 'vitest';
import {
  applyPatch, makePatch, emptyContent, makePart, contentHash, can, DEFAULT_SETTINGS, fmtMm, parseMmInput, type User,
} from '../src';

const user = (over: Partial<User>): User => ({ id: 'u1', name: 'A', email: 'a@x', teams: ['engineering'], role: 'editor', color: '#000', locale: 'en', external: false, ...over });

describe('patches', () => {
  it('applies and inverts every op', () => {
    const p = makePart({ id: 'p1', originalName: 'panel top', dims: { T: 18, W: 400, L: 700 } });
    const c0 = { ...emptyContent(), parts: [p] };
    const patch = makePatch([
      { op: 'setDim', partId: 'p1', dim: 'L', value: 567 },
      { op: 'setField', partId: 'p1', field: 'finishCode', value: 'F-12' },
      { op: 'setTransform', partId: 'p1', instance: 0, transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 90, z: 0 } } },
      { op: 'addPart', part: makePart({ id: 'p2', originalName: 'x' }) },
      { op: 'setAssumption', key: 'frontStyle', assumption: { key: 'frontStyle', value: 'inset', source: 'user', confidence: 'high' } },
    ], 'test');
    const { content: c1, inverse } = applyPatch(c0, patch);
    expect(c1.parts[0].dims.L).toBe(567);
    expect(c1.parts[0].finishCode).toBe('F-12');
    expect(c1.parts).toHaveLength(2);
    expect(c0.parts[0].dims.L).toBe(700); // immutable
    const { content: c2 } = applyPatch(c1, inverse);
    expect(contentHash(c2)).toBe(contentHash(c0));
  });

  it('typed number breaks the expression link and undo restores it', () => {
    const p = makePart({ id: 'p1', originalName: 'box', expressions: { W: '=opening.width - 25.4' } });
    const c0 = { ...emptyContent(), parts: [p] };
    const { content: c1, inverse } = applyPatch(c0, makePatch([{ op: 'setDim', partId: 'p1', dim: 'W', value: 500 }], 't'));
    expect(c1.parts[0].expressions.W).toBeUndefined();
    const { content: c2 } = applyPatch(c1, inverse);
    expect(c2.parts[0].expressions.W).toBe('=opening.width - 25.4');
  });

  it('hash is independent of key order', () => {
    const a = emptyContent();
    const b = JSON.parse(JSON.stringify(a));
    expect(contentHash(a)).toBe(contentHash(b));
  });
});

describe('permissions (PRD §2 matrix)', () => {
  const part = makePart({ originalName: 'slide', teamOwner: 'hardware' });
  it('viewer cannot edit, reviewer can approve own lane only', () => {
    expect(can(user({ role: 'viewer' }), 'editGeometry').allowed).toBe(false);
    expect(can(user({ role: 'reviewer', teams: ['qc'] }), 'approveLane', { team: 'qc' }).allowed).toBe(true);
    expect(can(user({ role: 'reviewer', teams: ['qc'] }), 'approveLane', { team: 'design' }).allowed).toBe(false);
  });
  it('editor out of scope → suggestion or block per workspace', () => {
    expect(can(user({}), 'editGeometry', { part, settings: DEFAULT_SETTINGS }).mode).toBe('suggestion');
    expect(can(user({}), 'editGeometry', { part, settings: { ...DEFAULT_SETTINGS, outOfScopeEdit: 'block' } }).allowed).toBe(false);
    expect(can(user({ teams: ['hardware'] }), 'editGeometry', { part }).mode).toBe('direct');
  });
  it('field ownership: finish code belongs to finishing', () => {
    const p = makePart({ originalName: 'top', teamOwner: 'design' });
    expect(can(user({ teams: ['design'] }), 'editBom', { part: p, field: 'finishCode' }).mode).toBe('suggestion');
    expect(can(user({ teams: ['finishing'] }), 'editBom', { part: p, field: 'finishCode' }).mode).toBe('direct');
  });
  it('released revisions and locked parts are read-only; leads release', () => {
    expect(can(user({ role: 'admin' }), 'editGeometry', { revisionState: 'released' }).allowed).toBe(false);
    expect(can(user({ role: 'lead' }), 'editGeometry', { part: { ...part, locked: true } }).allowed).toBe(false);
    expect(can(user({ role: 'lead' }), 'releaseRevision').allowed).toBe(true);
    expect(can(user({ role: 'editor' }), 'releaseRevision').allowed).toBe(false);
  });
  it('external buyers view/comment/approve sample on shared products only', () => {
    const buyer = user({ role: 'viewer', teams: ['buyer'], external: true });
    expect(can(buyer, 'comment', { productSharedWithBuyer: true }).allowed).toBe(true);
    expect(can(buyer, 'view', { productSharedWithBuyer: false }).allowed).toBe(false);
    expect(can(buyer, 'approveLane').allowed).toBe(false);
  });
});

describe('units', () => {
  it('displays to 0.5 mm, parses to 0.1 mm, never rounds storage', () => {
    expect(fmtMm(566.74)).toBe('566.5');
    expect(fmtMm(567)).toBe('567');
    expect(parseMmInput('566,76')).toBeCloseTo(566.8);
    expect(parseMmInput('abc')).toBeNull();
  });
});
