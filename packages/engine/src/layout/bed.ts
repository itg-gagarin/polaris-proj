/**
 * Layout templates: bed components (headboard, footboard, side rails as separate products)
 * and the bed set (headboard + rails + footboard). Decorative faces point to +z.
 */
import type { Assembly, Part, Vec3, WorkspaceSettings } from '@bom/domain';
import { normalizeName } from '@bom/dictionary';
import { v3 } from '../geometry';
import type { ContentIndex } from '../model';
import { instanceCount, type Placer } from './placer';
import { layoutSkids } from './case';
import type { Layout } from './types';

const EXPLODE = 220;

interface Board {
  asm: Assembly | null;
  parts: Part[];
  kind: 'headboard' | 'footboard';
}

const each = (pl: Placer, p: Part, fn: (i: number, s: Vec3) => void) => {
  const s = pl.sizeOf(p, null).size;
  for (let i = 0; i < instanceCount(p); i++) fn(i, s);
};

/** Place one board (HB or FB) with its back-left-bottom corner at `origin`. Returns depth used. */
function placeBoard(ix: ContentIndex, pl: Placer, b: Board, origin: Vec3, width: number, heightTotal: number | null, compKey: string | null): { depth: number; postW: number; y0: number } {
  const inComp = (p: Part) => !compKey || p.attrs.component === compKey;
  const parts = ix.parts.filter((p) => inComp(p) && (b.parts.includes(p) || (!p.assemblyId || ix.asm(p)?.role !== 'sideRails')));
  const byRole = (r: string) => parts.filter((p) => p.role === r);
  const firstSize = (r: string) => (byRole(r)[0] ? pl.sizeOf(byRole(r)[0], null).size : null);
  const post = firstSize('bedPost') ?? v3(60, 900, 60);
  const lower = firstSize('lowerLeg');
  const cap = firstSize('bedCap');
  const capT = cap?.y ?? 0;
  const W = width;
  // Depth stack (back → front): lower legs | posts. The cap spans back from the front face.
  const depthTotal = Math.max(cap?.z ?? 0, (lower?.z ?? 0) + post.z, post.z);
  const zPost = depthTotal - post.z;
  const y0 = heightTotal && lower ? Math.max(0, heightTotal - post.y - capT) : 0;
  const ex = (v: Vec3) => v;
  const o = origin;
  const at = (x: number, y: number, z: number) => v3(o.x + x, o.y + y, o.z + z);
  const opt = (extra: Partial<NonNullable<Parameters<Placer['put']>[3]>> = {}) => ({ envelope: null, ...extra });

  byRole('bedPost').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at(i % 2 === 0 ? 0 : W - s.x, y0, zPost), opt({ asmInstance: i % 2, explode: ex(v3((i % 2 ? 1 : -1) * EXPLODE * 0.5, 0, 0)) }))));
  const postTop = y0 + post.y;
  const panel = firstSize('bedPanel');
  const panelZ = zPost;
  const panelY0 = panel ? postTop - panel.y : y0;
  byRole('bedPanel').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at((W - s.x) / 2, postTop - s.y, panelZ), opt())));
  const panelFront = panelZ + (panel?.z ?? 18);
  const panelBack = panelZ;
  byRole('bedCap').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at((W - s.x) / 2, postTop + i * s.y, depthTotal - s.z), opt({ explode: v3(0, EXPLODE * 0.6, 0) }))));
  const capZ1 = depthTotal;
  byRole('bedCapProfile').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at((W - s.x) / 2, postTop - s.y, capZ1 - s.z), opt({ confidence: 'low', explode: v3(0, EXPLODE * 0.6, 0) }))));
  byRole('bedCapProfileSide').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at(i % 2 === 0 ? 0 : W - s.x, postTop - s.y, depthTotal - s.z), opt({ confidence: 'low', explode: v3(0, EXPLODE * 0.6, 0) }))));

  // Applied frame on the panel face: rails by position word, stiles at the edges and evenly inside.
  const panelX0 = panel ? (W - panel.x) / 2 : post.x;
  const panelX1 = W - panelX0;
  const applied = (p: Part) => normalizeName(p.originalName);
  byRole('bedAppliedRail').forEach((p) =>
    each(pl, p, (i, s) => {
      const n = applied(p);
      const y = /atas/.test(n) ? postTop - s.y : /tengah/.test(n) ? panelY0 + (postTop - panelY0) * 0.45 : panelY0;
      pl.put(p, i, at((W - s.x) / 2, y, panelFront), opt({ confidence: 'low', explode: v3(0, 0, EXPLODE * 0.4) }));
    }),
  );
  byRole('bedAppliedStile').forEach((p) =>
    each(pl, p, (i, s) => {
      const n = applied(p);
      const count = instanceCount(p);
      let x: number;
      if (/samping/.test(n)) x = i % 2 === 0 ? panelX0 : panelX1 - s.x;
      else x = panelX0 + ((i + 1) * (panelX1 - panelX0)) / (count + 1) - s.x / 2;
      const y = /bawah/.test(n) ? panelY0 : postTop - s.y - (/atas/.test(n) ? 124 : 0);
      pl.put(p, i, at(x, y, panelFront), opt({ confidence: 'low', explode: v3(0, 0, EXPLODE * 0.4) }));
    }),
  );
  byRole('bedAppliedProfile').forEach((p) =>
    each(pl, p, (i, s) => {
      const count = instanceCount(p);
      const rows = Math.max(1, Math.min(2, Math.floor((postTop - panelY0) / (s.y + 20))));
      const cols = Math.max(1, Math.ceil(count / rows));
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = panelX0 + ((col + 0.5) * (panelX1 - panelX0)) / cols - s.x / 2;
      const y = panelY0 + ((row + 0.5) * (postTop - panelY0)) / rows - s.y / 2;
      // Raised panels sit inside the applied frame, on the panel face.
      pl.put(p, i, at(x, y, panelFront), opt({ confidence: 'low', explode: v3(0, 0, EXPLODE * 0.55) }));
    }),
  );
  // Back of the panel.
  for (const r of ['bedBackSupport', 'bedBackRail']) {
    byRole(r).forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at((W - s.x) / 2, panelY0 + ((i + 1) * (postTop - panelY0)) / (instanceCount(p) + 1) - s.y / 2, panelBack - s.z), opt({ confidence: 'low', explode: v3(0, 0, -EXPLODE * 0.4) }))));
  }
  const backRailT = Math.max(firstSize('bedBackRail')?.z ?? 0, firstSize('bedBackSupport')?.z ?? 0);
  byRole('bedBackStile').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at(panelX0 + ((i + 1) * (panelX1 - panelX0)) / (instanceCount(p) + 1) - s.x / 2, panelY0, Math.max(0, panelBack - backRailT - s.z)), opt({ confidence: 'low', explode: v3(0, 0, -EXPLODE * 0.5) }))));
  // Glue blocks between the back stiles.
  byRole('block').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at(panelX0 + ((i + 0.5) * (panelX1 - panelX0)) / instanceCount(p) - s.x / 2, panelY0 + 40, Math.max(0, panelBack - backRailT - s.z)), opt({ confidence: 'low' }))));
  // Stretcher behind the bottom of the panel.
  const stretchers = byRole('stretcher');
  stretchers.forEach((p) =>
    each(pl, p, (i, s) => {
      const lowerOne = /bawah/.test(applied(p)) && !!lower;
      const y = lowerOne ? 180 : panelY0;
      const z = lowerOne ? 0 : Math.max(0, panelBack - backRailT - s.z);
      pl.put(p, i, at((W - s.x) / 2, y, z), opt({ confidence: 'low', explode: v3(0, 0, -EXPLODE * 0.6) }));
    }),
  );
  byRole('stretcherBlock').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at(i % 2 === 0 ? panelX0 : panelX1 - s.x, panelY0, Math.max(0, panelBack - backRailT - s.z)), opt({ confidence: 'low' }))));
  // Lower legs behind the posts (headboards with legs).
  byRole('lowerLeg').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at(i % 2 === 0 ? 0 : W - s.x, 0, 0), opt({ asmInstance: i % 2, explode: v3((i % 2 ? 1 : -1) * EXPLODE * 0.5, -EXPLODE * 0.3, 0) }))));
  byRole('legThickener').forEach((p) => each(pl, p, (i, s) => pl.put(p, i, at(i % 2 === 0 ? (lower?.x ?? 0) : W - (lower?.x ?? 0) - s.x, 0, 0), opt({ asmInstance: i % 2, confidence: 'low' }))));
  const depth = Math.max(depthTotal, panelFront + (firstSize('bedAppliedRail')?.z ?? firstSize('bedAppliedStile')?.z ?? 0));
  return { depth, postW: post.x, y0 };
}

/** Glides go under the lowest legs first (lower legs or posts), then under the slat support legs. */
function placeGlides(ix: ContentIndex, pl: Placer): void {
  const feet = pl.instances
    .filter((x) => (x.role === 'lowerLeg' || x.role === 'slatSupportLeg' || (x.role === 'bedPost' && x.min.y < 1)) && x.source !== 'stack')
    .sort((a, b) => (a.role === 'slatSupportLeg' ? 1 : 0) - (b.role === 'slatSupportLeg' ? 1 : 0));
  const glides = ix.role('glide').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  glides.forEach(({ p, i }, n) => {
    const f = feet[n];
    if (!f) return;
    const s = pl.sizeOf(p, null).size;
    pl.put(p, i, v3((f.min.x + f.max.x) / 2 - s.x / 2, f.min.y - s.y, (f.min.z + f.max.z) / 2 - s.z / 2), { confidence: 'low', envelope: null, group: f.group });
  });
}

/** Side rails: core + linings with the slat ledgers on the inner face. */
function placeRails(ix: ContentIndex, pl: Placer, params: Record<string, number>, o: { xLeft: number; xRight: number; z0: number; slatY: number; standalone: boolean }): { length: number; innerX0: number; innerX1: number; hasLedger: boolean } {
  const railAsm = ix.asmRole('sideRails')[0];
  const parts = ix.parts.filter((p) => p.assemblyId === railAsm?.id || p.role === 'bedRail' || p.role === 'railLining' || p.role === 'slatLedger');
  const core = parts.find((p) => p.role === 'bedRail');
  const env = railAsm?.dims ? { x: railAsm.dims.T, y: railAsm.dims.W, z: railAsm.dims.L } : null;
  const coreS = core ? pl.sizeOf(core, env).size : v3(18, 250, 2000);
  const lining = parts.find((p) => p.role === 'railLining');
  const linT = lining ? pl.sizeOf(lining, env).size.x : 0;
  const envelope = params['rail.envelope'] ?? env?.x ?? coreS.x + 2 * linT;
  const ledger = parts.find((p) => p.role === 'slatLedger');
  const ledgerS = ledger ? pl.sizeOf(ledger, null).size : null;
  const L = env?.z ?? coreS.z;
  const railY0 = Math.max(0, o.slatY - (ledgerS?.y ?? 25) - 10);
  const nRails = railAsm?.qty ?? 2;
  // Rail k: outer face at xLeft (left) or xRight (right); the solid part sits on the inner side of the envelope.
  const railX = (k: number) => (k % 2 === 0 ? { outer: o.xLeft, inner: o.xLeft + envelope, dir: 1 } : { outer: o.xRight, inner: o.xRight - envelope, dir: -1 });
  const solidT = coreS.x + 2 * linT;
  for (const p of parts) {
    const per = Math.max(1, Math.round(instanceCount(p) / nRails));
    for (let i = 0; i < instanceCount(p); i++) {
      const k = Math.floor(i / per);
      const j = i % per;
      const r = railX(k);
      const { size: s } = pl.sizeOf(p, env);
      const ex = v3((r.dir < 0 ? 1 : -1) * EXPLODE * 0.6, 0, 0);
      const solidX0 = r.dir > 0 ? r.inner - solidT : r.inner;
      let pos: Vec3 | null = null;
      if (p.role === 'bedRail') pos = v3(solidX0 + linT, railY0, o.z0);
      else if (p.role === 'railLining') pos = v3(j % 2 === 0 ? solidX0 : solidX0 + linT + coreS.x, railY0, o.z0);
      else if (p.role === 'slatLedger') {
        const gap = (L - per * s.z) / (per + 1);
        pos = v3(r.dir > 0 ? r.inner : r.inner - s.x, o.slatY - s.y, o.z0 + gap + j * (s.z + gap));
      }
      if (pos) pl.put(p, i, pos, { asmInstance: k, envelope: p.role === 'slatLedger' ? null : env, explode: ex, confidence: p.role === 'slatLedger' ? 'low' : 'medium' });
    }
  }
  return { length: L, innerX0: o.xLeft + envelope, innerX1: o.xRight - envelope, hasLedger: !!ledger };
}

function placeSlats(ix: ContentIndex, pl: Placer, o: { x0: number; x1: number; z0: number; length: number; slatY: number }): number {
  const slats = ix.role('slat').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  const n = slats.length;
  slats.forEach(({ p, i }, k) => {
    const s = pl.sizeOf(p, null).size;
    const zc = o.z0 + ((k + 1) * o.length) / (n + 1);
    pl.put(p, i, v3((o.x0 + o.x1) / 2 - s.x / 2, o.slatY, zc - s.z / 2), { group: 'slats', explode: v3(0, EXPLODE, 0) });
  });
  const legs = ix.role('slatSupportLeg').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  legs.forEach(({ p, i }, k) => {
    const s = pl.sizeOf(p, null).size;
    const zc = o.z0 + ((k + 1) * o.length) / (legs.length + 1);
    pl.put(p, i, v3((o.x0 + o.x1) / 2 - s.x / 2, o.slatY - s.y, zc - s.z / 2), { explode: v3(0, EXPLODE * 0.5, 0), confidence: 'low' });
  });
  return n;
}

/** Shipped-loose parts (slats with a footboard, etc.) are stacked beside the product. */
function stackLoose(ix: ContentIndex, pl: Placer, roles: string[], x0: number, z0: number): void {
  let y = 0;
  for (const r of roles) {
    for (const p of ix.role(r)) {
      for (let i = 0; i < instanceCount(p); i++) {
        if (pl.isPlaced(p, i)) continue;
        const s = pl.sizeOf(p, null).size;
        pl.put(p, i, v3(x0, y, z0), { source: 'stack', confidence: 'low', group: 'stack' });
        y += s.y + 2;
      }
    }
  }
}

export function layoutBed(ix: ContentIndex, params: Record<string, number>, settings: WorkspaceSettings, pl: Placer, family: 'bed' | 'bedComponent'): Pick<Layout, 'bedInfo'> {
  void settings;
  const size = ix.content.header.productSize;
  const slatY = params['slat.height'] ?? 250;
  const hb = ix.asmRole('headboard')[0];
  const fb = ix.asmRole('footboard')[0];
  const rails = ix.asmRole('sideRails')[0];
  const comp = (a?: Assembly) => (a?.notes.match(/component:([\w-]+)/)?.[1] ?? null);

  if (family === 'bedComponent') {
    if (rails && !hb && !fb) {
      const gapX = 300;
      const ledgerT = ix.first('slatLedger') ? pl.sizeOf(ix.first('slatLedger')!, null).size.y : 0;
      const r = placeRails(ix, pl, params, { xLeft: 0, xRight: gapX + (params['rail.envelope'] ?? 57) * 2, z0: 0, slatY: ledgerT + 10, standalone: true });
      layoutSkids(ix, pl, gapX * 2, r.length);
      return { bedInfo: null };
    }
    const board: Board = { asm: hb ?? fb ?? null, parts: ix.parts, kind: hb ? 'headboard' : 'footboard' };
    const width = size?.W ?? (board.asm?.dims?.L ?? 1600);
    const { depth } = placeBoard(ix, pl, board, v3(), width, size?.H ?? null, null);
    placeGlides(ix, pl);
    stackLoose(ix, pl, ['slat', 'slatSupportLeg', 'glide'], width + 200, 0);
    layoutSkids(ix, pl, width, depth);
    return { bedInfo: null };
  }

  // Bed set: headboard at the back, rails, footboard at the foot (decorative face outward).
  const width = size?.W ?? hb?.dims?.L ?? 1600;
  const hbRes = placeBoard(ix, pl, { asm: hb ?? null, parts: [], kind: 'headboard' }, v3(), width, ix.content.parameters['hb.height']?.value ?? null, comp(hb));
  const inset = params['rail.inset'] ?? 0;
  const env = params['rail.envelope'] ?? 57;
  const r = placeRails(ix, pl, params, { xLeft: inset, xRight: width - inset, z0: hbRes.depth, slatY, standalone: false });
  const fbZ = hbRes.depth + r.length;
  const fbW = fb?.dims?.L ?? width;
  placeBoard(ix, pl, { asm: fb ?? null, parts: [], kind: 'footboard' }, v3((width - fbW) / 2, 0, fbZ), fbW, null, comp(fb));
  const ledger = ix.first('slatLedger');
  const ledgerW = ledger ? pl.sizeOf(ledger, null).size.x : 0;
  const n = placeSlats(ix, pl, { x0: r.innerX0, x1: r.innerX1, z0: hbRes.depth, length: r.length, slatY });
  placeGlides(ix, pl);
  // Each component ships on its own skids: show them stacked beside the bed.
  stackLoose(ix, pl, ['skidLong', 'skidShort', 'skidBlock', 'glide'], width + 300, 0);
  const railSpan = r.innerX1 - r.innerX0;
  void env;
  return {
    bedInfo: {
      width,
      railSpan,
      ledgerSpan: railSpan - 2 * ledgerW,
      railLength: r.length,
      railInnerX0: r.innerX0,
      railInnerX1: r.innerX1,
      slatY,
      hasLedger: r.hasLedger,
      slatCount: n,
    },
  };
}
