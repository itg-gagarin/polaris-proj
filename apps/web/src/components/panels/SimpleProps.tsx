'use client';
import type { DimKey, Part } from '@bom/domain';
import { fmtMm, makePatch, parseMmInput } from '@bom/domain';
import { instanceCount } from '@bom/engine';
import { useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { usePrefs } from '@/lib/prefs';
import type { RevisionLive } from '@/lib/live';
import type { MsgKey } from '@/lib/i18n';
import { FindingCard } from '../frames/Findings';
import { Icon } from '../Icon';

const DIM_LABEL: Record<DimKey, MsgKey> = { L: 'insp.length', W: 'insp.width', T: 'insp.thickness' };

/** Nothing selected: what this product is, and what to do next. */
export function ProductSummary({ rev }: { rev: RevisionLive }) {
  const t = useT();
  const a = rev.analysis;
  const content = rev.content!;
  const b = a?.layout.bounds;
  const pieces = content.parts.reduce((s, p) => s + instanceCount(p), 0);
  const drawers = a?.layout.rows.flatMap((r) => r.slots).length ?? 0;
  return (
    <div className="simple-props" data-testid="product-summary">
      <div className="empty-hint">
        <Icon name="select" size={28} />
        <div>
          <strong>{t('insp.nothing')}</strong>
          <p>{t('insp.nothingHint')}</p>
        </div>
      </div>
      <h4>{t('insp.product')}</h4>
      <div className="kv big">
        {b && (
          <>
            <label>{t('insp.overall')}</label>
            <span className="mono">
              {fmtMm(b.max.x - b.min.x)} × {fmtMm(b.max.z - b.min.z)} × {fmtMm(b.max.y - b.min.y)} mm
            </span>
          </>
        )}
        <label>{t('studio.parts')}</label>
        <span>{t('insp.partsCount', { lines: content.parts.length, pieces })}</span>
        {drawers > 0 && (
          <>
            <label>{t('insp.drawers')}</label>
            <span>{drawers}</span>
          </>
        )}
        <label>{t('view.checks')}</label>
        <button className={`pill ${a?.summary.fail ? 'fail' : 'ok'}`} onClick={() => useUi.setState({ view: 'checks' })}>
          {a?.summary.fail ? t('studio.problems', { n: a.summary.fail }) : t('studio.noProblems')}
        </button>
      </div>
      {!rev.readOnly && (
        <div className="col" style={{ marginTop: 14 }}>
          <button className="btn big-row" onClick={() => useUi.setState({ addHardwareOpen: true })}>
            <Icon name="handle" /> {t('studio.addHardware')}
          </button>
          <button className="btn big-row" onClick={() => window.dispatchEvent(new CustomEvent('bom:add-part'))}>
            <Icon name="list" /> {t('studio.addCatalogue')}
          </button>
        </div>
      )}
    </div>
  );
}

function SizeBox({ rev, part, dim }: { rev: RevisionLive; part: Part; dim: DimKey }) {
  const t = useT();
  const expr = part.expressions[dim];
  const shown = expr ?? fmtMm(part.dims[dim]);
  const commit = (raw: string) => {
    const v = raw.trim();
    if (!v || v === shown) return;
    if (v.startsWith('=')) rev.edit(makePatch([{ op: 'setExpr', partId: part.id, dim, expr: v }], `${part.name}: ${dim} ${v}`));
    else {
      const n = parseMmInput(v);
      if (n === null || n <= 0) return void useUi.getState().toast(`"${v}" is not a size in mm`, 'error');
      rev.edit(makePatch([{ op: 'setDim', partId: part.id, dim, value: n }], `${part.name}: ${dim} ${part.dims[dim]} → ${n}`));
    }
    usePrefs.getState().markGuide('edit');
  };
  return (
    <label className="size-box">
      <span className="size-label">
        {t(DIM_LABEL[dim])} <span className="muted mono">({dim})</span>
      </span>
      <span className="size-input">
        <input
          key={`${part.id}-${dim}-${shown}`}
          className="input mono"
          defaultValue={shown}
          readOnly={rev.readOnly}
          aria-label={`${dim} size`}
          inputMode="decimal"
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => commit(e.currentTarget.value)}
          style={expr ? { color: 'var(--accent)' } : undefined}
        />
        <span className="unit">mm</span>
      </span>
    </label>
  );
}

/** One part selected (simple layout): plain labels, big boxes, the rest under "More details". */
export function SimplePartProps({ rev, part, details }: { rev: RevisionLive; part: Part; details: React.ReactNode }) {
  const t = useT();
  const a = rev.analysis;
  const findings = a?.findings.filter((f) => f.partIds.includes(part.id)) ?? [];
  const drawers = a?.layout.rows.flatMap((r) => r.slots).length ?? 0;
  const isFront = part.role === 'handle' || part.role === 'knob';
  const perDrawer = drawers ? Math.max(1, Math.round(part.qty / drawers)) : 0;
  const setField = <K extends 'qty' | 'material' | 'finishCode' | 'role'>(field: K, value: Part[K], label: string) => rev.edit(makePatch([{ op: 'setField', partId: part.id, field, value }], `${part.name}: ${label}`));
  return (
    <div className="simple-props" data-testid="part-props">
      {rev.readOnly && <div className="banner">{t('insp.readOnly')}</div>}
      <div className="part-title">
        <strong>{part.name}</strong>
        <span className="muted">
          {part.originalName !== part.name ? `${part.originalName} · ` : ''}
          {part.l1 ?? ''}
        </span>
      </div>
      {part.kind !== 'hardware' || part.attrs.geometric !== false ? (
        <>
          <h4>{t('insp.size')}</h4>
          <div className="size-grid" data-guide="size">
            <SizeBox rev={rev} part={part} dim="L" />
            <SizeBox rev={rev} part={part} dim="W" />
            <SizeBox rev={rev} part={part} dim="T" />
          </div>
          <div className="muted hint">{t('insp.typeHint')}</div>
        </>
      ) : null}
      <div className="kv big" style={{ marginTop: 10 }}>
        <label htmlFor={`qty-${part.id}`}>{t('insp.qty')}</label>
        <input
          id={`qty-${part.id}`}
          key={`${part.id}-qty-${part.qty}`}
          className="input"
          defaultValue={part.qty}
          readOnly={rev.readOnly}
          inputMode="numeric"
          style={{ width: 90 }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          onBlur={(e) => {
            const q = Number(e.currentTarget.value);
            if (Number.isInteger(q) && q >= 0 && q !== part.qty) setField('qty', q, `qty → ${q}`);
          }}
        />
        <label htmlFor={`mat-${part.id}`}>{t('props.material')}</label>
        <input id={`mat-${part.id}`} key={`${part.id}-mat-${part.material}`} className="input" defaultValue={part.material ?? ''} readOnly={rev.readOnly} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} onBlur={(e) => (e.currentTarget.value.trim() || null) !== (part.material ?? null) && setField('material', e.currentTarget.value.trim() || null, `material → ${e.currentTarget.value}`)} />
        <label htmlFor={`fin-${part.id}`}>{t('props.finish')}</label>
        <input id={`fin-${part.id}`} key={`${part.id}-fin-${part.finishCode}`} className="input" defaultValue={part.finishCode ?? ''} readOnly={rev.readOnly} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} onBlur={(e) => (e.currentTarget.value.trim() || null) !== (part.finishCode ?? null) && setField('finishCode', e.currentTarget.value.trim() || null, `finish → ${e.currentTarget.value}`)} />
      </div>
      {isFront && drawers > 0 && (
        <div className="hw-edit">
          <label>{t('insp.perDrawer')}</label>
          <div className="seg">
            {[1, 2].map((n) => (
              <button key={n} aria-pressed={perDrawer === n} disabled={rev.readOnly} onClick={() => perDrawer !== n && setField('qty', n * drawers, `${n} per drawer`)}>
                {n}
              </button>
            ))}
          </div>
          <label>{t('insp.changeTo')}</label>
          <div className="seg">
            <button aria-pressed={part.role === 'handle'} disabled={rev.readOnly} onClick={() => part.role !== 'handle' && setField('role', 'handle', 'pull handle')}>
              {t('insp.pull')}
            </button>
            <button aria-pressed={part.role === 'knob'} disabled={rev.readOnly} onClick={() => part.role !== 'knob' && setField('role', 'knob', 'knob')}>
              {t('insp.knob')}
            </button>
          </div>
        </div>
      )}
      <h4>{t('insp.problems')}</h4>
      {findings.length ? findings.map((f) => <FindingCard key={f.key} f={f} rev={rev} revisionId={rev.id} readOnly={rev.readOnly} />) : <div className="ok-line">✓ {t('findings.none')}</div>}
      <details className="more-details">
        <summary>{t('insp.more')}</summary>
        {details}
      </details>
    </div>
  );
}
