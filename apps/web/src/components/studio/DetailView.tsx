'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Part, PartDrawing, RevisionContent } from '@bom/domain';
import { fmtMm, makePatch } from '@bom/domain';
import type { Analysis } from '@bom/engine';
import { partDetail, assemblySheet, type Box2, type CornerDetail, type AssemblySheet } from '@bom/exporters/detail';
import type { Projection } from '@bom/exporters/projection';
import { parseDxf, type DxfDrawing } from '@bom/bom-io/dxf';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api } from '@/lib/api';
import type { RevisionLive } from '@/lib/live';
import { Icon } from '../Icon';

/**
 * Detail drawings: the selected part on its own (views with sizes, every corner with the parts it
 * meets, its joints, an attached AutoCAD drawing), or one assembly at a time with numbered balloons
 * — the sheet a meeting walks through, Previous / Next.
 */
export function DetailView({ revisionId }: { revisionId: string }) {
  const t = useT();
  const rev = useRevision(revisionId);
  const selection = useUi((s) => s.selection);
  const [mode, setMode] = useState<'part' | 'assembly'>('part');
  const [asmIdx, setAsmIdx] = useState(0);
  const content = rev?.content;
  const analysis = rev?.analysis;
  const selPart = content && selection.revisionId === revisionId && selection.partIds.length >= 1 ? content.parts.find((p) => p.id === selection.partIds[0]) : null;
  // Assemblies in BOM order (loose parts last), as a meeting goes through them — only those with
  // something to draw (packing and the screw bag have no shapes).
  const asmList = useMemo(() => {
    if (!content || !analysis) return [] as (string | null)[];
    const drawn = new Set(analysis.layout.instances.filter((i) => i.source !== 'tray' && i.source !== 'stack' && !i.packing).map((i) => i.assemblyId ?? null));
    const ids: (string | null)[] = content.assemblies.filter((a) => drawn.has(a.id)).map((a) => a.id);
    if (drawn.has(null)) ids.push(null);
    return ids;
  }, [content, analysis]);
  // A whole assembly selected (tree header) → assembly sheet; one part → part sheet. Only when the
  // selection changes — not when the product data refreshes.
  const latest = useRef({ content, selPart, asmList });
  latest.current = { content, selPart, asmList };
  useEffect(() => {
    const { content: c, selPart: sp, asmList: al } = latest.current;
    if (!c || !sp) return;
    const ids = selection.partIds;
    const asmId = sp.assemblyId;
    const wholeAsm = ids.length > 1 && c.parts.filter((p) => p.assemblyId === asmId).every((p) => ids.includes(p.id));
    setMode(wholeAsm ? 'assembly' : 'part');
    const i = al.indexOf(asmId ?? null);
    if (i >= 0) setAsmIdx(i);
  }, [selection]);
  if (!rev || !content || !analysis || !rev.bundle) return null;
  const asmId = asmList[Math.min(asmIdx, asmList.length - 1)] ?? null;
  const showPart = mode === 'part' && selPart;
  return (
    <div className="detail-view" data-testid="detail-view">
      <div className="detail-bar float-card">
        <div className="seg">
          <button aria-pressed={!!showPart} disabled={!selPart} onClick={() => setMode('part')} data-testid="detail-part">
            {t('detail.thisPart')}
          </button>
          <button aria-pressed={!showPart} onClick={() => setMode('assembly')} data-testid="detail-assembly">
            {t('detail.assembly')}
          </button>
        </div>
        {!showPart && (
          <div className="row asm-nav">
            <button className="btn" disabled={asmIdx <= 0} onClick={() => setAsmIdx((i) => Math.max(0, i - 1))} data-testid="asm-prev">
              ◀ {t('detail.prev')}
            </button>
            <strong>
              {t('detail.asmOf', { n: Math.min(asmIdx, asmList.length - 1) + 1, total: asmList.length })} · {asmId ? content.assemblies.find((a) => a.id === asmId)?.name : t('studio.loose')}
            </strong>
            <button className="btn" disabled={asmIdx >= asmList.length - 1} onClick={() => setAsmIdx((i) => Math.min(asmList.length - 1, i + 1))} data-testid="asm-next">
              {t('detail.next')} ▶
            </button>
          </div>
        )}
        {showPart && <strong className="ellipsis">{selPart!.name}</strong>}
        <span className="grow" />
        <button className="btn" onClick={() => window.print()}>
          🖨 {t('detail.print')}
        </button>
      </div>
      {!selPart && mode === 'part' && <div className="detail-hint">{t('detail.pickHint')}</div>}
      <div className="detail-print">
        {showPart ? <PartSheet rev={rev} content={content} analysis={analysis} part={selPart!} /> : <AssemblySheetView rev={rev} content={content} analysis={analysis} assemblyId={asmId} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Part sheet                                                          */
/* ------------------------------------------------------------------ */

function PartSheet({ rev, content, analysis, part }: { rev: RevisionLive; content: RevisionContent; analysis: Analysis; part: Part }) {
  const t = useT();
  const detail = useMemo(() => partDetail(analysis.layout, content, part.id), [analysis, content, part.id]);
  const nameOf = (id: string) => content.parts.find((p) => p.id === id)?.name ?? id;
  const isHw = part.role === 'knob' || part.role === 'handle';
  return (
    <div className="sheet-grid" data-testid="part-sheet">
      <TitleBlock rev={rev} part={part} />
      <DrawingCard rev={rev} part={part} />
      {!part.drawing && isHw && (
        <div className="focus-card sheet-cell">
          <h4>{t('detail.symbol')}</h4>
          <HardwareSymbol part={part} />
          <p className="muted small">{t('detail.symbolNote')}</p>
        </div>
      )}
      {detail ? (
        <>
          <div className="focus-card sheet-cell wide">
            <h4>{t('detail.views')}</h4>
            {detail.stretched ? <div className="chip warn" style={{ marginBottom: 6 }}>{t('detail.stretched', { mm: fmtMm(detail.stretched) })}</div> : null}
            <PartViews views={detail.views} />
          </div>
          <div className="focus-card sheet-cell wide">
            <h4>
              {t('detail.corners')} <span className="muted small">({t(`v3d.${detail.faceView === 'side' ? 'side' : detail.faceView === 'top' ? 'top' : 'front'}`)})</span>
            </h4>
            <div className="corner-grid">
              {detail.corners.map((c) => (
                <CornerSvg key={c.label} c={c} nameOf={nameOf} />
              ))}
            </div>
          </div>
          <div className="focus-card sheet-cell wide">
            <h4>{t('detail.joints')}</h4>
            {detail.joints.length ? (
              <table className="grid detail-table">
                <thead>
                  <tr>
                    <th>{t('detail.meets')}</th>
                    <th>{t('detail.jointType')}</th>
                    <th className="num">{t('detail.face')}</th>
                    <th>{t('detail.inCorner')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.joints.map((j) => (
                    <tr key={j.partId} onClick={() => useUi.getState().select(rev.id, [j.partId])} style={{ cursor: 'pointer' }}>
                      <td>{nameOf(j.partId)}</td>
                      <td>{j.type ?? t('detail.touches')}</td>
                      <td className="num">
                        {fmtMm(j.face.w)} × {fmtMm(j.face.h)}
                      </td>
                      <td>{j.corners.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="muted">{t('common.none')}</div>
            )}
          </div>
        </>
      ) : (
        <div className="focus-card sheet-cell wide muted">{t('detail.notDrawn')}</div>
      )}
    </div>
  );
}

function TitleBlock({ rev, part }: { rev: RevisionLive; part: Part }) {
  const t = useT();
  const b = rev.bundle!;
  const rows: [string, string][] = [
    [t('detail.product'), `${b.product.code} · ${b.product.name}`],
    [t('studio.version'), `${b.revision.label} · ${b.revision.state.replace('_', ' ')}`],
    [t('detail.partName'), part.originalName !== part.name ? `${part.name} (${part.originalName})` : part.name],
    ['Std Code', part.stdCode ?? '—'],
    [t('insp.size'), `${fmtMm(part.dims.T)} × ${fmtMm(part.dims.W)} × ${fmtMm(part.dims.L)} (T × W × L)`],
    [t('insp.qty'), `${part.qty} ${part.unit}`],
    [t('props.material'), part.material ?? '—'],
    [t('props.finish'), part.finishCode ?? '—'],
    ...(part.hardwareSku ? ([['SKU', part.hardwareSku]] as [string, string][]) : []),
  ];
  return (
    <div className="focus-card sheet-cell title-block">
      {rows.map(([k, v]) => (
        <div key={k} className="tb-row">
          <span className="muted">{k}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  );
}

/** The part's attached design (AutoCAD DXF or picture), with attach / replace / remove. */
function DrawingCard({ rev, part }: { rev: RevisionLive; part: Part }) {
  const t = useT();
  const { me } = useEditor();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const sameCode = rev.content!.parts.filter((p) => p.id !== part.id && ((part.hardwareSku && p.hardwareSku === part.hardwareSku) || (part.stdCode && p.stdCode === part.stdCode && p.originalName === part.originalName)));
  const attach = async (file: File) => {
    setBusy(true);
    try {
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] ?? '');
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const out = await api<{ drawing: PartDrawing }>('/api/drawings', { method: 'POST', json: { name: file.name, data } });
      const targets = [part, ...(sameCode.length && confirm(t('detail.alsoSame', { n: sameCode.length })) ? sameCode : [])];
      rev.edit(makePatch(targets.map((p) => ({ op: 'setField' as const, partId: p.id, field: 'drawing' as const, value: out.drawing })), `Attach drawing ${out.drawing.name} to ${targets.length} part(s)`));
      useUi.getState().toast(t('detail.attached'), 'success');
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const canEdit = !rev.readOnly && !me.external && me.role !== 'viewer';
  return (
    <div className="focus-card sheet-cell wide" data-testid="drawing-card">
      <div className="row">
        <h4 className="grow" style={{ margin: 0 }}>
          {t('detail.design')}
        </h4>
        {canEdit && (
          <>
            <input ref={input} type="file" accept=".dxf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} data-testid="drawing-file" />
            <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}>
              <Icon name="share" size={16} /> {part.drawing ? t('detail.replace') : t('detail.attach')}
            </button>
            {part.drawing && (
              <button className="btn" onClick={() => rev.edit(makePatch([{ op: 'setField', partId: part.id, field: 'drawing', value: null }], `Remove drawing from ${part.name}`))}>
                {t('detail.remove')}
              </button>
            )}
          </>
        )}
      </div>
      {part.drawing ? <AttachedDrawing d={part.drawing} /> : <p className="muted">{t('detail.noDesign')}</p>}
    </div>
  );
}

function AttachedDrawing({ d }: { d: PartDrawing }) {
  const t = useT();
  const [dxf, setDxf] = useState<DxfDrawing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const src = `/api/files?uri=${encodeURIComponent(d.uri)}`;
  useEffect(() => {
    if (d.kind !== 'dxf') return;
    setDxf(null);
    setErr(null);
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((txt) => setDxf(parseDxf(txt)))
      .catch((e: Error) => setErr(e.message));
  }, [src, d.kind]);
  return (
    <div className="attached">
      <div className="muted small">
        {d.name} · {d.kind === 'dxf' ? `AutoCAD DXF${dxf ? ` · ${dxf.units} · ${dxf.layers.length} ${t('detail.layers')}` : ''}` : t('detail.picture')}
      </div>
      {d.kind === 'image' ? <img src={src} alt={d.name} className="attached-img" /> : err ? <div className="chip fail">{err}</div> : dxf ? <DxfSvg d={dxf} /> : <div className="muted">{t('common.loading')}</div>}
    </div>
  );
}

const LAYER_COLORS = ['#1f2937', '#2563eb', '#b45309', '#047857', '#7c3aed', '#be123c'];

function DxfSvg({ d }: { d: DxfDrawing }) {
  const b = d.bounds;
  const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.04 + 1;
  const vb = `${b.x0 - pad} ${-(b.y1 + pad)} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}`;
  const col = (layer: string) => LAYER_COLORS[d.layers.indexOf(layer) % LAYER_COLORS.length];
  return (
    <svg className="dxf-svg" viewBox={vb} preserveAspectRatio="xMidYMid meet" data-testid="dxf-svg">
      {d.shapes.map((s, i) => {
        const st = { stroke: col(s.layer), fill: 'none', vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1.2 };
        switch (s.kind) {
          case 'line':
            return <line key={i} x1={s.a.x} y1={-s.a.y} x2={s.b.x} y2={-s.b.y} style={st} />;
          case 'poly':
            return <polyline key={i} points={s.pts.map((p) => `${p.x},${-p.y}`).join(' ') + (s.closed ? ` ${s.pts[0].x},${-s.pts[0].y}` : '')} style={st} />;
          case 'circle':
            return <circle key={i} cx={s.c.x} cy={-s.c.y} r={s.r} style={st} />;
          case 'arc': {
            const a0 = (s.a0 * Math.PI) / 180;
            let a1 = (s.a1 * Math.PI) / 180;
            if (a1 <= a0) a1 += Math.PI * 2;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const p0 = { x: s.c.x + s.r * Math.cos(a0), y: -(s.c.y + s.r * Math.sin(a0)) };
            const p1 = { x: s.c.x + s.r * Math.cos(a1), y: -(s.c.y + s.r * Math.sin(a1)) };
            return <path key={i} d={`M${p0.x},${p0.y} A${s.r},${s.r} 0 ${large} 0 ${p1.x},${p1.y}`} style={st} />;
          }
          case 'text':
            return (
              <text key={i} x={s.at.x} y={-s.at.y} fontSize={s.h} fill={col(s.layer)} transform={s.rot ? `rotate(${-s.rot} ${s.at.x} ${-s.at.y})` : undefined}>
                {s.text}
              </text>
            );
        }
      })}
    </svg>
  );
}

/* ---- drawing helpers (drawing coordinates are mm, y up; SVG y = −y) ---- */

function Dim({ x0, y0, x1, y1, off, fs, label }: { x0: number; y0: number; x1: number; y1: number; off: number; fs: number; label: string }) {
  const horizontal = Math.abs(y1 - y0) < 1e-6;
  const a = horizontal ? { x: x0, y: y0 - off } : { x: x0 + off, y: y0 };
  const b = horizontal ? { x: x1, y: y1 - off } : { x: x1 + off, y: y1 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const tick = fs * 0.35;
  return (
    <g className="dim">
      <line x1={x0} y1={-y0} x2={a.x} y2={-a.y} />
      <line x1={x1} y1={-y1} x2={b.x} y2={-b.y} />
      <line x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} />
      <line x1={a.x - tick} y1={-a.y - tick} x2={a.x + tick} y2={-a.y + tick} />
      <line x1={b.x - tick} y1={-b.y - tick} x2={b.x + tick} y2={-b.y + tick} />
      <text x={mid.x} y={-mid.y + (horizontal ? fs * 1.2 : 0)} dx={horizontal ? 0 : fs * 0.5} fontSize={fs} textAnchor={horizontal ? 'middle' : 'start'} dominantBaseline={horizontal ? 'auto' : 'middle'}>
        {label}
      </text>
    </g>
  );
}

/** The part alone: front, side to the right, top below, each with its two sizes. */
function PartViews({ views }: { views: { view: string; rect: Box2 }[] }) {
  const t = useT();
  const v = Object.fromEntries(views.map((x) => [x.view, x.rect])) as Record<'front' | 'side' | 'top', Box2>;
  const w = (r: Box2) => r.x1 - r.x0;
  const h = (r: Box2) => r.y1 - r.y0;
  const span = Math.max(w(v.front) + w(v.side), h(v.front) + h(v.top));
  const gap = span * 0.25 + 20;
  const fs = Math.max(6, span * 0.045);
  // Place: front at origin; side right of it; top under it.
  const place = { front: { dx: -v.front.x0, dy: -v.front.y0 }, side: { dx: w(v.front) + gap - v.side.x0, dy: -v.side.y0 }, top: { dx: -v.top.x0, dy: -h(v.top) - gap - v.top.y0 } };
  const boxes = (['front', 'side', 'top'] as const).map((k) => ({ k, r: { x0: v[k].x0 + place[k].dx, y0: v[k].y0 + place[k].dy, x1: v[k].x1 + place[k].dx, y1: v[k].y1 + place[k].dy } }));
  const X0 = -gap * 0.3;
  const Y1 = Math.max(...boxes.map((b) => b.r.y1)) + fs * 2.2;
  const X1 = Math.max(...boxes.map((b) => b.r.x1)) + gap * 0.9;
  const Y0 = Math.min(...boxes.map((b) => b.r.y0)) - gap * 0.6;
  const label: Record<string, string> = { front: t('v3d.front'), side: t('v3d.side'), top: t('v3d.top') };
  return (
    <svg className="views-svg" viewBox={`${X0} ${-Y1} ${X1 - X0} ${Y1 - Y0}`} data-testid="part-views">
      {boxes.map(({ k, r }) => (
        <g key={k}>
          <rect x={r.x0} y={-r.y1} width={r.x1 - r.x0} height={r.y1 - r.y0} className="part-fill" />
          <text x={r.x0} y={-r.y1 - fs * 0.6} fontSize={fs * 0.9} className="view-label">
            {label[k]}
          </text>
          <Dim x0={r.x0} y0={r.y0} x1={r.x1} y1={r.y0} off={fs * 1.6} fs={fs} label={fmtMm(r.x1 - r.x0)} />
          <Dim x0={r.x1} y0={r.y0} x1={r.x1} y1={r.y1} off={fs * 1.2} fs={fs} label={fmtMm(r.y1 - r.y0)} />
        </g>
      ))}
    </svg>
  );
}

function CornerSvg({ c, nameOf }: { c: CornerDetail; nameOf: (id: string) => string }) {
  const t = useT();
  const w = c.window;
  const s = w.x1 - w.x0;
  const others = [...new Set(c.rects.filter((r) => !r.focus).map((r) => r.partId))];
  const shade = (id: string) => `hsl(${(others.indexOf(id) * 67) % 360} 30% ${78 - (others.indexOf(id) % 3) * 6}%)`;
  return (
    <figure className="corner" data-testid={`corner-${c.label}`}>
      <svg viewBox={`${w.x0} ${-w.y1} ${s} ${w.y1 - w.y0}`}>
        <rect x={w.x0} y={-w.y1} width={s} height={w.y1 - w.y0} fill="var(--panel-2)" />
        {/* Neighbours far → near, then the part itself on top so it is never hidden. */}
        {[...c.rects].sort((a, b) => Number(a.focus) - Number(b.focus) || b.depth - a.depth).map((r, i) => (
          <rect key={i} x={r.x0} y={-r.y1} width={r.x1 - r.x0} height={r.y1 - r.y0} className={r.focus ? 'part-fill focus' : 'part-fill other'} style={r.focus ? undefined : { fill: shade(r.partId) }} />
        ))}
        <circle cx={c.corner.x} cy={-c.corner.y} r={s * 0.025} fill="#dc2626" />
      </svg>
      <figcaption>
        <strong>
          {t('detail.corner')} {c.label}
        </strong>
        {others.length ? (
          <ul>
            {others.map((id) => (
              <li key={id}>
                <span className="swatch" style={{ background: shade(id) }} /> {nameOf(id)}
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted small">{t('detail.freeCorner')}</div>
        )}
      </figcaption>
    </figure>
  );
}

/** Knob / pull drawn from its BOM sizes when no supplier drawing is attached. */
function HardwareSymbol({ part }: { part: Part }) {
  const { T, W, L } = part.dims;
  const knob = part.role === 'knob';
  const fs = Math.max(4, Math.max(L, T) * 0.09);
  if (knob) {
    const r = W / 2;
    return (
      <svg className="views-svg" viewBox={`${-r - fs * 2} ${-r - fs * 3} ${2 * r + T + fs * 10} ${2 * r + fs * 6}`}>
        <circle cx={0} cy={0} r={r} className="part-fill" />
        <circle cx={0} cy={0} r={r * 0.35} fill="none" className="hidden-line" />
        <Dim x0={-r} y0={-r} x1={r} y1={-r} off={fs * 1.4} fs={fs} label={`Ø ${fmtMm(W)}`} />
        <g transform={`translate(${r + fs * 4} 0)`}>
          <rect x={0} y={-r} width={T * 0.7} height={2 * r} rx={T * 0.2} className="part-fill" />
          <rect x={T * 0.7} y={-r * 0.3} width={T * 0.3} height={r * 0.6} className="part-fill" />
          <Dim x0={0} y0={-r} x1={T} y1={-r} off={fs * 1.4} fs={fs} label={fmtMm(T)} />
        </g>
      </svg>
    );
  }
  return (
    <svg className="views-svg" viewBox={`${-fs * 2} ${-W - T - fs * 4} ${L + fs * 6} ${W + T + fs * 8}`}>
      <rect x={0} y={-W} width={L} height={W} rx={W * 0.3} className="part-fill" />
      <Dim x0={0} y0={0} x1={L} y1={0} off={fs * 1.4} fs={fs} label={fmtMm(L)} />
      <g transform={`translate(0 ${-W - fs * 1.2})`}>
        <rect x={0} y={-T} width={L} height={T * 0.3} className="part-fill" />
        <rect x={L * 0.06} y={-T} width={W * 0.5} height={T} className="part-fill" />
        <rect x={L * 0.94 - W * 0.5} y={-T} width={W * 0.5} height={T} className="part-fill" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Assembly sheet                                                      */
/* ------------------------------------------------------------------ */

function AssemblySheetView({ rev, content, analysis, assemblyId }: { rev: RevisionLive; content: RevisionContent; analysis: Analysis; assemblyId: string | null }) {
  const t = useT();
  const sheet = useMemo(() => assemblySheet(analysis.layout, content, assemblyId), [analysis, content, assemblyId]);
  const selection = useUi((s) => s.selection);
  if (!sheet) return <div className="focus-card muted">{t('detail.notDrawn')}</div>;
  const parts = new Map(content.parts.map((p) => [p.id, p]));
  const sel = new Set(selection.revisionId === rev.id ? selection.partIds : []);
  return (
    <div className="sheet-grid" data-testid="assembly-sheet">
      <div className="focus-card sheet-cell wide">
        <h4>
          {sheet.name} {sheet.count > 1 ? <span className="muted">× {sheet.count} ({t('detail.oneShown')})</span> : null}
        </h4>
        <AssemblyViews sheet={sheet} selected={sel} />
      </div>
      <div className="focus-card sheet-cell wide">
        <table className="grid detail-table" data-testid="assembly-table">
          <thead>
            <tr>
              <th>No</th>
              <th>{t('detail.partName')}</th>
              <th className="num">{t('detail.perAsm')}</th>
              <th className="num">T × W × L</th>
              <th>{t('props.material')}</th>
              <th>{t('props.finish')}</th>
              <th>Std Code</th>
            </tr>
          </thead>
          <tbody>
            {sheet.items.map((it) => {
              const p = parts.get(it.partId)!;
              return (
                <tr key={it.partId} className={sel.has(it.partId) ? 'selected' : ''} onClick={() => useUi.getState().select(rev.id, [it.partId])} style={{ cursor: 'pointer' }}>
                  <td>
                    <span className="balloon-chip">{it.no}</span>
                  </td>
                  <td>{p.name}</td>
                  <td className="num">{it.qty}</td>
                  <td className="num mono">
                    {fmtMm(p.dims.T)} × {fmtMm(p.dims.W)} × {fmtMm(p.dims.L)}
                  </td>
                  <td>{p.material ?? '—'}</td>
                  <td>{p.finishCode ?? '—'}</td>
                  <td className="mono">{p.stdCode ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssemblyViews({ sheet, selected }: { sheet: AssemblySheet; selected: Set<string> }) {
  const t = useT();
  const v = Object.fromEntries(sheet.views.map((p) => [p.view, p])) as Record<'front' | 'side' | 'top', Projection>;
  const w = (p: Projection) => p.bounds.x1 - p.bounds.x0;
  const h = (p: Projection) => p.bounds.y1 - p.bounds.y0;
  const span = Math.max(w(v.front) + w(v.side), h(v.front) + h(v.top));
  const gap = span * 0.18 + 30;
  const fs = Math.max(8, span * 0.03);
  const place = { front: { dx: -v.front.bounds.x0, dy: -v.front.bounds.y0 }, side: { dx: w(v.front) + gap - v.side.bounds.x0, dy: -v.side.bounds.y0 }, top: { dx: -v.top.bounds.x0, dy: -h(v.top) - gap - fs * 5 - v.top.bounds.y0 } };
  const X1 = w(v.front) + gap + w(v.side) + gap * 0.8;
  const Y1 = Math.max(h(v.front), h(v.side)) + fs * 6;
  const Y0 = -h(v.top) - gap - fs * 7;
  const label: Record<string, string> = { front: t('v3d.front'), side: t('v3d.side'), top: t('v3d.top') };
  return (
    <svg className="views-svg tall" viewBox={`${-gap * 0.5} ${-Y1} ${X1 + gap * 0.5} ${Y1 - Y0}`} data-testid="assembly-views">
      {(['front', 'side', 'top'] as const).map((k) => {
        const { dx, dy } = place[k];
        const p = v[k];
        return (
          <g key={k}>
            <text x={p.bounds.x0 + dx} y={-(p.bounds.y1 + dy) - fs * 4.2} fontSize={fs} className="view-label">
              {label[k]}
            </text>
            {p.rects.map((r) => (
              <rect key={r.key} x={r.x0 + dx} y={-(r.y1 + dy)} width={r.x1 - r.x0} height={r.y1 - r.y0} className={`part-fill ${selected.has(r.partId) ? 'focus' : ''}`} />
            ))}
            {(() => {
              // Balloons in a row above the view (sorted left → right), leaders down to the parts.
              const bs = sheet.balloons.filter((b) => b.view === k).sort((a, b) => a.x - b.x);
              const top = p.bounds.y1 + dy + fs * 2.6;
              const x0 = p.bounds.x0 + dx;
              const width = Math.max(p.bounds.x1 - p.bounds.x0, bs.length * fs * 2.3);
              return bs.map((b, n) => {
                const bx = b.x + dx;
                const by = b.y + dy;
                const lx = bs.length === 1 ? bx : x0 + fs + (n * (width - 2 * fs)) / Math.max(1, bs.length - 1);
                return (
                  <g key={b.no} className="balloon">
                    <line x1={bx} y1={-by} x2={lx} y2={-(top - fs * 0.85)} />
                    <circle cx={bx} cy={-by} r={fs * 0.18} />
                    <circle cx={lx} cy={-top} r={fs * 0.85} className="ring" />
                    <text x={lx} y={-top} fontSize={fs} textAnchor="middle" dominantBaseline="central">
                      {b.no}
                    </text>
                  </g>
                );
              });
            })()}
          </g>
        );
      })}
    </svg>
  );
}
