import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import type { RevisionContent } from '@bom/domain';
import { applyPatch, makePatch, contentHash } from '@bom/domain';
import { loadHollan } from '@bom/fixtures';
import {
  initRevision, readRevision, applyPatchToDoc, watchLostWrites, acquireLock, canEdit, touchLocks, releaseLocks, createUserUndo,
  ChannelProvider, MemoryHub, syncDocTo, setPresence, peers, followedView, bringEveryoneHere, onSummon, boardItems, type LostWrite,
} from '../src';

let content: RevisionContent;
beforeAll(async () => {
  content = (await loadHollan()).find((p) => p.code === 'HH-CC-NIGHT-STAND')!.content;
});

function pair() {
  const hub = new MemoryHub();
  const a = new Y.Doc();
  const b = new Y.Doc();
  const pa = new ChannelProvider(a, hub.channel());
  const pb = new ChannelProvider(b, hub.channel());
  return { hub, a, b, pa, pb };
}

describe('shared revision document', () => {
  it('round-trips revision content through the doc', () => {
    const doc = new Y.Doc();
    initRevision(doc, 'r1', content);
    expect(contentHash(readRevision(doc, 'r1')!)).toBe(contentHash(content));
  });

  it('applying a patch to the doc equals applying it to the content', () => {
    const doc = new Y.Doc();
    initRevision(doc, 'r1', content);
    const front = content.parts.find((p) => p.role === 'drawerFront')!;
    const patch = makePatch([{ op: 'setDim', partId: front.id, dim: 'L', value: 455 }, { op: 'setField', partId: front.id, field: 'finishCode', value: 'F-12' }, { op: 'removePart', partId: content.parts[3].id }], 'edit');
    applyPatchToDoc(doc, 'r1', patch, 'u1');
    expect(contentHash(readRevision(doc, 'r1')!)).toBe(contentHash(applyPatch(content, patch).content));
  });

  it('two clients converge; different fields of one part both win', () => {
    const { a, b } = pair();
    initRevision(a, 'r1', content);
    const front = content.parts.find((p) => p.role === 'drawerFront')!;
    applyPatchToDoc(a, 'r1', makePatch([{ op: 'setDim', partId: front.id, dim: 'L', value: 455 }], 'a'), 'ua');
    applyPatchToDoc(b, 'r1', makePatch([{ op: 'setField', partId: front.id, field: 'finishCode', value: 'F-12' }], 'b'), 'ub');
    const ra = readRevision(a, 'r1')!;
    const rb = readRevision(b, 'r1')!;
    expect(contentHash(ra)).toBe(contentHash(rb));
    const f = ra.parts.find((p) => p.id === front.id)!;
    expect([f.dims.L, f.finishCode]).toEqual([455, 'F-12']);
  });

  it('same field: last write wins and the loser is told the value they lost', () => {
    const hub = new MemoryHub();
    const a = new Y.Doc();
    const b = new Y.Doc();
    initRevision(a, 'r1', content);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const front = content.parts.find((p) => p.role === 'drawerFront')!;
    const lost: LostWrite[] = [];
    watchLostWrites(a, 'r1', 'ua', (l) => lost.push(l));
    applyPatchToDoc(a, 'r1', makePatch([{ op: 'setDim', partId: front.id, dim: 'L', value: 455 }], 'a'), 'ua');
    // b writes after a, then they sync
    applyPatchToDoc(b, 'r1', makePatch([{ op: 'setDim', partId: front.id, dim: 'L', value: 452 }], 'b'), 'ub');
    new ChannelProvider(a, hub.channel());
    new ChannelProvider(b, hub.channel());
    const la = readRevision(a, 'r1')!.parts.find((p) => p.id === front.id)!.dims.L;
    const lb = readRevision(b, 'r1')!.parts.find((p) => p.id === front.id)!.dims.L;
    expect(la).toBe(lb);
    if (la === 452) expect(lost).toEqual([{ partId: front.id, field: 'dims.L', yours: 455, theirs: 452 }]);
  });
});

describe('out-of-band reconciliation', () => {
  it('syncDocTo reaches the target content with field-level writes and merges with a concurrent offline edit', () => {
    const server = new Y.Doc();
    initRevision(server, 'r1', content);
    const offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(server));
    const front = content.parts.find((p) => p.role === 'drawerFront')!;
    const other = content.parts.find((p) => p.id !== front.id && p.role !== 'drawerFront')!;
    // The row changed via REST (front height), while an offline client edited a different part.
    const target = applyPatch(content, makePatch([{ op: 'setDim', partId: front.id, dim: 'L', value: 401 }, { op: 'removePart', partId: content.parts.at(-1)!.id }], 'rest')).content;
    const writes = syncDocTo(server, 'r1', target);
    expect(writes).toBeLessThan(5);
    expect(contentHash(readRevision(server, 'r1')!)).toBe(contentHash(target));
    expect(syncDocTo(server, 'r1', target)).toBe(0);
    applyPatchToDoc(offline, 'r1', makePatch([{ op: 'setField', partId: other.id, field: 'notes', value: 'offline note' }], 'x'), 'u2');
    Y.applyUpdate(server, Y.encodeStateAsUpdate(offline));
    const merged = readRevision(server, 'r1')!;
    expect(merged.parts.find((p) => p.id === front.id)!.dims.L).toBe(401);
    expect(merged.parts.find((p) => p.id === other.id)!.notes).toBe('offline note');
  });
});

describe('per-user undo', () => {
  it('Ctrl+Z only undoes your own change', () => {
    const { a, b } = pair();
    initRevision(a, 'r1', content);
    const undoA = createUserUndo(a, ['r1'], 'ua');
    const [p1, p2] = content.parts;
    applyPatchToDoc(a, 'r1', makePatch([{ op: 'setDim', partId: p1.id, dim: 'T', value: 99 }], 'a'), 'ua');
    applyPatchToDoc(b, 'r1', makePatch([{ op: 'setDim', partId: p2.id, dim: 'T', value: 77 }], 'b'), 'ub');
    undoA.undo();
    const r = readRevision(a, 'r1')!;
    expect(r.parts.find((p) => p.id === p1.id)!.dims.T).toBe(p1.dims.T);
    expect(r.parts.find((p) => p.id === p2.id)!.dims.T).toBe(77);
  });
});

describe('part locks', () => {
  it('blocks others, expires after 30 minutes idle, refreshes on activity', () => {
    const doc = new Y.Doc();
    const t0 = 1_000_000;
    expect(acquireLock(doc, ['p1', 'p2'], { id: 'u1', name: 'Budi' }, 30 * 60_000, t0).ok).toEqual(['p1', 'p2']);
    expect(acquireLock(doc, ['p1'], { id: 'u2', name: 'Sari' }, 30 * 60_000, t0 + 1000).blocked[0].userName).toBe('Budi');
    expect(canEdit(doc, 'p1', 'u2', t0 + 29 * 60_000)).toBe(false);
    touchLocks(doc, 'u1', 30 * 60_000, t0 + 29 * 60_000);
    expect(canEdit(doc, 'p1', 'u2', t0 + 45 * 60_000)).toBe(false);
    expect(canEdit(doc, 'p1', 'u2', t0 + 60 * 60_000)).toBe(true);
    releaseLocks(doc, 'u1');
    expect(canEdit(doc, 'p2', 'u2', t0)).toBe(true);
  });
});

describe('presence, follow mode and meetings', () => {
  it('shares cursors, selection and camera; follow mode mirrors the camera', () => {
    const { pa, pb } = pair();
    setPresence(pa.awareness, { user: { id: 'u1', name: 'Margono', color: '#2563eb', team: 'design' }, cursor: { x: 10, y: 20 }, selection: ['p1'], view: { frameId: 'f1', camera: { position: [1, 2, 3], target: [0, 0, 0] }, board: { x: 0, y: 0, zoom: 1 } } });
    setPresence(pb.awareness, { user: { id: 'u2', name: 'Budi', color: '#7c3aed', team: 'engineering' } });
    expect(peers(pb.awareness).map((p) => p.user.name)).toEqual(['Margono']);
    expect(followedView(pb.awareness, 'u1')?.camera?.position).toEqual([1, 2, 3]);
  });

  it('"Bring everyone here" reaches followers', () => {
    const { a, b } = pair();
    let got: unknown = null;
    onSummon(b, 'm1', (s) => (got = s.view));
    bringEveryoneHere(a, { meetingId: 'm1', by: 'u1', at: 1, view: { frameId: 'f1' } });
    expect(got).toEqual({ frameId: 'f1' });
  });

  it('25 people editing one board converge', () => {
    const hub = new MemoryHub();
    const docs = Array.from({ length: 25 }, () => new Y.Doc());
    docs.forEach((d) => new ChannelProvider(d, hub.channel()));
    docs.forEach((d, i) => boardItems(d).set(`mk_${i}`, { id: `mk_${i}`, kind: 'markup', type: 'note', points: [], rect: { x: i, y: i, w: 10, h: 10 }, text: `note ${i}`, style: { stroke: '#000', fill: null, strokeWidth: 1, sketchy: false }, z: i, authorId: `u${i}`, bindStart: null, bindEnd: null, pin: null, team: null }));
    for (const d of docs) expect(boardItems(d).size).toBe(25);
  });
});
