'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FrameItem } from '@bom/domain';
import { planFasteners } from '@bom/engine';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi, defaultFrameView, FOCUS_FRAME, type Lens, type ViewName } from '@/lib/store';
import { usePrefs } from '@/lib/prefs';
import { zoomBy } from '@/lib/zoom';
import type { MsgKey } from '@/lib/i18n';
import { Viewport3D } from '../frames/Viewport3D';
import { Sheet } from '../frames/Sheet';
import { BomTable } from '../frames/BomTable';
import { Findings } from '../frames/Findings';
import { Assumptions } from '../frames/Assumptions';
import { Icon } from '../Icon';

/** One product at a time, big: the 3D model, its drawing, its parts list or its checks. */
export function FocusView() {
  const t = useT();
  const view = useUi((s) => s.view);
  const revisionId = useUi((s) => s.activeRevisionId);
  const history = useUi((s) => s.historyRevisionId);
  const { revisions } = useEditor();
  const histRev = history ? revisions.get(history) : null;
  const shownId = histRev && revisionId && revisions.get(revisionId)?.productId === histRev.productId ? history : revisionId;
  const rev = useRevision(shownId);
  const markGuide = usePrefs((s) => s.markGuide);
  useEffect(() => {
    if (view === 'checks') markGuide('checks');
  }, [view, markGuide]);

  if (!revisionId) return <div className="focus-empty">{t('studio.pickProduct')}</div>;
  if (!rev?.content || !rev.analysis || !rev.bundle) return <div className="focus-empty">{rev?.error ?? t('common.loading')}</div>;
  const readOnly = rev.readOnly || shownId !== revisionId;
  const { content, analysis, bundle } = rev;
  return (
    <div className="focus-area" data-testid="focus-view" data-view={view}>
      {view === 'model' && <ModelView revisionId={rev.id} />}
      {view === 'drawing' && (
        <ScaledPane>
          {(w, h) => <Sheet frame={{ ...frameFor(rev.id), type: 'sheet', rect: { x: 0, y: 0, w, h: h + 28 } }} content={content} analysis={analysis} revision={bundle.revision} product={bundle.product} revisionId={rev.id} explode={0} sectionPlane={null} />}
        </ScaledPane>
      )}
      {view === 'parts' && (
        <ZoomPane className="focus-card big-table">
          <BomTable rev={rev} content={content} analysis={analysis} revisionId={rev.id} readOnly={readOnly} />
        </ZoomPane>
      )}
      {view === 'checks' && (
        <ZoomPane className="focus-split">
          <div className="focus-card">
            <Findings rev={rev} content={content} analysis={analysis} revisionId={rev.id} readOnly={readOnly} />
          </div>
          <div className="focus-card">
            <Assumptions rev={rev} content={content} analysis={analysis} readOnly={readOnly} />
          </div>
        </ZoomPane>
      )}
    </div>
  );
}

const frameFor = (revisionId: string): FrameItem => ({ id: FOCUS_FRAME, kind: 'frame', type: 'viewport', rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, title: '', productId: null, revisionId, props: { shading: 'material', lens: 'finished' } });

/** HTML views zoom with the zoom control (CSS zoom keeps scrolling right) and Ctrl+wheel. */
function ZoomPane({ className, children }: { className: string; children: React.ReactNode }) {
  const z = useUi((s) => s.focusZoom);
  const ref = useCtrlWheel();
  return (
    <div className="focus-scroll" ref={ref}>
      <div className={className} style={{ zoom: z }}>
        {children}
      </div>
    </div>
  );
}

/** The drawing is SVG at its own size: scale it, scroll when bigger than the screen. */
function ScaledPane({ children }: { children: (w: number, h: number) => React.ReactNode }) {
  const z = useUi((s) => s.focusZoom);
  const ref = useCtrlWheel();
  const [box, setBox] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 32, h: el.clientHeight - 32 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return (
    <div className="focus-scroll" ref={ref}>
      <div className="focus-card sheet-card" style={{ width: box.w * z, height: box.h * z }}>
        <div style={{ width: box.w, height: box.h, transform: `scale(${z})`, transformOrigin: '0 0', position: 'relative' }}>{children(box.w, box.h)}</div>
      </div>
    </div>
  );
}

function useCtrlWheel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // not the browser's page zoom
      zoomBy(Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  return ref;
}

const LENSES: [Lens, MsgKey][] = [
  ['finished', 'v3d.color.finished'],
  ['none', 'v3d.color.none'],
  ['engineering', 'v3d.color.engineering'],
  ['painting', 'v3d.color.painting'],
  ['hardware', 'v3d.color.hardware'],
  ['packing', 'v3d.color.packing'],
];
const VIEWS: [ViewName, MsgKey][] = [
  ['iso', 'v3d.iso'],
  ['front', 'v3d.front'],
  ['side', 'v3d.side'],
  ['top', 'v3d.top'],
];

function ModelView({ revisionId }: { revisionId: string }) {
  const t = useT();
  const rev = useRevision(revisionId);
  const stored = useUi((s) => s.frameViews[FOCUS_FRAME]);
  const view = stored ?? defaultFrameView({ shading: 'material', lens: 'finished' });
  const set = (p: Partial<typeof view>) => useUi.getState().setFrameView(FOCUS_FRAME, p);
  // The focused view starts in the finished look (later changes merge onto this, not onto the board default).
  useEffect(() => {
    if (!useUi.getState().frameViews[FOCUS_FRAME]) useUi.getState().setFrameView(FOCUS_FRAME, defaultFrameView({ shading: 'material', lens: 'finished' }));
  }, []);
  const showFasteners = usePrefs((s) => s.showFasteners);
  const setPrefs = usePrefs((s) => s.setPrefs);
  const frame = useMemo(() => frameFor(revisionId), [revisionId]);
  const plan = useMemo(() => (rev?.content && rev.analysis ? planFasteners(rev.analysis.content, rev.analysis.layout) : null), [rev?.content, rev?.analysis]);
  if (!rev?.content || !rev.analysis) return null;
  const nameOf = (id: string) => rev.content!.parts.find((p) => p.id === id)?.name ?? id;
  return (
    <>
      <div className="focus-canvas" onPointerDownCapture={() => useUi.setState({ activeFrameId: FOCUS_FRAME, activeRevisionId: revisionId })}>
        <Viewport3D frame={frame} rev={rev} content={rev.content} analysis={rev.analysis} view={view} readOnly={rev.readOnly} revisionId={revisionId} focus fasteners={showFasteners ? plan?.marks : null} />
      </div>
      <div className="float-bar view3d-bar" role="toolbar" aria-label={t('v3d.lookFrom')}>
        <div className="seg" title={t('v3d.lookFrom')}>
          {VIEWS.map(([v, k]) => (
            <button key={v} aria-pressed={view.view === v} onClick={() => set({ view: v, frameNonce: view.frameNonce + 1 })} data-testid={`look-${v}`}>
              {t(k)}
            </button>
          ))}
        </div>
        <span className="bar-sep" />
        <label className="bar-label" htmlFor="take-apart">
          {t('v3d.takeApart')}
        </label>
        <input id="take-apart" type="range" min={0} max={1} step={0.05} value={view.explode} onChange={(e) => set({ explode: Number(e.target.value) })} style={{ width: 80 }} data-testid="take-apart" />
        <span className="bar-sep" />
        <select id="color-by" className="select" value={view.lens} onChange={(e) => set({ lens: e.target.value as Lens })} aria-label={t('v3d.colorBy')} title={t('v3d.colorBy')}>
          {LENSES.map(([l, k]) => (
            <option key={l} value={l}>
              {t(k)}
            </option>
          ))}
        </select>
        <span className="bar-sep" />
        <button className={`toggle ${showFasteners ? 'on' : ''}`} aria-pressed={showFasteners} onClick={() => setPrefs({ showFasteners: !showFasteners })} data-testid="toggle-fasteners">
          <Icon name="screw" size={16} /> {t('v3d.fasteners')}
        </button>
      </div>
      {showFasteners && plan && (
        <div className="float-card fastener-legend" data-testid="fastener-legend">
          <div className="legend-note">{t('v3d.fastenersNote')}</div>
          {plan.lines.map((l) => (
            <div key={l.partId} className="legend-row">
              <span className={`dot k-${l.kind}`} />
              <span className="grow">{nameOf(l.partId)}</span>
              <span className="muted">{l.note === 'loose in the hardware bag' ? `×${l.qty} · ${l.note}` : t('v3d.fastenerShown', { shown: l.shown, qty: l.qty })}</span>
            </div>
          ))}
          {!plan.lines.length && <div className="muted">{t('common.none')}</div>}
        </div>
      )}
      <div className="turn-hint">{t('v3d.howToTurn')}</div>
    </>
  );
}
