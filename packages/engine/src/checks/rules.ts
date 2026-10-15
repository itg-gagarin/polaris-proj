import type { Finding, Part, PatchOp, Confidence } from '@bom/domain';
import { normalizeName, BASE_POSITIONS } from '@bom/dictionary';
import { worldSize } from '../geometry';
import { isGeometric, isVisible } from '../model';
import type { CheckContext, CheckRule } from './types';
import { finding, fixPatch, mm, r1, setDim, ext, setAxis } from './util';

const CASE = ['caseWithDrawers', 'caseWithDoors', 'bookcase'] as const;
const BEDS = ['bed', 'bedComponent'] as const;

const name = (p: Part | undefined) => (p ? `"${p.originalName}"` : '—');

/* ------------------------------------------------------------------ */
export const clashRule: CheckRule = {
  id: 'clash',
  title: 'Part clash',
  team: 'engineering',
  run(ctx) {
    // A moving assembly (drawer, door) hitting one carcass part is one problem, however many of its pieces touch.
    const grouped = new Map<string, { asmId: string; stat: string; parts: Set<string>; depth: number; places: number; at: (typeof ctx.clashes)[number]['at']; conf: Confidence }>();
    const rest: typeof ctx.clashes = [];
    for (const c of ctx.clashes) {
      if (!c.moving) {
        rest.push(c);
        continue;
      }
      const pa = ctx.ix.byId.get(c.partA)!;
      const pb = ctx.ix.byId.get(c.partB)!;
      const movingIsA = ctx.ix.asm(pa)?.role === 'drawer' || ctx.ix.asm(pa)?.role === 'door' || pa.role === 'slide' || pa.role === 'knob' || pa.role === 'handle';
      const mover = movingIsA ? pa : pb;
      const stat = movingIsA ? pb : pa;
      const asmId = mover.role === 'slide' || mover.role === 'knob' || mover.role === 'handle' ? ctx.ix.asmRole('drawer')[0]?.id ?? mover.id : mover.assemblyId ?? mover.id;
      const k = `${asmId}|${stat.id}`;
      const g = grouped.get(k) ?? { asmId, stat: stat.id, parts: new Set<string>(), depth: 0, places: 0, at: c.at, conf: c.confidence };
      g.parts.add(mover.id);
      g.places += c.pairs;
      if (c.depth > g.depth) {
        g.depth = c.depth;
        g.at = c.at;
      }
      grouped.set(k, g);
    }
    const out = [...grouped.values()].map((g) => {
      const asm = ctx.ix.asmById.get(g.asmId);
      const stat = ctx.ix.byId.get(g.stat);
      const movers = [...g.parts].map((id) => ctx.ix.byId.get(id)!.originalName.trim());
      return finding(clashRule, {
        severity: 'fail',
        confidence: g.conf,
        partIds: [...g.parts, g.stat],
        disc: `moving:${g.asmId}`,
        message: `${asm ? `"${asm.originalName.trim()}"` : 'A moving part'} hits ${name(stat)} by up to ${mm(g.depth)} mm in ${g.places} place(s) (${movers.join(', ')}).`,
        numbers: { overlap: r1(g.depth), places: g.places },
        at: g.at,
      });
    });
    return out.concat(rest.map((c) => {
      const a = ctx.ix.byId.get(c.partA);
      const b = ctx.ix.byId.get(c.partB);
      return finding(clashRule, {
        severity: 'fail',
        confidence: c.confidence,
        partIds: [c.partA, c.partB],
        message: `${name(a)} and ${name(b)} overlap by ${mm(c.depth)} mm${c.pairs > 1 ? ` in ${c.pairs} places` : ''}${c.allowed ? ` (joint allows ${mm(c.allowed)} mm)` : ' and no joint is declared'}${c.moving ? ' — a moving part hits the carcass' : ''}.`,
        numbers: { overlap: r1(c.depth), allowed: c.allowed, places: c.pairs },
        at: c.at,
      });
    }));
  },
};

/* ------------------------------------------------------------------ */
function drawerGroups(ctx: CheckContext) {
  return ctx.ix.asmRole('drawer').map((a) => {
    const parts = ctx.ix.partsOf(a);
    const rows = ctx.layout.rows.filter((r) => r.assemblyId === a.id);
    const cell = rows.length ? Math.min(...rows.map((r) => r.cellWidth)) : null;
    return {
      a,
      rows,
      cell,
      front: parts.find((p) => p.role === 'drawerFront'),
      trims: parts.filter((p) => p.role === 'drawerFrontTrim'),
      fb: parts.find((p) => p.role === 'drawerBoxFrontBack'),
      side: parts.find((p) => p.role === 'drawerSide'),
      bottom: parts.find((p) => p.role === 'drawerBottom'),
    };
  });
}

export const drawerSlideRule: CheckRule = {
  id: 'drawer-box-vs-slide',
  title: 'Drawer box vs slide',
  team: 'hardware',
  families: [...CASE],
  run(ctx) {
    if (!ctx.ix.qty('slide') && !ctx.content.assumptions.slideType) return [];
    const sc = ctx.params.slideClearance ?? ctx.t.slideClearance;
    const joint = String(ctx.content.assumptions.boxJoint?.value ?? 'sides-inside');
    const out: Finding[] = [];
    for (const g of drawerGroups(ctx)) {
      if (!g.fb || !g.cell) continue;
      const sideT = g.side ? ext(g.side, 'x') : 0;
      const fbW = ext(g.fb, 'x');
      const box = joint === 'sides-inside' ? fbW : fbW + 2 * sideT;
      const expected = g.cell - 2 * sc;
      const diff = box - expected;
      if (Math.abs(diff) <= ctx.t.slideTolerance) continue;
      const ops: PatchOp[] = [setAxis(g.fb, 'x', joint === 'sides-inside' ? expected : expected - 2 * sideT)];
      if (g.bottom) ops.push(setAxis(g.bottom, 'x', ext(g.bottom, 'x') - diff));
      out.push(
        finding(drawerSlideRule, {
          severity: 'fail',
          confidence: 'medium',
          partIds: [g.fb.id, ...(g.side ? [g.side.id] : [])],
          disc: g.a.id,
          message: `"${g.a.originalName.trim()}": box outside width ${mm(box)} mm, but opening ${mm(g.cell)} − 2 × ${mm(sc)} slide clearance = ${mm(expected)} mm (${diff > 0 ? 'too wide' : 'too narrow'} by ${mm(Math.abs(diff) / 2)} mm per side, tolerance ±${ctx.t.slideTolerance}).`,
          numbers: { box: r1(box), opening: r1(g.cell), clearance: sc, expected: r1(expected), perSide: r1(diff / 2) },
          assumptionKeys: ['slideClearance', 'boxJoint', 'opening.width'],
          fix: fixPatch(drawerSlideRule, ops, `Drawer box width ${mm(box)} → ${mm(expected)} to fit the slides`, 'medium'),
        }),
      );
    }
    return out;
  },
};

export const frontWidthRule: CheckRule = {
  id: 'front-width',
  title: 'Front width',
  team: 'design',
  families: [...CASE],
  run(ctx) {
    const reveal = ctx.params.reveal ?? ctx.t.reveal;
    const style = String(ctx.content.assumptions.frontStyle?.value ?? 'inset');
    const out: Finding[] = [];
    for (const g of drawerGroups(ctx)) {
      if (!g.front || !g.cell) continue;
      const f = ext(g.front, 'x');
      const expected = style === 'overlay' ? g.cell + 2 * (ctx.params['overlay.cover'] ?? 10) : g.cell - 2 * reveal;
      const diff = f - expected;
      const tooWide = style !== 'overlay' && f > g.cell;
      if (Math.abs(diff) <= ctx.t.revealTolerance && !tooWide) continue;
      const ops: PatchOp[] = [setAxis(g.front, 'x', expected), ...g.trims.map((t) => setAxis(t, 'x', expected))];
      out.push(
        finding(frontWidthRule, {
          severity: 'fail',
          confidence: 'medium',
          partIds: [g.front.id],
          disc: g.a.id,
          message:
            style === 'overlay'
              ? `"${g.a.originalName.trim()}": overlay front ${mm(f)} mm should cover the ${mm(g.cell)} mm opening plus the case edge (${mm(expected)} mm).`
              : `"${g.a.originalName.trim()}": front ${mm(f)} mm in ${mm(g.cell)} mm openings — inset with ${mm(reveal)} mm reveal needs ${mm(expected)} mm (${diff > 0 ? 'too wide' : 'too narrow'} by ${mm(Math.abs(diff))}).`,
          numbers: { front: f, opening: r1(g.cell), reveal, expected: r1(expected) },
          assumptionKeys: ['frontStyle', 'reveal', 'opening.width', 'stile.width'],
          fix: fixPatch(frontWidthRule, ops, `Front width ${mm(f)} → ${mm(expected)}`, 'medium'),
        }),
      );
    }
    return out;
  },
};

export const frontStackRule: CheckRule = {
  id: 'front-stack-height',
  title: 'Front stack height',
  team: 'design',
  families: [...CASE],
  run(ctx) {
    const ci = ctx.layout.caseInfo;
    if (!ci || !ctx.layout.rows.length) return [];
    const over = ci.stackHeight - ci.zoneHeight;
    const rows = ctx.layout.rows.length;
    if (Math.abs(over) <= ctx.t.revealTolerance * rows) return [];
    const fronts = drawerGroups(ctx).flatMap((g) => (g.front ? [g.front] : []));
    const per = over / rows;
    const reveal = ctx.params.reveal ?? ctx.t.reveal;
    return [
      finding(frontStackRule, {
        severity: over > 0 ? 'fail' : 'warn',
        confidence: 'medium',
        partIds: fronts.map((f) => f.id),
        message:
          over > 0
            ? `Fronts + rails + reveals need ${mm(ci.stackHeight)} mm but the opening (front profiles) is ${mm(ci.zoneHeight)} mm: ${mm(over)} mm over across ${rows} rows.`
            : `Fronts + rails + ${mm(reveal)} mm reveals use ${mm(ci.stackHeight)} of ${mm(ci.zoneHeight)} mm: ${mm(-over)} mm of extra gap across ${rows} rows.`,
        numbers: { stack: r1(ci.stackHeight), opening: r1(ci.zoneHeight), over: r1(over), rows },
        assumptionKeys: ['frontStyle', 'reveal', 'opening.height', 'rail.thickness'],
        fix: over > 0 ? fixPatch(frontStackRule, fronts.map((f) => setAxis(f, 'y', ext(f, 'y') - per)), `Reduce each front height by ${mm(per)} mm so ${rows} rows fit`, 'medium') : null,
      }),
    ];
  },
};

export const frontsAlignRule: CheckRule = {
  id: 'fronts-align',
  title: 'Fronts align',
  team: 'design',
  families: [...CASE],
  run(ctx) {
    const rows = ctx.layout.rows;
    if (rows.length < 2) return [];
    const edges = rows.map((r) => {
      const fronts = ctx.layout.instances.filter((i) => i.role === 'drawerFront' && r.slots.some((s) => s.assemblyId === i.assemblyId && s.asmInstance === i.asmInstance));
      return fronts.length ? { left: Math.min(...fronts.map((f) => f.min.x)), right: Math.max(...fronts.map((f) => f.max.x)), r } : null;
    }).filter(Boolean) as { left: number; right: number; r: (typeof rows)[number] }[];
    if (edges.length < 2) return [];
    const devL = Math.max(...edges.map((e) => e.left)) - Math.min(...edges.map((e) => e.left));
    const devR = Math.max(...edges.map((e) => e.right)) - Math.min(...edges.map((e) => e.right));
    const dev = Math.max(devL, devR);
    if (dev <= ctx.t.frontAlignTolerance) return [];
    const ids = [...new Set(drawerGroups(ctx).flatMap((g) => (g.front ? [g.front.id] : [])))];
    return [
      finding(frontsAlignRule, {
        severity: 'fail',
        confidence: 'medium',
        partIds: ids,
        message: `Outer edges of the drawer rows are off by up to ${mm(dev)} mm (left ${mm(devL)}, right ${mm(devR)}).`,
        numbers: { offBy: r1(dev), left: r1(devL), right: r1(devR) },
        assumptionKeys: ['stile.width', 'reveal'],
      }),
    ];
  },
};

/* ------------------------------------------------------------------ */
export const fitRule: CheckRule = {
  id: 'fit',
  title: 'Divider / back / bottom fit',
  team: 'engineering',
  families: [...CASE],
  run(ctx) {
    const out: Finding[] = [];
    const g = ctx.params.grooveAllowance ?? ctx.t.grooveAllowance;
    const tol = ctx.t.fitTolerance;
    const W = ctx.params['case.width'];
    const back = ctx.ix.first('back');
    if (back && W) {
      const legBW = ctx.params['leg.backWidth'] ?? 0;
      const stile = ctx.ix.first('backStile');
      const opening = W - 2 * legBW - 2 * (stile ? ext(stile, 'x') : 0);
      const outer = W - 2 * legBW + (stile ? 0 : 2 * g);
      const bw = ext(back, 'x');
      if (bw < opening - tol || bw > outer + tol) {
        const target = Math.min(Math.max(bw, opening), outer);
        out.push(
          finding(fitRule, {
            severity: 'fail',
            confidence: 'medium',
            partIds: [back.id],
            disc: 'back-width',
            message: `Back panel ${name(back)} is ${mm(bw)} mm wide; the back opening is ${mm(opening)} mm${stile ? ` between the back stiles` : ''} and it may reach ${mm(outer)} mm.`,
            numbers: { width: bw, opening: r1(opening), max: r1(outer) },
            assumptionKeys: ['grooveAllowance'],
            fix: fixPatch(fitRule, [setAxis(back, 'x', target)], `Back panel width ${mm(bw)} → ${mm(target)}`, 'medium'),
          }),
        );
      }
      const side = ctx.ix.first('sidePanel');
      if (side && Math.abs(ext(back, 'y') - ext(side, 'y')) > 2 * g + tol) {
        out.push(
          finding(fitRule, {
            severity: 'warn',
            confidence: 'low',
            partIds: [back.id, side.id],
            disc: 'back-height',
            message: `Back panel height ${mm(ext(back, 'y'))} mm vs side panel ${mm(ext(side, 'y'))} mm — differs by ${mm(Math.abs(ext(back, 'y') - ext(side, 'y')))} mm.`,
            numbers: { back: ext(back, 'y'), side: ext(side, 'y') },
          }),
        );
      }
    }
    const joint = String(ctx.content.assumptions.boxJoint?.value ?? 'sides-inside');
    for (const d of drawerGroups(ctx)) {
      if (!d.bottom || !d.fb) continue;
      const sideT = d.side ? ext(d.side, 'x') : 0;
      const inner = joint === 'sides-inside' ? ext(d.fb, 'x') - 2 * sideT : ext(d.fb, 'x');
      const expected = inner + 2 * g;
      const bw = ext(d.bottom, 'x');
      if (Math.abs(bw - expected) > tol) {
        out.push(
          finding(fitRule, {
            severity: 'fail',
            confidence: 'medium',
            partIds: [d.bottom.id],
            disc: `bottom-${d.a.id}`,
            message: `Drawer bottom ${name(d.bottom)} is ${mm(bw)} mm; box inside width ${mm(inner)} + 2 × ${mm(g)} groove = ${mm(expected)} mm.`,
            numbers: { bottom: bw, inner: r1(inner), groove: g, expected: r1(expected) },
            assumptionKeys: ['boxJoint', 'grooveAllowance'],
            fix: fixPatch(fitRule, [setAxis(d.bottom, 'x', expected)], `Drawer bottom ${mm(bw)} → ${mm(expected)}`, 'medium'),
          }),
        );
      }
    }
    for (const dv of ctx.ix.role('divider')) {
      const h = ctx.params['opening.height'];
      if (h && Math.abs(dv.dims.L - h) > 2 * g + tol)
        out.push(finding(fitRule, { severity: 'fail', confidence: 'medium', partIds: [dv.id], disc: 'divider', message: `Divider ${name(dv)} is ${mm(dv.dims.L)} mm; the inner height is ${mm(h)} mm.`, numbers: { divider: dv.dims.L, inner: h }, fix: fixPatch(fitRule, [setDim(dv, 'L', h)], `Divider height → ${mm(h)}`, 'medium') }));
    }
    return out;
  },
};

const SLIDE_LENGTHS = [250, 300, 350, 400, 450, 500, 550, 600];

export const runnerRule: CheckRule = {
  id: 'runner-length',
  title: 'Runner / slide length',
  team: 'hardware',
  families: [...CASE],
  run(ctx) {
    const ci = ctx.layout.caseInfo;
    if (!ci) return [];
    const out: Finding[] = [];
    const boxDepths = ctx.layout.rows.flatMap((r) => r.slots.map((s) => (s.box ? s.box.max.z - s.box.min.z : Infinity)));
    const minBox = boxDepths.length ? Math.min(...boxDepths) : Infinity;
    const frontT = ctx.ix.first('drawerFront') ? ext(ctx.ix.first('drawerFront')!, 'z') : 0;
    const space = ci.frontZ - frontT - ci.backZ;
    for (const s of ctx.ix.role('slide')) {
      const L = ext(s, 'z');
      const limit = Math.min(minBox, space);
      if (L > limit) {
        const std = [...SLIDE_LENGTHS].reverse().find((x) => x <= limit);
        out.push(
          finding(runnerRule, {
            severity: 'fail',
            confidence: 'high',
            partIds: [s.id],
            message: `Slide ${name(s)} is ${mm(L)} mm long; the drawer box is ${mm(minBox)} mm deep and the space to the back is ${mm(space)} mm.`,
            numbers: { slide: L, box: r1(minBox), space: r1(space) },
            fix: std ? fixPatch(runnerRule, [setAxis(s, 'z', std)], `Use ${std} mm slides`, 'medium') : null,
          }),
        );
      }
    }
    const frameZ = ci.frontZ - (ctx.ix.first('sideInnerProfile')?.dims.T ?? 0);
    const runSpace = frameZ - ci.backZ;
    for (const r of [...ctx.ix.role('runner'), ...ctx.ix.role('midRunner')]) {
      const rl = ext(r, 'z');
      if (rl > runSpace + ctx.t.fitTolerance) {
        out.push(
          finding(runnerRule, {
            severity: 'fail',
            confidence: 'medium',
            partIds: [r.id],
            message: `Runner ${name(r)} is ${mm(rl)} mm in ${mm(runSpace)} mm between the front frame and the back.`,
            numbers: { runner: rl, space: r1(runSpace) },
            assumptionKeys: ['counterweight'],
            fix: fixPatch(runnerRule, [setAxis(r, 'z', runSpace)], `Runner ${mm(rl)} → ${mm(runSpace)}`, 'medium'),
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ */
export const slatRule: CheckRule = {
  id: 'bed-slats',
  title: 'Bed slats',
  team: 'engineering',
  families: [...BEDS],
  run(ctx) {
    const b = ctx.layout.bedInfo;
    const slats = ctx.ix.role('slat');
    if (!slats.length) return [];
    if (!b) {
      return [
        finding(slatRule, {
          severity: 'info',
          confidence: 'low',
          partIds: slats.map((s) => s.id),
          message: 'Slats ship with this component; span, bearing and gaps are checked in the bed set (headboard + rails + footboard).',
        }),
      ];
    }
    const out: Finding[] = [];
    if (!b.hasLedger) {
      out.push(finding(slatRule, { severity: 'fail', confidence: 'high', partIds: slats.map((s) => s.id), disc: 'ledger', message: 'Slats have no ledger (slat support) on the side rails.' }));
    }
    for (const s of slats) {
      const L = ext(s, 'x');
      const maxL = b.railSpan - 2 * ctx.t.slatEndClearance;
      const bearing = (L - b.ledgerSpan) / 2;
      const ledgerW = (b.railSpan - b.ledgerSpan) / 2;
      const problems: string[] = [];
      if (L > maxL) problems.push(`longer than the ${mm(b.railSpan)} mm clear span − 2 × ${ctx.t.slatEndClearance} mm (${mm(maxL)})`);
      if (b.hasLedger && bearing < ctx.t.slatBearingMin) problems.push(`only ${mm(bearing)} mm bearing on each ledger (needs ${ctx.t.slatBearingMin}–${ctx.t.slatBearingMax})`);
      if (b.hasLedger && bearing > ledgerW + 0.5) problems.push(`runs past the ${mm(ledgerW)} mm ledger into the rail`);
      if (problems.length) {
        const target = Math.min(maxL, b.ledgerSpan + 2 * Math.min(ledgerW, (ctx.t.slatBearingMin + ctx.t.slatBearingMax) / 2));
        out.push(
          finding(slatRule, {
            severity: 'fail',
            confidence: 'medium',
            partIds: [s.id],
            disc: 'length',
            message: `Slat ${name(s)} ${mm(L)} mm: ${problems.join('; ')}.`,
            numbers: { slat: L, span: r1(b.railSpan), ledgerSpan: r1(b.ledgerSpan), bearing: r1(bearing) },
            assumptionKeys: ['railAttachment', 'rail.envelope', 'ledger.protrusion'],
            fix: fixPatch(slatRule, [setAxis(s, 'x', target)], `Slat length ${mm(L)} → ${mm(target)}`, 'medium'),
          }),
        );
      }
      const n = b.slatCount;
      const gap = n ? (b.railLength - n * ext(s, 'z')) / (n + 1) : Infinity;
      if (gap > ctx.t.slatGapMax) {
        const support = String(ctx.content.assumptions.mattressSupport?.value ?? 'unknown');
        const need = Math.ceil((b.railLength - ctx.t.slatGapMax) / (ext(s, 'z') + ctx.t.slatGapMax));
        out.push(
          finding(slatRule, {
            severity: support === 'foundation' ? 'info' : 'warn',
            confidence: 'medium',
            partIds: [s.id],
            disc: 'gap',
            message: `${n} slats over ${mm(b.railLength)} mm leave ${mm(gap)} mm gaps (max ${ctx.t.slatGapMax} mm for slats-only support — verify with the mattress maker). ${support === 'foundation' ? 'OK with a foundation.' : `Needs a foundation / bunkie board, or about ${need} slats.`}`,
            numbers: { gap: r1(gap), max: ctx.t.slatGapMax, slats: n, needed: need },
            assumptionKeys: ['mattressSupport'],
          }),
        );
      }
    }
    return out;
  },
};

export const mattressRule: CheckRule = {
  id: 'mattress-fit',
  title: 'Mattress fit',
  team: 'design',
  families: ['bed'],
  run(ctx) {
    const b = ctx.layout.bedInfo;
    if (!b) return [];
    const mw = ctx.params['mattress.width'];
    const ml = ctx.params['mattress.length'];
    const c = ctx.t.mattressClearance;
    const out: Finding[] = [];
    const rails = ctx.ix.role('bedRail').map((p) => p.id);
    if (mw && b.railSpan < mw + c)
      out.push(finding(mattressRule, { severity: 'fail', confidence: 'medium', partIds: rails, disc: 'width', message: `Span between rails ${mm(b.railSpan)} mm < ${String(ctx.content.assumptions.mattressSize?.value)} mattress ${mm(mw)} + ${c} mm clearance.`, numbers: { span: r1(b.railSpan), mattress: mw, clearance: c }, assumptionKeys: ['mattressSize', 'railAttachment'] }));
    if (ml && b.railLength < ml + c)
      out.push(finding(mattressRule, { severity: 'fail', confidence: 'high', partIds: rails, disc: 'length', message: `Rail length ${mm(b.railLength)} mm < mattress ${mm(ml)} + ${c} mm (${mm(b.railLength - ml)} mm end clearance).`, numbers: { length: r1(b.railLength), mattress: ml, clearance: c }, assumptionKeys: ['mattressSize'] }));
    return out;
  },
};

/* ------------------------------------------------------------------ */
const LR = new Set(['kiri', 'kanan']);
export const pairsRule: CheckRule = {
  id: 'left-right-pairs',
  title: 'Left/right pairs',
  team: 'engineering',
  run(ctx) {
    const groups = new Map<string, Part[]>();
    for (const p of ctx.ix.parts) {
      const toks = normalizeName(p.originalName).split(' ');
      const pos = (p.position ?? '').toLowerCase().split(/\s+/);
      if (!toks.some((t) => LR.has(t)) && !pos.some((t) => LR.has(t))) continue;
      const base = toks.filter((t) => !LR.has(t)).join(' ');
      const k = `${p.stdCode ?? ''}|${base}`;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const out: Finding[] = [];
    for (const [k, ps] of groups) {
      if (ps.length < 2 || ps.some((p) => p.asymmetric)) continue;
      const [a, ...rest] = ps;
      for (const b of rest) {
        const diffs = (['T', 'W', 'L'] as const).filter((d) => Math.abs(a.dims[d] - b.dims[d]) > ctx.t.pairTolerance);
        if (!diffs.length && a.qty === b.qty) continue;
        out.push(
          finding(pairsRule, {
            severity: 'fail',
            confidence: 'high',
            partIds: [a.id, b.id],
            disc: k,
            message: `${name(a)} and ${name(b)} differ: ${diffs.map((d) => `${d} ${mm(a.dims[d])} vs ${mm(b.dims[d])}`).join(', ')}${a.qty !== b.qty ? `, qty ${a.qty} vs ${b.qty}` : ''}. Mark as asymmetric if intended.`,
            numbers: Object.fromEntries(diffs.map((d) => [d, r1(a.dims[d] - b.dims[d])])),
            fix: fixPatch(pairsRule, diffs.map((d) => setDim(b, d, a.dims[d])), `Make ${b.originalName} equal to ${a.originalName}`, 'medium'),
          }),
        );
      }
    }
    return out;
  },
};

export const quantityRule: CheckRule = {
  id: 'quantity',
  title: 'Quantity',
  team: 'engineering',
  run(ctx) {
    const out: Finding[] = [];
    for (const r of ctx.layout.requirements) {
      if (r.have === r.required || (!r.partIds.length && !r.required)) continue;
      const single = r.partIds.length === 1 ? ctx.ix.byId.get(r.partIds[0]) : undefined;
      out.push(
        finding(quantityRule, {
          severity: r.have === 0 && r.required > 0 ? r.severity : r.severity,
          confidence: r.confidence,
          partIds: r.partIds,
          disc: `${r.role}:${r.reason}`,
          message: `${r.role}: BOM has ${r.have}, the layout needs ${r.required} (${r.reason}).`,
          numbers: { have: r.have, required: r.required },
          fix: single && r.required > 0 ? fixPatch(quantityRule, [{ op: 'setField', partId: single.id, field: 'qty', value: r.required, from: single.qty }], `${single.originalName} qty ${single.qty} → ${r.required}`, r.confidence) : null,
        }),
      );
    }
    for (const p of ctx.ix.parts) {
      const a = ctx.ix.asm(p);
      if (!a || a.qty <= 1 || !isGeometric(p)) continue;
      const per = p.qty / a.qty;
      if (Math.abs(per - Math.round(per)) > 1e-9)
        out.push(finding(quantityRule, { severity: 'fail', confidence: 'high', partIds: [p.id], disc: 'per-assembly', message: `${name(p)} qty ${p.qty} does not divide evenly over ${a.qty} × "${a.originalName.trim()}".`, numbers: { qty: p.qty, assemblies: a.qty } }));
    }
    return out;
  },
};

export const missingRule: CheckRule = {
  id: 'missing-parts',
  title: 'Missing parts',
  team: 'engineering',
  run(ctx) {
    const out: Finding[] = [];
    const has = (r: string) => ctx.ix.qty(r) > 0;
    const drawers = ctx.ix.asmRole('drawer').reduce((s, a) => s + a.qty, 0);
    const add = (disc: string, severity: Finding['severity'], confidence: Confidence, message: string, team?: Finding['ownerTeam']) =>
      out.push(finding(missingRule, { severity, confidence, partIds: [], disc, message, ownerTeam: team }));
    if (drawers && !has('slide') && !has('runner')) add('slides', 'fail', 'high', `${drawers} drawers but no slides or runners on the BOM.`, 'hardware');
    if (drawers && !has('knob') && !has('handle')) add('pulls', 'warn', 'medium', `${drawers} drawers but no knobs or handles on the BOM.`, 'hardware');
    const setup = `${ctx.content.header.setup ?? ''}`.toLowerCase();
    if (/side mount|full ext/.test(setup) && !has('slide')) add('setup-slides', 'fail', 'high', `Header SET UP says "${ctx.content.header.setup}" but no slides are listed.`, 'hardware');
    const legs = has('legFront') || has('legBack') || has('tableLeg') || has('bedPost') || has('lowerLeg');
    if (legs && !has('glide')) add('glides', 'info', 'low', 'Legs without glides / levelers.', 'hardware');
    if (!has('skidLong') && !has('skidShort') && !ctx.ix.parts.some((p) => p.role === 'carton')) add('packing', 'info', 'low', 'No pallet skid or carton on the BOM.', 'packing');
    const notes = [ctx.content.header.sheetNote ?? '', ...ctx.ix.parts.map((p) => p.notes)].join(' ').toLowerCase();
    const keywords: [RegExp, string[], string][] = [
      [/\b(kaki|feet|foot|bun ?feet)\b/, ['legFront', 'legBack', 'tableLeg', 'bedPost', 'lowerLeg', 'centerLeg', 'legSupport'], 'feet / legs'],
      [/\b(knob|knop|handle|tarikan)\b/, ['knob', 'handle'], 'knobs / handles'],
      [/\b(ledger|klos slat)\b/, ['slatLedger'], 'slat ledger'],
      [/\b(engsel|hinge)\b/, ['hinge'], 'hinges'],
    ];
    for (const [re, roles, label] of keywords) if (re.test(notes) && !roles.some(has)) add(`note-${label}`, 'warn', 'low', `Notes mention ${label}, but no such part is on the BOM.`);
    return out;
  },
};

export const finishRule: CheckRule = {
  id: 'finish-coverage',
  title: 'Finish coverage',
  team: 'finishing',
  run(ctx) {
    const missing = new Map<string, Part[]>();
    for (const p of ctx.ix.parts) {
      if (!isGeometric(p) || !isVisible(p) || p.kind === 'hardware' || p.kind === 'packing') continue;
      if (p.finishCode || ctx.ix.asm(p)?.finishCode) continue;
      const k = p.assemblyId ?? '';
      missing.set(k, [...(missing.get(k) ?? []), p]);
    }
    return [...missing.entries()].map(([asmId, ps]) =>
      finding(finishRule, {
        severity: 'fail',
        confidence: 'high',
        partIds: ps.map((p) => p.id),
        disc: asmId,
        message: `${ps.length} visible part(s) in "${ctx.ix.asmById.get(asmId)?.name ?? '—'}" have no finish code: ${ps.slice(0, 6).map((p) => p.originalName).join(', ')}${ps.length > 6 ? '…' : ''}.`,
        numbers: { parts: ps.length },
      }),
    );
  },
};

export const hardwareRule: CheckRule = {
  id: 'hardware-completeness',
  title: 'Hardware completeness',
  team: 'hardware',
  run(ctx) {
    const out: Finding[] = [];
    const drawers = ctx.ix.asmRole('drawer').reduce((s, a) => s + a.qty, 0);
    const slides = ctx.ix.role('slide');
    const pairs = slides.reduce((s, p) => s + (p.unit === 'pair' ? p.qty : p.qty / 2), 0);
    if (drawers && slides.length && pairs < drawers) {
      const p = slides[0];
      out.push(
        finding(hardwareRule, {
          severity: 'fail',
          confidence: 'medium',
          partIds: slides.map((s) => s.id),
          disc: 'slides',
          message: `${drawers} drawers need ${drawers} slide pairs; the BOM has ${pairs}.`,
          numbers: { drawers, pairs },
          assumptionKeys: ['slideType'],
          fix: fixPatch(hardwareRule, [{ op: 'setField', partId: p.id, field: 'qty', value: p.unit === 'pair' ? p.qty + (drawers - pairs) : p.qty + 2 * (drawers - pairs), from: p.qty }], `Slides ${pairs} → ${drawers} pairs`, 'medium'),
        }),
      );
    }
    const doors = ctx.ix.qty('door') + ctx.ix.asmRole('door').reduce((s, a) => s + a.qty, 0);
    const hinges = ctx.ix.qty('hinge');
    if (doors && hinges < 2 * doors) out.push(finding(hardwareRule, { severity: 'fail', confidence: 'medium', partIds: ctx.ix.role('hinge').map((h) => h.id), disc: 'hinges', message: `${doors} door(s) need at least ${2 * doors} hinges; the BOM has ${hinges}.`, numbers: { doors, hinges } }));
    const noSku = ctx.ix.parts.filter((p) => p.kind === 'hardware' && !p.hardwareSku);
    if (noSku.length)
      out.push(finding(hardwareRule, { severity: 'warn', confidence: 'high', partIds: noSku.map((p) => p.id), disc: 'sku', message: `${noSku.length} hardware line(s) without a SKU: ${noSku.slice(0, 8).map((p) => p.originalName).join(', ')}${noSku.length > 8 ? '…' : ''}.`, numbers: { lines: noSku.length } }));
    return out;
  },
};

export const packingRule: CheckRule = {
  id: 'packing',
  title: 'Packing',
  team: 'packing',
  run(ctx) {
    const out: Finding[] = [];
    const size = ctx.content.header.productSize;
    const pk = ctx.content.header.packingSizes[0];
    const longs = ctx.ix.role('skidLong');
    const shorts = ctx.ix.role('skidShort');
    if (size && (longs.length || shorts.length)) {
      const minLong = longs.length ? Math.min(...longs.map((p) => p.dims.L)) : Infinity;
      const minShort = shorts.length ? Math.min(...shorts.map((p) => p.dims.L)) : Infinity;
      const needL = size.W + 2 * ctx.t.skidMinOverhang;
      const needS = size.D + 2 * ctx.t.skidMinOverhang;
      if (minLong < needL) out.push(finding(packingRule, { severity: 'fail', confidence: 'high', partIds: longs.map((p) => p.id), disc: 'long', message: `Long skid ${mm(minLong)} mm is shorter than the product width ${mm(needL)} mm.`, numbers: { skid: minLong, need: needL } }));
      if (minShort < needS) out.push(finding(packingRule, { severity: 'fail', confidence: 'high', partIds: shorts.map((p) => p.id), disc: 'short', message: `Short skid ${mm(minShort)} mm is shorter than the product depth ${mm(needS)} mm.`, numbers: { skid: minShort, need: needS } }));
    }
    if (size && pk) {
      // Flat-packed products (headboards) go in on their side: compare sorted extents.
      const a = [pk.W, pk.D, pk.H].sort((x, y) => x - y);
      const b = [size.W, size.D, size.H].sort((x, y) => x - y);
      const fits = a.every((v, i) => v >= b[i]);
      if (!fits)
        out.push(
          finding(packingRule, {
            severity: 'warn',
            confidence: 'medium',
            partIds: [],
            disc: 'carton',
            message: `Carton ${pk.W}×${pk.D}×${pk.H} mm is smaller than the assembled product ${size.W}×${size.D}×${size.H} mm — fine only if it ships knocked down (KD).`,
            numbers: { ...pk },
            assumptionKeys: ['knockDown'],
          }),
        );
    }
    const h = ctx.content.header;
    if (pk || h.grossWeightKg) {
      const cbm = pk ? (pk.W * pk.D * pk.H) / 1e9 : h.cbm ?? 0;
      out.push(
        finding(packingRule, {
          severity: 'info',
          confidence: 'high',
          partIds: [],
          disc: 'summary',
          message: `Packed ${pk ? `${pk.W}×${pk.D}×${pk.H} mm` : ''} = ${cbm.toFixed(3)} m³${h.grossWeightKg ? `, GW ${h.grossWeightKg.toFixed(1)} kg` : ''}${h.netWeightKg ? ` (NW ${h.netWeightKg.toFixed(1)})` : ''}${h.loadQty40HC ? `, ${h.loadQty40HC} per 40'HC` : ''}.`,
          numbers: { cbm: Math.round(cbm * 1000) / 1000, gw: h.grossWeightKg ?? 0, nw: h.netWeightKg ?? 0, load40hc: h.loadQty40HC ?? 0 },
        }),
      );
    }
    return out;
  },
};

export const tipOverRule: CheckRule = {
  id: 'tip-over',
  title: 'Tip-over (market rule)',
  team: 'qc',
  families: ['caseWithDrawers', 'caseWithDoors', 'bookcase'],
  run(ctx) {
    const H = ctx.params['case.height'] ?? ctx.content.header.productSize?.H;
    if (!H || H < ctx.t.tipOverHeight) return [];
    const markets = String(ctx.content.assumptions.market?.value ?? 'unknown').toUpperCase();
    const anti = ctx.ix.role('antiTip');
    const base = `Clothing storage ${mm(H)} mm tall (≥ ${ctx.t.tipOverHeight} mm / 27 in)`;
    if (markets.includes('US')) {
      return [
        finding(tipOverRule, {
          severity: anti.length ? 'info' : 'fail',
          confidence: 'medium',
          partIds: anti.map((p) => p.id),
          message: anti.length ? `${base}: anti-tip kit is on the BOM; a stability test is still required for the US market. Rule details need verification against the current regulation.` : `${base} sold in the US needs an anti-tip kit and a stability test — none on the BOM. Needs verification against the current rule.`,
          numbers: { height: H, threshold: ctx.t.tipOverHeight },
          assumptionKeys: ['market'],
        }),
      ];
    }
    return [
      finding(tipOverRule, {
        severity: markets === 'UNKNOWN' ? 'warn' : 'info',
        confidence: 'low',
        partIds: anti.map((p) => p.id),
        message: `${base}. Target market ${markets === 'UNKNOWN' ? 'is not set' : `is ${markets}`}; if sold in the US it needs an anti-tip kit and a test${anti.length ? ' (kit is on the BOM)' : ''}. Needs verification per market.`,
        numbers: { height: H, threshold: ctx.t.tipOverHeight },
        assumptionKeys: ['market'],
      }),
    ];
  },
};

export const overallRule: CheckRule = {
  id: 'overall-dimensions',
  title: 'Overall dimensions',
  team: 'design',
  families: ['caseWithDrawers', 'caseWithDoors', 'bookcase', 'table', 'bedComponent'],
  run(ctx) {
    const size = ctx.content.header.productSize;
    if (!size) return [];
    const inst = ctx.layout.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && !i.packing && i.kind !== 'hardware' && i.kind !== 'packing');
    if (!inst.length) return [];
    const min = { x: Math.min(...inst.map((i) => i.min.x)), y: Math.min(...inst.map((i) => i.min.y)), z: Math.min(...inst.map((i) => i.min.z)) };
    const max = { x: Math.max(...inst.map((i) => i.max.x)), y: Math.max(...inst.map((i) => i.max.y)), z: Math.max(...inst.map((i) => i.max.z)) };
    const got = { W: max.x - min.x, H: max.y - min.y, D: max.z - min.z };
    const out: Finding[] = [];
    // A pair of side rails ships as one product but the header describes one rail: compare one rail, any orientation.
    const railsOnly = ctx.ix.asmRole('sideRails').length && !ctx.ix.asmRole('headboard').length && !ctx.ix.asmRole('footboard').length;
    if (railsOnly) {
      const one = inst.filter((i) => i.asmInstance === 0 && ctx.ix.asm(ctx.ix.byId.get(i.partId)!)?.role === 'sideRails');
      if (!one.length) return [];
      const e = [Math.max(...one.map((i) => i.max.x)) - Math.min(...one.map((i) => i.min.x)), Math.max(...one.map((i) => i.max.y)) - Math.min(...one.map((i) => i.min.y)), Math.max(...one.map((i) => i.max.z)) - Math.min(...one.map((i) => i.min.z))].sort((a, b) => a - b);
      const h = [size.W, size.D, size.H].sort((a, b) => a - b);
      const worst = Math.max(...e.map((v, k) => Math.abs(v - h[k])));
      if (worst <= ctx.t.overallTolerance) return [];
      return [finding(overallRule, { severity: 'warn', confidence: 'low', partIds: [], disc: 'rail', message: `One rail measures ${e.map(mm).join(' × ')} mm (with the slat ledger as assumed); the product size says ${h.join(' × ')} mm.`, numbers: { worst: r1(worst) }, assumptionKeys: ['railAttachment', 'ledger.protrusion'] })];
    }
    for (const k of ['W', 'D', 'H'] as const) {
      const diff = got[k] - size[k];
      if (Math.abs(diff) <= ctx.t.overallTolerance) continue;
      out.push(
        finding(overallRule, {
          severity: 'fail',
          confidence: 'medium',
          partIds: [],
          disc: k,
          message: `The parts give ${mm(got[k])} mm ${k === 'W' ? 'wide' : k === 'D' ? 'deep' : 'high'}; the product size says ${mm(size[k])} mm (${diff > 0 ? '+' : ''}${mm(diff)}).`,
          numbers: { parts: r1(got[k]), header: size[k], diff: r1(diff) },
        }),
      );
    }
    return out;
  },
};

export const unplacedRule: CheckRule = {
  id: 'unplaced',
  title: 'Unplaced parts',
  team: 'engineering',
  run(ctx) {
    return ctx.layout.unplaced.map((u) => {
      const p = ctx.ix.byId.get(u.partId);
      return finding(unplacedRule, { severity: 'warn', confidence: 'high', partIds: [u.partId], message: `${name(p)} × ${u.count} is in the Unplaced tray: ${u.reason}.`, numbers: { count: u.count } });
    });
  },
};

export const expressionRule: CheckRule = {
  id: 'expression-error',
  title: 'Expression error',
  team: 'engineering',
  run(ctx) {
    return ctx.resolveErrors.map((e) => finding(expressionRule, { severity: 'fail', confidence: 'high', partIds: e.partId ? [e.partId] : [], disc: e.target, message: `${e.target}: ${e.message}` }));
  },
};

/** Volume / weight sanity: catches unit slips (cm typed as mm) on solid parts. */
export const sanityRule: CheckRule = {
  id: 'size-sanity',
  title: 'Size sanity',
  team: 'engineering',
  run(ctx) {
    const out: Finding[] = [];
    const size = ctx.content.header.productSize;
    const maxDim = size ? Math.max(size.W, size.D, size.H) * 1.6 : 4000;
    for (const p of ctx.ix.parts) {
      if (!isGeometric(p) || p.kind === 'packing') continue;
      const s = worldSize(p.dims, p.axisMap);
      const big = Math.max(s.x, s.y, s.z);
      if (p.dims.T <= 0 || p.dims.W <= 0 || p.dims.L <= 0) out.push(finding(sanityRule, { severity: 'fail', confidence: 'high', partIds: [p.id], disc: 'zero', message: `${name(p)} has a zero size (${p.dims.T} × ${p.dims.W} × ${p.dims.L}).` }));
      else if (big > maxDim) out.push(finding(sanityRule, { severity: 'warn', confidence: 'medium', partIds: [p.id], disc: 'big', message: `${name(p)} is ${mm(big)} mm long — larger than the product. Unit slip?`, numbers: { length: big } }));
    }
    void BASE_POSITIONS;
    return out;
  },
};

export const RULES: CheckRule[] = [
  clashRule,
  drawerSlideRule,
  frontWidthRule,
  frontStackRule,
  frontsAlignRule,
  fitRule,
  runnerRule,
  slatRule,
  mattressRule,
  pairsRule,
  quantityRule,
  missingRule,
  finishRule,
  hardwareRule,
  packingRule,
  tipOverRule,
  overallRule,
  unplacedRule,
  expressionRule,
  sanityRule,
];
