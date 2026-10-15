'use client';
import { useMemo, useState } from 'react';
import type { FrameItem, FrameType } from '@bom/domain';
import { applyPatches, DEFAULT_SETTINGS } from '@bom/domain';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi, defaultFrameView, type Lens, type Shading, type ViewName } from '@/lib/store';
import { Viewport3D } from './frames/Viewport3D';
import { Sheet } from './frames/Sheet';
import { BomTable } from './frames/BomTable';
import { Findings } from './frames/Findings';
import { Assumptions } from './frames/Assumptions';
import { Compare } from './frames/Compare';

/** One frame on the board, positioned in screen space (so 3D renders at real resolution). */
export function FrameHost({ item, screen, onStartDrag, onStartResize, onRemove }: { item: FrameItem; screen: { x: number; y: number; w: number; h: number; zoom: number }; onStartDrag: (e: React.PointerEvent) => void; onStartResize: (e: React.PointerEvent) => void; onRemove: () => void }) {
  const t = useT();
  const { revisions, boot } = useEditor();
  const ui = useUi();
  const history = ui.historyRevisionId;
  const histRev = history ? revisions.get(history) : null;
  const shownId = histRev && item.productId === histRev.productId && item.type !== 'compare' ? history : item.revisionId;
  const rev = useRevision(shownId);
  const view = ui.frameViews[item.id] ?? defaultFrameView(item.props);
  const set = (p: Partial<typeof view>) => useUi.getState().setFrameView(item.id, p);
  const active = ui.activeFrameId === item.id;
  const content = rev?.content;
  const analysis = rev?.analysis;
  const bundle = rev?.bundle;
  const readOnly = !rev || rev.readOnly || shownId !== item.revisionId;
  const settings = boot.workspace.settings ?? DEFAULT_SETTINGS;

  // Native frames (3D) render at screen size; HTML/SVG frames render at board size and scale.
  const native = item.type === 'viewport' || item.type === 'compare';
  const bodyW = item.rect.w;
  const bodyH = item.rect.h - 28;

  const suggestion = ui.ai.suggestion;
  const aiAfter = useMemo(() => {
    if (item.type !== 'compare' || item.props.mode !== 'ai' || !suggestion || !content) return null;
    try {
      return applyPatches(content, suggestion.changes.filter((c) => ui.ai.accepted.includes(c.id)).map((c) => c.patch));
    } catch {
      return content;
    }
  }, [item.type, item.props.mode, suggestion, content, ui.ai.accepted]);
  const baseRev = useRevision(item.type === 'compare' && item.props.mode !== 'ai' ? ((item.props.baseRevisionId as string) ?? bundle?.revision.parentRevisionId ?? null) : null);

  let body: React.ReactNode = <div className="muted" style={{ padding: 12 }}>{rev?.error ?? t('common.loading')}</div>;
  if (rev && content && analysis && bundle) {
    switch (item.type as FrameType) {
      case 'viewport':
        body = <Viewport3D frame={item} rev={rev} content={content} analysis={analysis} view={view} readOnly={readOnly} revisionId={rev.id} />;
        break;
      case 'sheet':
        body = <Sheet frame={item} content={content} analysis={analysis} revision={bundle.revision} product={bundle.product} revisionId={rev.id} explode={view.explode} sectionPlane={view.section} />;
        break;
      case 'bom':
        body = <BomTable rev={rev} content={content} analysis={analysis} revisionId={rev.id} readOnly={readOnly} />;
        break;
      case 'findings':
        body = <Findings rev={rev} content={content} analysis={analysis} revisionId={rev.id} readOnly={readOnly} />;
        break;
      case 'assumptions':
        body = <Assumptions rev={rev} content={content} analysis={analysis} readOnly={readOnly} />;
        break;
      case 'compare':
        if (item.props.mode === 'ai' && !aiAfter) body = <div className="muted" style={{ padding: 12 }}>No AI suggestion is open for this revision. Run AI optimize, or close this frame.</div>;
        else if (item.props.mode === 'ai' && aiAfter) body = <Compare before={content} after={aiAfter} beforeLabel={`${bundle.revision.label} now`} afterLabel="AI suggestion" settings={settings} onSelect={(ids) => useUi.getState().select(rev.id, ids)} />;
        else if (baseRev?.content) body = <Compare before={baseRev.content} after={content} beforeLabel={baseRev.bundle?.revision.label ?? 'base'} afterLabel={bundle.revision.label} settings={settings} onSelect={(ids) => useUi.getState().select(rev.id, ids)} />;
        else body = <div className="muted" style={{ padding: 12 }}>{bundle.revision.parentRevisionId ? t('common.loading') : 'This revision has no parent to compare with.'}</div>;
        break;
      default:
        body = <div className="muted" style={{ padding: 12 }}>{item.type}</div>;
    }
  }

  return (
    <div
      className={`frame ${active ? 'active' : ''}`}
      style={{ left: screen.x, top: screen.y, width: screen.w, height: screen.h }}
      data-frame={item.id}
      data-type={item.type}
      data-lens={view.lens}
      data-section={view.section ? `${view.section.axis}:${view.section.at}` : ''}
      // Capture phase: the title bar's drag handler stops propagation, but a click there still activates the frame.
      onPointerDownCapture={() => useUi.setState({ activeFrameId: item.id, activeRevisionId: shownId ?? null })}
    >
      <div className="frame-title" onPointerDown={onStartDrag} onDoubleClick={() => set({ frameNonce: view.frameNonce + 1 })}>
        <span className="title ellipsis">{item.title}</span>
        {bundle && (
          <span className={`chip ${bundle.revision.state === 'released' ? 'ok' : bundle.revision.state === 'changes_requested' ? 'fail' : 'info'}`}>
            {bundle.revision.label} · {bundle.revision.state.replace('_', ' ')}
          </span>
        )}
        {shownId !== item.revisionId && <span className="chip warn">history</span>}
        {analysis && (
          <span className={`chip ${analysis.summary.fail ? 'fail' : 'ok'}`} title={`${analysis.summary.warn} warnings`}>
            {analysis.summary.fail} ✕ {analysis.summary.warn} !
          </span>
        )}
        <span className="spacer" />
        {item.type === 'viewport' && screen.w > 560 && (
          <div className="row" onPointerDown={(e) => e.stopPropagation()}>
            <select className="select" aria-label="Shading" value={view.shading} onChange={(e) => set({ shading: e.target.value as Shading })} style={{ fontSize: 11, padding: '0 4px' }}>
              {(['solid', 'material', 'wireframe', 'xray'] as Shading[]).map((s) => (
                <option key={s} value={s}>
                  {t(`shading.${s}`)}
                </option>
              ))}
            </select>
            <select className="select" aria-label="Lens" value={view.lens} onChange={(e) => set({ lens: e.target.value as Lens })} style={{ fontSize: 11, padding: '0 4px' }}>
              {(['none', 'painting', 'hardware', 'engineering', 'packing'] as Lens[]).map((s) => (
                <option key={s} value={s}>
                  {t(`lens.${s}`)}
                </option>
              ))}
            </select>
            <select className="select" aria-label="View" value={view.view} onChange={(e) => set({ view: e.target.value as ViewName, frameNonce: view.frameNonce + 1 })} style={{ fontSize: 11, padding: '0 4px' }}>
              {(['iso', 'front', 'side', 'top', 'back'] as ViewName[]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input type="range" min={0} max={1} step={0.05} value={view.explode} onChange={(e) => set({ explode: Number(e.target.value) })} aria-label="Explode" title="Explode (Shift+X)" style={{ width: 60 }} />
            {view.section && (
              <button className="btn small" onClick={() => set({ section: null })} title="Remove section plane">
                ✂ {view.section.axis.toUpperCase()} {view.section.at}
              </button>
            )}
          </div>
        )}
        <button className="btn small ghost" aria-label="Remove frame" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>
          ✕
        </button>
      </div>
      <div className="frame-body">
        {native ? (
          body
        ) : (
          <div className="frame-scaled" style={{ width: bodyW, height: bodyH, transform: `scale(${screen.zoom})` }}>
            {body}
          </div>
        )}
        {view.section && item.type === 'viewport' && (
          <div className="frame-toolbar" style={{ top: 'auto', bottom: 6 }} onPointerDown={(e) => e.stopPropagation()}>
            <span className="chip">section {view.section.axis.toUpperCase()}</span>
            <SectionSlider frameId={item.id} />
          </div>
        )}
      </div>
      <div className="frame-resize" onPointerDown={onStartResize} />
    </div>
  );
}

function SectionSlider({ frameId }: { frameId: string }) {
  const view = useUi((s) => s.frameViews[frameId]);
  const [v, setV] = useState(view?.section?.at ?? 0);
  if (!view?.section) return null;
  return (
    <input
      type="range"
      min={-200}
      max={3000}
      step={1}
      value={v}
      aria-label="Section position (mm)"
      onChange={(e) => {
        setV(Number(e.target.value));
        useUi.getState().setFrameView(frameId, { section: { ...view.section!, at: Number(e.target.value) } });
      }}
    />
  );
}
