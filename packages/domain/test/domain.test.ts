import { describe, it, expect } from 'vitest';
import {
  applyPatch, makePatch, emptyContent, makePart, contentHash, can, classifyPatch, diffToPatch, DEFAULT_SETTINGS, fmtMm, parseMmInput, canEditWorkspaceSettings, updateThresholds, type User,
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

describe('diffToPatch', () => {
  it('reproduces any edit as a patch (undo/redo persistence)', () => {
    const c0 = { ...emptyContent(), parts: [makePart({ id: 'p1', originalName: 'top', dims: { T: 18, W: 400, L: 700 } }), makePart({ id: 'p2', originalName: 'side' })] };
    const edit = makePatch([
      { op: 'setDim', partId: 'p1', dim: 'W', value: 410 },
      { op: 'setExpr', partId: 'p1', dim: 'L', expr: '=case.width - 36' },
      { op: 'setField', partId: 'p1', field: 'notes', value: 'n' },
      { op: 'setTransform', partId: 'p1', instance: 1, transform: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } } },
      { op: 'removePart', partId: 'p2' },
      { op: 'addPart', part: makePart({ id: 'p3', originalName: 'back' }) },
      { op: 'setWaiver', findingKey: 'k', waiver: { findingKey: 'k', kind: 'false-positive', reason: 'r', by: 'u', at: 't' } },
    ], 'e');
    const c1 = applyPatch(c0, edit).content;
    const p = diffToPatch(c0, c1, 'again');
    expect(contentHash(applyPatch(c0, p).content)).toBe(contentHash(c1));
    expect(diffToPatch(c1, c1, 'none').ops).toHaveLength(0);
  });
});

describe('permissions (PRD §2 matrix)', () => {
  it('classifyPatch splits a patch into direct, suggestion and denied ops', () => {
    const own = makePart({ id: 'a', originalName: 'side', teamOwner: 'engineering' });
    const other = makePart({ id: 'b', originalName: 'slide', teamOwner: 'hardware' });
    const locked = makePart({ id: 'c', originalName: 'top', teamOwner: 'engineering', locked: true });
    const content = { ...emptyContent(), parts: [own, other, locked] };
    const patch = makePatch([
      { op: 'setDim', partId: 'a', dim: 'L', value: 1 },
      { op: 'setDim', partId: 'b', dim: 'L', value: 1 },
      { op: 'setField', partId: 'a', field: 'finishCode', value: 'F' },
      { op: 'setDim', partId: 'c', dim: 'L', value: 1 },
    ], 'x');
    const r = classifyPatch(user({}), content, patch, DEFAULT_SETTINGS, 'draft');
    expect(r.direct).toHaveLength(1);
    expect(r.suggestions.map((s) => [s.team, s.ops.length])).toEqual([['hardware', 1], ['finishing', 1]]);
    expect(r.denied[0].reason).toMatch(/locked/);
    expect(classifyPatch(user({}), content, patch, DEFAULT_SETTINGS, 'released').denied).toHaveLength(4);
  });

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

describe('workspace thresholds (Settings → Workspace)', () => {
  it('only leads and admins edit them, never external users', () => {
    expect(canEditWorkspaceSettings({ role: 'lead', external: false })).toBe(true);
    expect(canEditWorkspaceSettings({ role: 'admin', external: false })).toBe(true);
    expect(canEditWorkspaceSettings({ role: 'editor', external: false })).toBe(false);
    expect(canEditWorkspaceSettings({ role: 'admin', external: true })).toBe(false);
  });
  it('applies valid values (comma decimals too) and reports what changed', () => {
    const r = updateThresholds(DEFAULT_SETTINGS, { reveal: '2,5', slideClearance: 12.7 });
    expect(r.settings.thresholds.reveal).toBe(2.5);
    expect(r.changed).toEqual({ reveal: { from: 2, to: 2.5 } });
    expect(DEFAULT_SETTINGS.thresholds.reveal).toBe(2);
  });
  it('rejects unknown keys and bad numbers without applying anything', () => {
    expect(() => updateThresholds(DEFAULT_SETTINGS, { mattresses: 1 })).toThrow(/Unknown/);
    expect(() => updateThresholds(DEFAULT_SETTINGS, { reveal: -1 })).toThrow(/between 0 and 5000/);
    expect(() => updateThresholds(DEFAULT_SETTINGS, { reveal: 'abc' })).toThrow();
  });
});
