/** PDF drawing sheets (PRD §10, phase 2) and personal spec sheets with a QR code per part (PRD §9). */
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';
import type { Part, RevisionContent, Review, Finding, Team } from '@bom/domain';
import { TEAMS, fmtMm } from '@bom/domain';
import type { Layout } from '@bom/engine';
import { project, sheetInstances, fitScale, type Projection } from './projection';

const MM = 72 / 25.4;
const A3 = { w: 420 * MM, h: 297 * MM };

export interface SheetInfo {
  productCode: string;
  productName: string;
  revisionLabel: string;
  revisionState: string;
  date: string;
  reviews?: Review[];
  author?: string;
  /** Link encoded in QR codes, e.g. https://studio.example/p/{productId}/r/{revisionId}/part/ */
  partLinkBase?: string;
}

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}

function text(c: Ctx, s: string, x: number, y: number, size = 8, bold = false, color = rgb(0.1, 0.1, 0.12)) {
  // Standard PDF fonts are WinAnsi: replace characters they can't encode.
  const safe = s.replace(/[→]/g, '->').replace(/[×]/g, 'x').replace(/[^\x20-\x7E -ÿ]/g, '?');
  c.page.drawText(safe, { x, y, size, font: bold ? c.bold : c.font, color });
}

function drawProjection(c: Ctx, proj: Projection, x: number, y: number, w: number, h: number, label: string, opts: { dims?: boolean; highlight?: Set<string> } = {}): number {
  const scale = fitScale(proj.bounds, (w - 20 * MM) / MM, (h - 20 * MM) / MM);
  const k = MM / scale;
  const b = proj.bounds;
  const ox = x + (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k;
  const oy = y + (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k + 4 * MM;
  for (const r of proj.rects) {
    const hl = opts.highlight?.has(r.partId);
    c.page.drawRectangle({
      x: ox + r.x0 * k,
      y: oy + r.y0 * k,
      width: Math.max(0.2, (r.x1 - r.x0) * k),
      height: Math.max(0.2, (r.y1 - r.y0) * k),
      borderColor: hl ? rgb(0.86, 0.15, 0.15) : rgb(0.2, 0.2, 0.24),
      borderWidth: hl ? 0.9 : 0.35,
      color: r.cut ? rgb(0.85, 0.85, 0.88) : rgb(1, 1, 1),
      opacity: 1,
      borderOpacity: 1,
    });
  }
  text(c, `${label}  1:${scale}`, x + 2 * MM, y + 2 * MM, 8, true);
  if (opts.dims) {
    const W = b.x1 - b.x0;
    const H = b.y1 - b.y0;
    const y0 = oy + b.y0 * k - 6 * MM;
    c.page.drawLine({ start: { x: ox + b.x0 * k, y: y0 }, end: { x: ox + b.x1 * k, y: y0 }, thickness: 0.4, color: rgb(0.1, 0.3, 0.8) });
    text(c, fmtMm(W), ox + ((b.x0 + b.x1) / 2) * k - 6, y0 - 9, 8, false, rgb(0.1, 0.3, 0.8));
    const x0 = ox + b.x1 * k + 6 * MM;
    c.page.drawLine({ start: { x: x0, y: oy + b.y0 * k }, end: { x: x0, y: oy + b.y1 * k }, thickness: 0.4, color: rgb(0.1, 0.3, 0.8) });
    text(c, fmtMm(H), x0 + 3, oy + ((b.y0 + b.y1) / 2) * k, 8, false, rgb(0.1, 0.3, 0.8));
  }
  return scale;
}

function titleBlock(c: Ctx, info: SheetInfo, sheet: string) {
  const w = 170 * MM;
  const h = 46 * MM;
  const x = A3.w - w - 10 * MM;
  const y = 10 * MM;
  c.page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 0.8 });
  text(c, info.productName, x + 4 * MM, y + h - 9 * MM, 13, true);
  text(c, `${info.productCode}   Rev ${info.revisionLabel} · ${info.revisionState}`, x + 4 * MM, y + h - 16 * MM, 9);
  text(c, `Date ${info.date}   Units mm   Third-angle projection   ${sheet}`, x + 4 * MM, y + h - 22 * MM, 7);
  const lanes = info.reviews ?? [];
  text(c, 'Approvals', x + 4 * MM, y + h - 29 * MM, 7, true);
  lanes.forEach((r, i) => text(c, `${TEAMS[r.team].label.en}: ${r.state}`, x + 4 * MM + (i % 3) * 55 * MM, y + h - 34 * MM - Math.floor(i / 3) * 4 * MM, 7));
  text(c, 'Furniture BOM Studio', x + w - 40 * MM, y + 3 * MM, 7, false, rgb(0.4, 0.4, 0.45));
  c.page.drawRectangle({ x: 10 * MM, y: 10 * MM, width: A3.w - 20 * MM, height: A3.h - 20 * MM, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1 });
}

async function base() {
  const pdf = await PDFDocument.create();
  return { pdf, font: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
}

/** Front, side, top (+ optional section) with overall dimensions and a title block; page 2 lists parts. */
export async function drawingSheetPdf(content: RevisionContent, layout: Layout, info: SheetInfo, opts: { section?: { axis: 'x' | 'y' | 'z'; at: number }; findings?: Finding[] } = {}): Promise<Uint8Array> {
  const { pdf, font, bold } = await base();
  pdf.setTitle(`${info.productCode} rev ${info.revisionLabel}`);
  pdf.setCreator('Furniture BOM Studio');
  const page = pdf.addPage([A3.w, A3.h]);
  const c: Ctx = { page, font, bold };
  const inst = sheetInstances(layout, { hardware: false });
  const flagged = new Set((opts.findings ?? []).filter((f) => f.severity === 'fail' && !f.waived).flatMap((f) => f.partIds));
  const cw = (A3.w - 30 * MM) / 2;
  const ch = (A3.h - 80 * MM) / 2;
  drawProjection(c, project(inst, 'front'), 15 * MM, 60 * MM + ch, cw, ch, 'FRONT', { dims: true, highlight: flagged });
  drawProjection(c, project(inst, 'side'), 15 * MM + cw, 60 * MM + ch, cw, ch, 'SIDE (RIGHT)', { dims: true, highlight: flagged });
  drawProjection(c, project(inst, 'top'), 15 * MM, 60 * MM, cw, ch, 'TOP', { dims: true, highlight: flagged });
  if (opts.section) {
    const { section } = await import('./projection');
    drawProjection(c, section(inst, opts.section.axis, opts.section.at), 15 * MM + cw, 60 * MM, cw * 0.55, ch, `SECTION ${opts.section.axis.toUpperCase()} ${opts.section.at}`);
  }
  titleBlock(c, info, 'Sheet 1/2');

  const p2 = pdf.addPage([A3.w, A3.h]);
  const c2: Ctx = { page: p2, font, bold };
  partTable(c2, content.parts, 20 * MM, A3.h - 20 * MM);
  titleBlock(c2, info, 'Sheet 2/2 · part list');
  return pdf.save();
}

function partTable(c: Ctx, parts: Part[], x: number, top: number) {
  const cols = [0, 26, 110, 160, 175, 225, 250];
  const head = ['Std Code', 'Part', 'T x W x L', 'Qty', 'Material', 'Finish', 'Team'];
  head.forEach((h, i) => text(c, h, x + cols[i] * MM, top, 8, true));
  let y = top - 5 * MM;
  for (const p of parts) {
    if (y < 62 * MM) break;
    const row = [p.stdCode ?? '—', p.originalName.slice(0, 48), `${fmtMm(p.dims.T)} x ${fmtMm(p.dims.W)} x ${fmtMm(p.dims.L)}`, `${p.qty} ${p.unit}`, (p.material ?? '').slice(0, 28), p.finishCode ?? '', p.teamOwner];
    row.forEach((v, i) => text(c, v, x + cols[i] * MM, y, 7));
    y -= 4 * MM;
  }
}

/**
 * Personal spec sheet (PRD §9 Meeting mode): views + overall dimensions + the person's part list,
 * filtered to their role, with a QR code per part so pen notes on paper attach to the right part.
 */
export async function personalSheetPdf(content: RevisionContent, layout: Layout, info: SheetInfo & { person: string; team: Team }): Promise<Uint8Array> {
  const { pdf, font, bold } = await base();
  const page = pdf.addPage([A3.w, A3.h]);
  const c: Ctx = { page, font, bold };
  const inst = sheetInstances(layout, { hardware: info.team === 'hardware' });
  const cw = (A3.w - 30 * MM) / 3;
  const ch = 110 * MM;
  const explode = info.team === 'assembly' ? 0.8 : 0;
  drawProjection(c, project(inst, 'front', explode), 15 * MM, A3.h - ch - 25 * MM, cw, ch, explode ? 'FRONT (EXPLODED)' : 'FRONT', { dims: true });
  drawProjection(c, project(inst, 'side', explode), 15 * MM + cw, A3.h - ch - 25 * MM, cw, ch, 'SIDE', { dims: true });
  drawProjection(c, project(inst, 'top', explode), 15 * MM + 2 * cw, A3.h - ch - 25 * MM, cw, ch, 'TOP', { dims: true });
  text(c, `${info.person} · ${TEAMS[info.team].label.en} · ${info.productName} Rev ${info.revisionLabel}`, 15 * MM, A3.h - 17 * MM, 12, true);
  const parts = filterForTeam(content.parts, info.team);
  // Part cards with QR codes.
  const cardW = 64 * MM;
  const cardH = 22 * MM;
  const perRow = Math.floor((A3.w - 30 * MM) / cardW);
  let i = 0;
  for (const p of parts) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = 15 * MM + col * cardW;
    const y = A3.h - ch - 50 * MM - row * cardH;
    if (y < 62 * MM) break;
    c.page.drawRectangle({ x, y, width: cardW - 2 * MM, height: cardH - 2 * MM, borderColor: rgb(0.6, 0.6, 0.65), borderWidth: 0.4 });
    drawQr(c, `${info.partLinkBase ?? 'bomstudio://part/'}${p.id}`, x + 1.5 * MM, y + 1.5 * MM, 17 * MM);
    text(c, p.originalName.slice(0, 30), x + 20 * MM, y + 14 * MM, 7, true);
    text(c, `${p.stdCode ?? '—'} · ${fmtMm(p.dims.T)}x${fmtMm(p.dims.W)}x${fmtMm(p.dims.L)} · ${p.qty}`, x + 20 * MM, y + 9 * MM, 6);
    text(c, info.team === 'finishing' ? `Finish: ${p.finishCode ?? 'NONE'}` : info.team === 'hardware' ? `SKU: ${p.hardwareSku ?? 'NONE'}` : (p.material ?? '').slice(0, 30), x + 20 * MM, y + 4.5 * MM, 6);
    i++;
  }
  titleBlock(c, info, `Personal sheet · ${parts.length} parts`);
  return pdf.save();
}

export function filterForTeam(parts: Part[], team: Team): Part[] {
  if (team === 'hardware') return parts.filter((p) => p.kind === 'hardware');
  if (team === 'packing') return parts.filter((p) => p.kind === 'packing');
  if (team === 'finishing') return parts.filter((p) => p.kind !== 'hardware' && p.kind !== 'packing' && p.kind !== 'veneer');
  return parts.filter((p) => p.kind !== 'veneer' && p.kind !== 'packing');
}

function drawQr(c: Ctx, data: string, x: number, y: number, size: number) {
  const qr = QRCode.create(data, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (qr.modules.get(r, col)) c.page.drawRectangle({ x: x + col * cell, y: y + size - (r + 1) * cell, width: cell, height: cell, color: rgb(0, 0, 0) });
  }
}
