/**
 * Layout template: case with drawers (nightstand, chest, dresser). Also used for doors/bookcases
 * as a carcass without drawer rows.
 *
 * World: x = width (0 at left), y = height (0 at floor), z = depth (0 at back, front at z = D).
 */
import type { Part, Vec3, WorkspaceSettings, Assembly } from '@bom/domain';
import { normalizeName } from '@bom/dictionary';
import { v3 } from '../geometry';
import type { ContentIndex } from '../model';
import { instanceCount, type Placer } from './placer';
import type { DrawerRow, DrawerSlot, Layout } from './types';

const EXPLODE = 220;

export function layoutCase(ix: ContentIndex, params: Record<string, number>, settings: WorkspaceSettings, pl: Placer): Pick<Layout, 'rows' | 'caseInfo'> {
  const P = (k: string, d: number) => (Number.isFinite(params[k]) ? params[k] : d);
  const W = P('case.width', 600);
  const D = P('case.depth', 450);
  const legW = P('leg.width', 40);
  const legD = P('leg.depth', legW);
  const legBW = P('leg.backWidth', legW);
  const legBD = P('leg.backDepth', legD);
  const legH = P('leg.height', 700);
  const sideT = P('side.thickness', legW);
  const profW = P('profile.width', 0);
  const openingW = P('opening.width', W - 2 * sideT);
  const zoneH = P('opening.height', legH * 0.75);
  const reveal = P('reveal', settings.thresholds.reveal);
  const railT = P('rail.thickness', 18);
  const stileW = P('stile.width', 0);
  const openingX0 = (W - openingW) / 2;
  const openingX1 = openingX0 + openingW;
  // Horizontal face profiles (same section as the vertical inner profiles) close the face frame
  // above and below the drawer zone.
  const faceProfile = ix.first('frontProfile');
  const faceProfileH = faceProfile ? pl.sizeOf(faceProfile, null).size.y : 0;
  const zoneTop = legH - faceProfileH;
  const zoneBottom = zoneTop - zoneH;
  const sideAsms = ix.asmRole('sideAssembly');
  const sides = sideAsms[0]?.qty ?? 2;

  const leftRight = (i: number) => (i % 2 === 0 ? -1 : 1);
  const xMirror = (left: number, w: number, side: number) => (side < 0 ? left : W - left - w);

  /* ---------------- legs ---------------- */
  for (const p of ix.role('legFront')) {
    for (let i = 0; i < instanceCount(p); i++) {
      const s = pl.sizeOf(p, null).size;
      const side = leftRight(i);
      pl.put(p, i, v3(xMirror(0, s.x, side), 0, D - s.z), { asmInstance: i % 2, explode: v3(side * EXPLODE, 0, 0), envelope: null });
    }
  }
  for (const p of ix.role('legBack')) {
    for (let i = 0; i < instanceCount(p); i++) {
      const s = pl.sizeOf(p, null).size;
      const side = leftRight(i);
      pl.put(p, i, v3(xMirror(0, s.x, side), 0, 0), { asmInstance: i % 2, explode: v3(side * EXPLODE, 0, 0), envelope: null });
    }
  }

  /* ---------------- side assemblies ---------------- */
  const sideFree0 = legBD;
  const sideFree1 = D - legD;
  const railTop = ix.first('sideRailTop');
  const railBot = ix.first('sideRailBottom');
  const railTopH = railTop ? pl.sizeOf(railTop, null).size.y : 0;
  const railBotH = railBot ? pl.sizeOf(railBot, null).size.y : 0;
  const perSide = (p: Part) => Math.max(1, Math.round(instanceCount(p) / sides));

  const sideCenterX = (size: Vec3, side: number) => xMirror((legW - size.x) / 2, size.x, side);
  const zCentered = (size: Vec3) => sideFree0 + (sideFree1 - sideFree0 - size.z) / 2;

  for (const p of ix.role('sideRailTop')) each(p, (i, s) => pl.put(p, i, v3(sideCenterX(s, leftRight(i)), legH - s.y, zCentered(s)), { asmInstance: i % 2, explode: v3(leftRight(i) * EXPLODE, 0, 0), envelope: null }));
  for (const p of ix.role('sideRailBottom')) each(p, (i, s) => pl.put(p, i, v3(sideCenterX(s, leftRight(i)), Math.max(0, zoneBottom - s.y), zCentered(s)), { asmInstance: i % 2, explode: v3(leftRight(i) * EXPLODE, 0, 0), envelope: null }));
  const panelTop = legH - railTopH;
  for (const p of ix.role('sidePanel')) {
    each(p, (i, s) => {
      const y0 = Math.max(0, panelTop - s.y);
      pl.put(p, i, v3(sideCenterX(s, leftRight(i)), y0, zCentered(s)), { asmInstance: i % 2, explode: v3(leftRight(i) * EXPLODE, 0, 0), envelope: null });
    });
  }
  const panel = ix.first('sidePanel');
  const panelS = panel ? pl.sizeOf(panel, null).size : v3(9, 500, 300);
  const panelInnerX = (legW + panelS.x) / 2; // inner face of the left side panel
  // Thickeners: vertical ones at the front/back edges of the panel, horizontal ones between them.
  for (const p of ix.role('sideThickener')) {
    const s0 = pl.sizeOf(p, null).size;
    const vertical = s0.y >= s0.z;
    const n = perSide(p);
    each(p, (i, s) => {
      const side = leftRight(i);
      const k = Math.floor(i / 2);
      const x = xMirror(panelInnerX, s.x, side);
      let z: number;
      let y: number;
      if (vertical) {
        z = k % 2 === 0 ? sideFree0 : sideFree1 - s.z;
        y = panelTop - s.y;
      } else {
        // Horizontal pieces run between the two vertical thickeners, spread over the panel height.
        z = (sideFree0 + sideFree1) / 2 - s.z / 2;
        y = panelTop - panelS.y + ((k + 0.5) * panelS.y) / n - s.y / 2;
      }
      pl.put(p, i, v3(x, y, z), { asmInstance: i % 2, confidence: 'low', explode: v3(side * EXPLODE, 0, 0), envelope: null });
    });
  }
  for (const p of ix.role('sideInnerProfile')) each(p, (i, s) => pl.put(p, i, v3(xMirror(legW, s.x, leftRight(i)), zoneTop - s.y, D - s.z), { asmInstance: i % 2, explode: v3(leftRight(i) * EXPLODE, 0, 0), envelope: null }));

  /* ---------------- drawer rows ---------------- */
  const drawerAsms = ix.asmRole('drawer');
  const frontOf = (a: Assembly) => ix.partsOf(a).find((p) => p.role === 'drawerFront');
  const groups = drawerAsms
    .map((a) => {
      const f = frontOf(a);
      const fs = f ? pl.sizeOf(f, null).size : a.dims ? v3(a.dims.L, a.dims.T, 15) : v3(400, 200, 15);
      const n = normalizeName(a.originalName);
      const order = /\batas\b/.test(n) ? 0 : /\bbawah\b/.test(n) ? 2 : 1;
      const perRow = Math.min(a.qty, Math.max(1, Math.round((openingW + stileW) / (fs.x + stileW + 2 * reveal))));
      return { a, front: f, fs, order, perRow };
    })
    .sort((g, h) => g.order - h.order || g.fs.y - h.fs.y);

  const rows: DrawerRow[] = [];
  let cursor = zoneTop;
  const railParts = ix.role('frontRail');
  const railSlots: number[] = [];
  for (const g of groups) {
    const nRows = Math.ceil(g.a.qty / g.perRow);
    for (let r = 0; r < nRows; r++) {
      railSlots.push(cursor);
      cursor -= railT;
      const y1 = cursor;
      const y0 = y1 - (g.fs.y + 2 * reveal);
      const inRow = Math.min(g.perRow, g.a.qty - r * g.perRow);
      const cw = (openingW - (inRow - 1) * stileW) / inRow;
      const row: DrawerRow = { index: rows.length, perRow: inRow, assemblyId: g.a.id, y0, y1, cellWidth: cw, slots: [] };
      for (let c = 0; c < inRow; c++) {
        const x0 = openingX0 + c * (cw + stileW);
        row.slots.push({ assemblyId: g.a.id, asmInstance: r * g.perRow + c, row: row.index, col: c, cell: { x0, x1: x0 + cw, y0, y1 }, frontPartId: g.front?.id ?? null, box: null });
      }
      rows.push(row);
      cursor = y0;
    }
  }
  const stackBottom = cursor;
  const stackHeight = zoneTop - stackBottom;
  if (rows.length) pl.notes.push(`Drawer rows inferred: ${rows.map((r) => `${r.perRow}`).join(' + ')} (top → bottom)`);

  /* ---------------- front frame ---------------- */
  const frontEx = v3(0, 0, EXPLODE * 0.6);
  let railIdx = 0;
  for (const p of railParts) {
    each(p, (i, s) => {
      const top = railSlots[railIdx] ?? zoneBottom + railT;
      railIdx++;
      pl.put(p, i, v3((W - s.x) / 2, top - s.y, D - s.z), { explode: frontEx, envelope: null });
    });
  }
  // The carcass never depends on drawer sizes: an overflowing stack shows up as a clash with the bottom rail.
  const zoneLow = zoneBottom;
  const profileT = faceProfile ? pl.sizeOf(faceProfile, null).size.z : 0;
  for (const p of ix.role('frontRailBottom')) each(p, (i, s) => pl.put(p, i, v3((W - s.x) / 2, zoneLow - s.y, D - profileT - s.z), { explode: frontEx, envelope: null }));
  const bottomRailY = zoneLow - Math.max(faceProfileH, ix.first('frontRailBottom') ? pl.sizeOf(ix.first('frontRailBottom')!, null).size.y : 0);
  for (const p of ix.role('frontProfile')) {
    each(p, (i, s) => {
      const y = i % 2 === 0 ? zoneTop : zoneLow - s.y;
      pl.put(p, i, v3((W - s.x) / 2, y, D - s.z), { confidence: 'medium', explode: frontEx, envelope: null });
    });
  }
  // Stiles: longest stile goes to the boundary shared by the most rows.
  const boundaries = new Map<number, number[]>();
  for (const r of rows) for (let c = 1; c < r.slots.length; c++) {
    const x = r.slots[c].cell.x0 - stileW;
    const k = [...boundaries.keys()].find((b) => Math.abs(b - x) < 2) ?? x;
    boundaries.set(k, [...(boundaries.get(k) ?? []), r.index]);
  }
  const free = [...boundaries.entries()].sort((a, b) => b[1].length - a[1].length || Math.abs(a[0] - W / 2) - Math.abs(b[0] - W / 2));
  const stileInst = ix.role('frontStile').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i, L: pl.sizeOf(p, null).size.y }))).sort((a, b) => b.L - a.L);
  for (const st of stileInst) {
    const slot = free.shift();
    const s = pl.sizeOf(st.p, null).size;
    if (!slot) {
      pl.put(st.p, st.i, v3((W - s.x) / 2, zoneTop - s.y, D - s.z), { confidence: 'low', explode: frontEx, envelope: null });
      continue;
    }
    const topRow = rows[Math.min(...slot[1])];
    const top = faceProfileH ? legH : (topRow?.y1 ?? zoneTop) + railT;
    pl.put(st.p, st.i, v3(slot[0], top - s.y, D - s.z), { explode: frontEx, envelope: null });
  }
  pl.requireCount({ role: 'frontStile', partIds: ix.role('frontStile').map((p) => p.id), required: boundaries.size, have: stileInst.length, reason: `${boundaries.size} stile position(s) between drawers in a row`, confidence: 'medium', severity: 'warn' });

  /* ---------------- back zone ---------------- */
  const backEx = v3(0, 0, -EXPLODE);
  const back = ix.first('back');
  const backS = back ? pl.sizeOf(back, null).size : v3(W - 2 * sideT, legH, 3);
  const backY0 = legH - backS.y;
  for (const p of ix.role('back')) each(p, (i, s) => pl.put(p, i, v3((W - s.x) / 2, legH - s.y, 0), { explode: backEx, envelope: null }));
  let backZ = backS.z;
  const bStile = ix.first('backStile');
  for (const p of ix.role('backStile')) each(p, (i, s) => pl.put(p, i, v3(xMirror(legBW, s.x, leftRight(i)), legH - s.y, backZ), { explode: backEx, envelope: null }));
  for (const p of ix.role('backRail')) each(p, (i, s) => pl.put(p, i, v3((W - s.x) / 2, i % 2 === 0 ? legH - s.y : backY0, backZ), { explode: backEx, envelope: null }));
  if (bStile || ix.first('backRail')) backZ += Math.max(bStile ? pl.sizeOf(bStile, null).size.z : 0, ix.first('backRail') ? pl.sizeOf(ix.first('backRail')!, null).size.z : 0);
  // Counterweight panel(s): sandwich of skins and frame, standing in front of the back.
  const weightAsms = ix.asmRole('counterweight');
  for (const a of weightAsms) {
    const env = a.dims ? v3(a.dims.W, a.dims.L, a.dims.T) : null;
    const n = a.qty;
    const totalW = env ? env.x * n : W - 2 * sideT;
    const x0 = (W - totalW) / 2;
    const z0 = backZ;
    const skinZ = { front: 0, back: 0 };
    for (const p of ix.partsOf(a)) {
      const per = Math.max(1, Math.round(instanceCount(p) / n));
      for (let i = 0; i < instanceCount(p); i++) {
        const ai = Math.floor(i / per);
        const k = i % per;
        const { size: s } = pl.sizeOf(p, env);
        const ax0 = x0 + ai * (env?.x ?? totalW);
        const aw = env?.x ?? totalW;
        const ay0 = legH - (env?.y ?? s.y);
        let pos: Vec3;
        if (p.role === 'weightSkin') {
          pos = v3(ax0 + (aw - s.x) / 2, ay0, k % 2 === 0 ? z0 : z0 + (env?.z ?? 30) - s.z);
          skinZ.front = s.z;
        } else if (p.role === 'weightStile') pos = v3(k % 2 === 0 ? ax0 : ax0 + aw - s.x, ay0, z0 + (env ? (env.z - s.z) / 2 : 6));
        else if (p.role === 'weightRail') pos = v3(ax0 + (aw - s.x) / 2, ay0 + (per > 1 ? (k * ((env?.y ?? s.y) - s.y)) / (per - 1) : 0), z0 + (env ? (env.z - s.z) / 2 : 6));
        else continue;
        pl.put(p, i, pos, { asmInstance: ai, explode: v3(0, 0, -EXPLODE * 0.6), envelope: env });
      }
    }
    backZ += env?.z ?? 30;
  }

  /* ---------------- runners (per drawer row) ---------------- */
  const frontFrameZ = D - (ix.first('sideInnerProfile') ? pl.sizeOf(ix.first('sideInnerProfile')!, null).size.z : 0);
  const rowSlideY = (r: DrawerRow, h: number) => (r.y0 + r.y1) / 2 - h / 2;
  const runnerInst: { p: Part; i: number }[] = ix.role('runner').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  runnerInst.forEach(({ p, i }, n) => {
    const s = pl.sizeOf(p, null).size;
    const r = rows[Math.floor(n / 2)];
    const side = leftRight(n);
    if (!r) return; // extra runners stay unplaced → quantity finding
    pl.put(p, i, v3(side < 0 ? openingX0 - s.x : openingX1, rowSlideY(r, s.y), frontFrameZ - s.z), { asmInstance: n % 2, explode: v3(side * EXPLODE, 0, 0), envelope: null });
  });
  pl.requireCount({ role: 'runner', partIds: ix.role('runner').map((p) => p.id), required: rows.length * 2, have: runnerInst.length, reason: `${rows.length} drawer row(s) × 2 sides`, confidence: 'medium', severity: 'warn' });
  const midInst = ix.role('midRunner').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  const midSlots = rows.flatMap((r) => r.slots.slice(1).map((sl) => ({ r, x: sl.cell.x0 - stileW / 2 })));
  midInst.forEach(({ p, i }, n) => {
    const slot = midSlots[n];
    if (!slot) return;
    const s = pl.sizeOf(p, null).size;
    pl.put(p, i, v3(slot.x - s.x / 2, rowSlideY(slot.r, s.y), frontFrameZ - s.z), { explode: v3(0, 0, -EXPLODE * 0.3), envelope: null });
  });
  pl.requireCount({ role: 'midRunner', partIds: ix.role('midRunner').map((p) => p.id), required: midSlots.length, have: midInst.length, reason: `${midSlots.length} gap(s) between drawers sharing a row`, confidence: 'medium', severity: 'warn' });
  // Runner holder blocks: between the side panel and each runner, at both ends.
  const rbInst = ix.role('runnerBlock').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  const placedRunners = pl.instances.filter((x) => x.role === 'runner');
  rbInst.forEach(({ p, i }, n) => {
    const run = placedRunners[Math.floor(n / 2)];
    if (!run) return;
    const s = pl.sizeOf(p, null).size;
    const leftSide = run.min.x < W / 2;
    const x = leftSide ? run.min.x - s.x : run.max.x;
    const z = n % 2 === 0 ? run.min.z + 20 : run.max.z - 20 - s.z;
    pl.put(p, i, v3(x, run.min.y, z), { asmInstance: run.asmInstance, confidence: 'low', explode: v3((leftSide ? -1 : 1) * EXPLODE, 0, 0), envelope: null });
  });

  /* ---------------- web frames between rows ---------------- */
  const midLevels = rows.slice(1).map((r) => r.y1);
  const frontRailDepth = ix.first('frontRail') ? pl.sizeOf(ix.first('frontRail')!, null).size.z : 55;
  ix.role('dustPanel').forEach((p) =>
    each(p, (i, s) => {
      const y = midLevels[i] ?? zoneBottom;
      const perLevel = Math.max(1, Math.round(s.x < openingW * 0.75 ? openingW / s.x : 1));
      const col = i % perLevel;
      const x = perLevel > 1 ? openingX0 + col * (openingW / perLevel) + (openingW / perLevel - s.x) / 2 : (W - s.x) / 2;
      pl.put(p, i, v3(x, y + railT / 2 - s.y / 2, D - frontRailDepth - s.z), { confidence: 'low', envelope: null });
    }),
  );
  ix.role('innerRail').forEach((p) => each(p, (i, s) => pl.put(p, i, v3((W - s.x) / 2, (midLevels[i] ?? zoneBottom) + railT - s.y, backZ), { confidence: 'low', envelope: null })));
  pl.requireCount({ role: 'dustPanel', partIds: ix.role('dustPanel').map((p) => p.id), required: Math.max(0, rows.length - 1), have: ix.qty('dustPanel'), reason: `${Math.max(0, rows.length - 1)} level(s) between drawer rows (dust panels are optional)`, confidence: 'low', severity: 'info' });

  /* ---------------- base / centre supports ---------------- */
  const baseY = Math.max(0, bottomRailY);
  for (const p of ix.role('centerSupport')) each(p, (i, s) => pl.put(p, i, v3((W - s.x) / 2 + (i - (instanceCount(p) - 1) / 2) * 200, baseY - s.y, (D - s.z) / 2), { confidence: 'low', envelope: null }));
  const legSup = ix.first('legSupport');
  const legSupH = legSup ? pl.sizeOf(legSup, null).size.y : 0;
  for (const p of ix.role('legSupport')) each(p, (i, s) => pl.put(p, i, v3((W - s.x) / 2, 0, D - legD - s.z - 40 - i * 120), { confidence: 'low', envelope: null }));
  for (const p of ix.role('centerLeg')) each(p, (i, s) => pl.put(p, i, v3((W - s.x) / 2, Math.max(legSupH, bottomRailY - s.y), (D - s.z) / 2), { confidence: 'low', envelope: null }));

  /* ---------------- top ---------------- */
  const topAsm = ix.asmRole('top')[0];
  const topEnv = topAsm?.dims ? v3(topAsm.dims.L, topAsm.dims.T, topAsm.dims.W) : null;
  const thick = ix.first('topThickener');
  const thickT = thick ? pl.sizeOf(thick, null).size.y : 0;
  const topEx = v3(0, EXPLODE, 0);
  const topClip = topEnv ? v3(topEnv.x, 1e6, topEnv.z) : null;
  for (const p of ix.role('top')) {
    const { size: s } = pl.sizeOf(p, topClip);
    for (let i = 0; i < instanceCount(p); i++) pl.put(p, i, v3((W - s.x) / 2, legH + thickT, (D - s.z) / 2), { explode: topEx, envelope: topClip });
  }
  ix.role('topThickener').forEach((p) => {
    const s0 = pl.sizeOf(p, topEnv ? v3(topEnv.x, 1e6, topEnv.z) : null).size;
    const alongX = s0.x >= s0.z;
    const n = normalizeName(p.originalName);
    each(p, (i) => {
      const { size: s } = pl.sizeOf(p, topEnv ? v3(topEnv.x, 1e6, topEnv.z) : null);
      let pos: Vec3;
      if (alongX) pos = v3((W - s.x) / 2, legH, i % 2 === 0 ? D - s.z : 0);
      else if (/tengah/.test(n)) pos = v3((W - s.x) / 2 + (i - (instanceCount(p) - 1) / 2) * (W / (instanceCount(p) + 1)), legH, (D - s.z) / 2);
      else pos = v3(i % 2 === 0 ? 0 : W - s.x, legH, (D - s.z) / 2);
      pl.put(p, i, pos, { size: s, confidence: 'low', explode: topEx });
    });
  });
  const topSurface = legH + thickT + (ix.first('top') ? pl.sizeOf(ix.first('top')!, null).size.y : 0);
  ix.role('topProfile').forEach((p) =>
    each(p, (i) => {
      const { size: s } = pl.sizeOf(p, topEnv ? v3(topEnv.x, 1e6, topEnv.z) : null);
      const alongX = s.x >= s.z;
      const pos = alongX ? v3((W - s.x) / 2, topSurface - s.y, D - s.z) : v3(i % 2 === 0 ? 0 : W - s.x, topSurface - s.y, (D - s.z) / 2);
      pl.put(p, i, pos, { size: s, confidence: 'low', explode: topEx });
    }),
  );

  /* ---------------- blocks (glue blocks in corners) ---------------- */
  const corners = [v3(legW, 0, legBD), v3(W - legW, 0, legBD), v3(legW, 0, D - legD), v3(W - legW, 0, D - legD)];
  for (const role of ['block', 'cornerBlock']) {
    ix.role(role).forEach((p) =>
      each(p, (i, s) => {
        const c = corners[i % 4];
        const level = Math.floor(i / 4);
        const bottom = role === 'cornerBlock' || p.assemblyId === ix.asmRole('body')[0]?.id;
        const x = c.x < W / 2 ? c.x : c.x - s.x;
        const z = c.z < D / 2 ? c.z : c.z - s.z;
        const y = bottom ? Math.max(0, bottomRailY - s.y) + level * (s.y + 10) : legH - s.y - level * (s.y + 10);
        pl.put(p, i, v3(x, y, z), { confidence: 'low', envelope: null, asmInstance: c.x < W / 2 ? 0 : 1 });
      }),
    );
  }

  /* ---------------- drawers ---------------- */
  const slots = rows.flatMap((r) => r.slots);
  const boxJoint = String(ix.content.assumptions.boxJoint?.value ?? 'sides-inside');
  const frontStyle = String(ix.content.assumptions.frontStyle?.value ?? 'inset');
  for (const g of groups) {
    const parts = ix.partsOf(g.a);
    const fb = parts.find((p) => p.role === 'drawerBoxFrontBack');
    const side = parts.find((p) => p.role === 'drawerSide');
    const fbS = fb ? pl.sizeOf(fb, null).size : null;
    const sideS = side ? pl.sizeOf(side, null).size : null;
    const boxW = fbS ? (boxJoint === 'sides-inside' ? fbS.x : fbS.x + 2 * (sideS?.x ?? 0)) : g.fs.x - 40;
    const boxD = sideS ? (boxJoint === 'sides-inside' ? sideS.z + 2 * (fbS?.z ?? 0) : sideS.z) : D * 0.75;
    const boxH = sideS?.y ?? g.fs.y - 20;
    for (let k = 0; k < g.a.qty; k++) {
      const slot = slots.find((s) => s.assemblyId === g.a.id && s.asmInstance === k);
      if (!slot) continue;
      const cell = slot.cell;
      const cx = (cell.x0 + cell.x1) / 2;
      const cy = (cell.y0 + cell.y1) / 2;
      const frontT = g.fs.z;
      const zFront1 = frontStyle === 'overlay' ? D + frontT : D;
      const boxZ1 = zFront1 - frontT;
      const box = { min: v3(cx - boxW / 2, cy - boxH / 2, boxZ1 - boxD), max: v3(cx + boxW / 2, cy + boxH / 2, boxZ1) };
      slot.box = box;
      const group = `${g.a.id}#${k}`;
      const ex = v3(0, 0, EXPLODE * 1.4 + slot.row * 10);
      const common = { asmInstance: k, group, moving: true, explode: ex, envelope: null } as const;
      for (const p of parts) {
        const per = Math.max(1, Math.round(instanceCount(p) / g.a.qty));
        for (let j = 0; j < per; j++) {
          const i = k * per + j;
          if (i >= instanceCount(p)) break;
          const s = pl.sizeOf(p, null).size;
          let pos: Vec3 | null = null;
          switch (p.role) {
            case 'drawerFront':
              pos = v3(cx - s.x / 2, cy - s.y / 2, zFront1 - s.z);
              break;
            case 'drawerFrontTrim':
              // Backing strips glued behind the front panel (top and bottom edge).
              pos = v3(cx - s.x / 2, j % 2 === 0 ? cy + g.fs.y / 2 - s.y : cy - g.fs.y / 2, zFront1 - frontT - s.z);
              break;
            case 'drawerBoxFrontBack':
              pos = boxJoint === 'sides-inside' ? v3(cx - s.x / 2, box.min.y, j % 2 === 0 ? box.max.z - s.z : box.min.z) : v3(cx - s.x / 2, box.min.y, j % 2 === 0 ? box.max.z - s.z : box.min.z);
              break;
            case 'drawerSide': {
              const zs = boxJoint === 'sides-inside' ? box.min.z + (fbS?.z ?? 0) : box.min.z;
              pos = v3(j % 2 === 0 ? box.min.x : box.max.x - s.x, box.min.y, zs);
              break;
            }
            case 'drawerBottom':
              pos = v3(cx - s.x / 2, box.min.y + 10, (box.min.z + box.max.z) / 2 - s.z / 2);
              break;
            case 'drawerCenterSupport':
              pos = v3(box.min.x + ((j + 1) * (box.max.x - box.min.x)) / (per + 1) - s.x / 2, box.min.y + 10 - s.y, (box.min.z + box.max.z) / 2 - s.z / 2);
              break;
            case 'drawerBlock': {
              const corner = j % 4;
              const lvl = Math.floor(j / 4);
              const levels = Math.ceil(per / 4);
              const t = sideS?.x ?? 12;
              const ft = fbS?.z ?? 12;
              const x = corner % 2 === 0 ? box.min.x + t : box.max.x - t - s.x;
              const z = corner < 2 ? box.min.z + ft : box.max.z - ft - s.z;
              const yLo = box.min.y + 13;
              const yHi = box.max.y - s.y;
              // Tall blocks can't stack: further levels step along the box side instead.
              const stack = levels > 1 && yHi - yLo >= s.y;
              const zStep = stack ? 0 : lvl * (s.z + 4) * (corner < 2 ? 1 : -1);
              pos = v3(x, stack ? yLo + (lvl * (yHi - yLo)) / (levels - 1) : yLo, z + zStep);
              break;
            }
          }
          if (pos) pl.put(p, i, pos, { ...common, confidence: p.role === 'drawerBlock' ? 'low' : 'medium' });
        }
      }
    }
    for (const role of ['drawerFront', 'drawerSide', 'drawerBoxFrontBack', 'drawerBottom']) {
      const per = role === 'drawerSide' || role === 'drawerBoxFrontBack' ? 2 : 1;
      const ps = parts.filter((p) => p.role === role);
      const have = ps.reduce((s, p) => s + p.qty, 0);
      pl.requireCount({ role, partIds: ps.map((p) => p.id), required: g.a.qty * per, have, reason: `${g.a.qty} × "${g.a.originalName.trim()}" need ${per} each`, confidence: 'high', severity: 'fail' });
    }
  }

  /* ---------------- hardware on drawers ---------------- */
  const drawerSlots = slots.filter((s) => s.box);
  const slideInst = ix.role('slide').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  slideInst.forEach(({ p, i }, n) => {
    const slot = drawerSlots[Math.floor(n / 2)];
    if (!slot?.box) return;
    const s = pl.sizeOf(p, null).size;
    const left = n % 2 === 0;
    const b = slot.box;
    pl.put(p, i, v3(left ? b.min.x - s.x : b.max.x, (b.min.y + b.max.y) / 2 - s.y / 2, b.max.z - s.z), { group: `${slot.assemblyId}#${slot.asmInstance}`, moving: true, explode: v3(0, 0, EXPLODE * 1.4), envelope: null });
  });
  for (const role of ['knob', 'handle']) {
    const inst = ix.role(role).flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
    if (!inst.length || !drawerSlots.length) continue;
    const per = Math.max(1, Math.round(inst.length / drawerSlots.length));
    inst.forEach(({ p, i }, n) => {
      const slot = drawerSlots[Math.floor(n / per)];
      if (!slot) return;
      const s = pl.sizeOf(p, null).size;
      const c = slot.cell;
      const k = n % per;
      const x = per === 1 ? (c.x0 + c.x1) / 2 : c.x0 + ((k + 1) * (c.x1 - c.x0)) / (per + 1);
      const zf = frontStyle === 'overlay' ? D + g0FrontT(groups) : D;
      pl.put(p, i, v3(x - s.x / 2, (c.y0 + c.y1) / 2 - s.y / 2, zf), { group: `${slot.assemblyId}#${slot.asmInstance}`, moving: true, explode: v3(0, 0, EXPLODE * 1.6), envelope: null, confidence: 'low' });
    });
  }
  // Glides under the legs.
  const legFeet = pl.instances.filter((x) => x.role === 'legFront' || x.role === 'legBack' || x.role === 'legSupport');
  ix.role('glide').forEach((p) =>
    each(p, (i, s) => {
      const leg = legFeet[i % Math.max(1, legFeet.length)];
      if (!leg) return;
      pl.put(p, i, v3((leg.min.x + leg.max.x) / 2 - s.x / 2, -s.y, (leg.min.z + leg.max.z) / 2 - s.z / 2), { confidence: 'low', explode: v3(0, -EXPLODE * 0.5, 0), envelope: null });
    }),
  );

  /* ---------------- packing ---------------- */
  layoutSkids(ix, pl, W, D);

  for (const [role, req, why] of [
    ['legFront', 2, 'two front legs'],
    ['legBack', 2, 'two back legs'],
    ['sidePanel', 2, 'left and right side panels'],
    ['frontRail', rows.length, `top rail + ${Math.max(0, rows.length - 1)} rail(s) between rows`],
    ['back', 1, 'one back panel'],
  ] as const) {
    if (!req) continue;
    const ps = ix.role(role);
    if (role === 'frontRail' && !ps.length) continue;
    pl.requireCount({ role, partIds: ps.map((p) => p.id), required: req, have: ps.reduce((s, p) => s + p.qty, 0), reason: why, confidence: role === 'frontRail' ? 'medium' : 'high', severity: role === 'frontRail' ? 'warn' : 'fail' });
  }

  return {
    rows,
    caseInfo: { width: W, depth: D, legHeight: legH, openingX0, openingX1, zoneTop, zoneBottom, zoneHeight: zoneH, stackHeight, frontZ: D, backZ },
  };

  function each(p: Part, fn: (i: number, s: Vec3) => void) {
    const s = pl.sizeOf(p, null).size;
    for (let i = 0; i < instanceCount(p); i++) fn(i, s);
  }
}

function g0FrontT(groups: { fs: Vec3 }[]): number {
  return groups[0]?.fs.z ?? 15;
}

export function layoutSkids(ix: ContentIndex, pl: Placer, W: number, D: number): void {
  const longs = ix.role('skidLong').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  const shorts = ix.role('skidShort').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  const blocks = ix.role('skidBlock').flatMap((p) => Array.from({ length: instanceCount(p) }, (_, i) => ({ p, i })));
  const ex = v3(0, -220, 0);
  const shortT = shorts[0] ? pl.sizeOf(shorts[0].p, null).size.y : 0;
  longs.forEach(({ p, i }, n) => {
    const s = pl.sizeOf(p, null).size;
    const z = ((n + 0.5) * Math.max(D, s.z * longs.length)) / longs.length - s.z / 2;
    pl.put(p, i, v3(W / 2 - s.x / 2, -40 - shortT - s.y, z), { explode: ex, envelope: null, confidence: 'low' });
  });
  shorts.forEach(({ p, i }, n) => {
    const s = pl.sizeOf(p, null).size;
    const cols = shorts.length;
    pl.put(p, i, v3(((n + 0.5) * W) / cols - s.x / 2, -40 - s.y, D / 2 - s.z / 2), { explode: ex, envelope: null, confidence: 'low' });
  });
  blocks.forEach(({ p, i }, n) => {
    const s = pl.sizeOf(p, null).size;
    pl.put(p, i, v3((n % 4) * (W / 4), -40 - shortT - s.y - 20, 0), { explode: ex, envelope: null, confidence: 'low' });
  });
}
