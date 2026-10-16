'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Part, WorkspaceSettings } from '@bom/domain';
import { canEditWorkspaceSettings, EDITABLE_THRESHOLDS, makePart, makePatch, TEAMS, type EditableThreshold } from '@bom/domain';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { usePrefs, type GuideStep, type Quality, type TextSize, type Theme, type UiMode } from '@/lib/prefs';
import { api } from '@/lib/api';
import type { MsgKey } from '@/lib/i18n';
import { Icon } from '../Icon';

function Modal({ title, onClose, children, footer, testid, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; testid: string; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal studio-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
        <header>
          <span className="grow">{title}</span>
          <button className="ibtn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange, name }: { value: T; options: [T, string][]; onChange: (v: T) => void; name: string }) {
  return (
    <div className="choice" role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <label key={v} className={`choice-item ${value === v ? 'on' : ''}`}>
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function SettingsDialog() {
  const t = useT();
  const open = useUi((s) => s.settingsOpen);
  const locale = useUi((s) => s.locale);
  const prefs = usePrefs();
  const { boot, me, live } = useEditor();
  const canWs = canEditWorkspaceSettings(me);
  const [th, setTh] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const cur = live.settings.thresholds;
    setTh(Object.fromEntries(EDITABLE_THRESHOLDS.map((k) => [k, String(cur[k])])));
    setErr(null);
  }, [open, live.settings]);
  if (!open) return null;
  const close = () => useUi.setState({ settingsOpen: false });
  const saveWs = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ settings: WorkspaceSettings }>('/api/workspace/settings', { method: 'PATCH', json: { thresholds: th } });
      live.setSettings(r.settings);
      boot.workspace.settings = r.settings;
      useUi.getState().toast(t('set.saved'), 'success');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('set.title')} onClose={close} testid="settings">
      <h3 className="set-h">{t('set.personal')}</h3>
      <div className="set-grid">
        <label>{t('set.language')}</label>
        <Choice name="language" value={locale} options={[['en', 'English'], ['id', 'Bahasa Indonesia']]} onChange={(v) => useUi.setState({ locale: v })} />
        <label>{t('set.textSize')}</label>
        <Choice<TextSize> name="text-size" value={prefs.textSize} options={[['normal', t('set.text.normal')], ['large', t('set.text.large')], ['xl', t('set.text.xl')]]} onChange={(v) => prefs.setPrefs({ textSize: v })} />
        <label>{t('set.mode')}</label>
        <Choice<UiMode>
          name="mode"
          value={prefs.mode}
          options={[['simple', t('set.mode.simple')], ['advanced', t('set.mode.advanced')]]}
          onChange={(v) => {
            prefs.setPrefs({ mode: v });
            if (v === 'simple' && useUi.getState().view === 'board') useUi.setState({ view: 'model' });
          }}
        />
        <label>{t('set.theme')}</label>
        <Choice<Theme> name="theme" value={prefs.theme} options={[['light', t('set.theme.light')], ['dark', t('set.theme.dark')], ['system', t('set.theme.system')]]} onChange={(v) => prefs.setPrefs({ theme: v })} />
        <label>{t('set.quality')}</label>
        <Choice<Quality> name="quality" value={prefs.quality} options={[['high', t('set.quality.high')], ['fast', t('set.quality.fast')]]} onChange={(v) => prefs.setPrefs({ quality: v })} />
        <span />
        <label className="check">
          <input type="checkbox" checked={prefs.hints} onChange={(e) => prefs.setPrefs({ hints: e.target.checked })} /> {t('set.hints')}
        </label>
        <span />
        <label className="check">
          <input type="checkbox" checked={!prefs.guideHidden} onChange={(e) => prefs.setPrefs({ guideHidden: !e.target.checked, ...(e.target.checked ? { guideDone: [] } : {}) })} data-testid="set-guide" /> {t('set.guide')}
        </label>
      </div>
      <h3 className="set-h">{t('set.workspace')}</h3>
      <p className="muted">{t('set.workspaceHint')}</p>
      <div className="set-grid th">
        {EDITABLE_THRESHOLDS.map((k) => (
          <ThresholdRow key={k} k={k} value={th[k] ?? ''} disabled={!canWs} onChange={(v) => setTh((x) => ({ ...x, [k]: v }))} label={t(`set.th.${k}` as MsgKey)} />
        ))}
      </div>
      {err && <div className="chip fail" style={{ marginTop: 8 }}>{err}</div>}
      {canWs && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn primary" onClick={saveWs} disabled={busy} data-testid="save-workspace">
            {t('common.save')}
          </button>
        </div>
      )}
    </Modal>
  );
}

function ThresholdRow({ k, value, disabled, onChange, label }: { k: EditableThreshold; value: string; disabled: boolean; onChange: (v: string) => void; label: string }) {
  return (
    <>
      <label htmlFor={`th-${k}`}>{label}</label>
      <input id={`th-${k}`} className="input mono" inputMode="decimal" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ width: 110 }} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */

export function HelpDialog() {
  const t = useT();
  const open = useUi((s) => s.helpOpen);
  const setPrefs = usePrefs((s) => s.setPrefs);
  if (!open) return null;
  const close = () => useUi.setState({ helpOpen: false });
  const qa: [MsgKey, MsgKey][] = [
    ['help.q1', 'help.a1'],
    ['help.q2', 'help.a2'],
    ['help.q3', 'help.a3'],
    ['help.q4', 'help.a4'],
    ['help.q5', 'help.a5'],
    ['help.q6', 'help.a6'],
    ['help.q7', 'help.a7'],
  ];
  const keys: [string, MsgKey][] = [
    ['Ctrl +', 'help.k.zoomIn'],
    ['Ctrl −', 'help.k.zoomOut'],
    ['Shift 1', 'help.k.fit'],
    ['Ctrl Z', 'help.k.undo'],
    ['Ctrl Y', 'help.k.redo'],
    ['Ctrl K', 'help.k.search'],
    ['Esc', 'help.k.esc'],
  ];
  return (
    <Modal title={t('help.title')} onClose={close} testid="help">
      <h3 className="set-h">{t('help.how')}</h3>
      {qa.map(([q, a]) => (
        <details key={q} className="faq">
          <summary>{t(q)}</summary>
          <p>{t(a)}</p>
        </details>
      ))}
      <h3 className="set-h">{t('help.keys')}</h3>
      <table className="keys">
        <tbody>
          {keys.map(([k, l]) => (
            <tr key={k}>
              <td>
                <span className="kbd big">{k}</span>
              </td>
              <td>{t(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => (setPrefs({ guideHidden: false, guideDone: [] }), close())}>
        {t('help.replayGuide')}
      </button>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Add hardware                                                        */
/* ------------------------------------------------------------------ */

type HwKind = 'handle' | 'knob' | 'glide' | 'slide' | 'screw';
interface HwDef {
  kind: HwKind;
  icon: string;
  title: MsgKey;
  desc: MsgKey;
  name: string;
  sizes: { label: string; dims: Part['dims'] }[];
  axisMap: Part['axisMap'];
  unit: Part['unit'];
  geometric: boolean;
  per: 'drawer' | 'leg' | 'count';
}

const HW: HwDef[] = [
  { kind: 'handle', icon: 'handle', title: 'hw.handle', desc: 'hw.handleDesc', name: 'handle pull', sizes: [96, 128, 160, 192].map((cc) => ({ label: `${cc} mm`, dims: { T: 25, W: 20, L: cc } })), axisMap: { T: 'z', W: 'y', L: 'x' }, unit: 'pcs', geometric: true, per: 'drawer' },
  { kind: 'knob', icon: 'knob', title: 'hw.knob', desc: 'hw.knobDesc', name: 'handle knop', sizes: [25, 30, 35, 40].map((d) => ({ label: `Ø ${d} mm`, dims: { T: 25, W: d, L: d } })), axisMap: { T: 'z', W: 'y', L: 'x' }, unit: 'pcs', geometric: true, per: 'drawer' },
  { kind: 'glide', icon: 'glide', title: 'hw.glide', desc: 'hw.glideDesc', name: 'adj glide', sizes: [20, 25, 30].map((d) => ({ label: `Ø ${d} mm`, dims: { T: 10, W: d, L: d } })), axisMap: { T: 'y', W: 'z', L: 'x' }, unit: 'pcs', geometric: true, per: 'leg' },
  { kind: 'slide', icon: 'slide', title: 'hw.slide', desc: 'hw.slideDesc', name: 'peluncur side mounted full ext', sizes: [250, 300, 350, 400, 450, 500].map((l) => ({ label: `${l} mm`, dims: { T: 12.7, W: 45, L: l } })), axisMap: { T: 'x', W: 'y', L: 'z' }, unit: 'pair', geometric: true, per: 'drawer' },
  { kind: 'screw', icon: 'screw', title: 'hw.screw', desc: 'hw.screwDesc', name: 'sekrup', sizes: [{ label: '—', dims: { T: 0, W: 0, L: 0 } }], axisMap: null, unit: 'pcs', geometric: false, per: 'count' },
];

const LEG_ROLES = new Set(['legFront', 'legBack', 'centerLeg', 'tableLeg', 'bedPost', 'lowerLeg']);

export function AddHardwareDialog() {
  const t = useT();
  const open = useUi((s) => s.addHardwareOpen);
  const revId = useUi((s) => s.activeRevisionId);
  const rev = useRevision(revId);
  const [kind, setKind] = useState<HwKind>('handle');
  const [size, setSize] = useState(1);
  const [per, setPer] = useState(1);
  const [count, setCount] = useState(20);
  const [sku, setSku] = useState('');
  const def = HW.find((h) => h.kind === kind)!;
  const [name, setName] = useState(def.name);
  useEffect(() => {
    setName(def.name);
    setSize(Math.min(1, def.sizes.length - 1));
    setPer(1);
  }, [kind, def.name, def.sizes.length]);
  const layout = rev?.analysis?.layout;
  const drawers = useMemo(() => layout?.rows.flatMap((r) => r.slots).length ?? 0, [layout]);
  const legs = useMemo(() => layout?.instances.filter((i) => LEG_ROLES.has(i.role ?? '') && i.min.y <= 1).length ?? 0, [layout]);
  if (!open || !rev?.content) return null;
  const close = () => useUi.setState({ addHardwareOpen: false });
  const qty = def.per === 'drawer' ? per * drawers : def.per === 'leg' ? legs : count;
  const hwLine = rev.content.parts.find((p) => p.kind === 'hardware');
  const noPlace = (def.per === 'drawer' && !drawers) || (def.per === 'leg' && !legs);
  const add = () => {
    const dims = def.sizes[size]?.dims ?? def.sizes[0].dims;
    const part = makePart({
      originalName: name.trim() || def.name,
      name: name.trim() || def.name,
      kind: 'hardware',
      role: kind === 'screw' ? 'fastener' : kind,
      roleSource: 'manual',
      dims,
      axisMap: def.axisMap,
      qty,
      unit: def.unit,
      teamOwner: 'hardware',
      hardwareSku: sku.trim() || null,
      assemblyId: hwLine?.assemblyId ?? null,
      l1: hwLine?.l1 ?? 'Hardware',
      l2: name.trim() || def.name,
      stdCode: hwLine?.stdCode ?? null,
      match: { status: 'manual', score: 1, candidates: [] },
      attrs: { section: 'hardware', geometric: def.geometric, axisSource: def.geometric ? 'column' : null },
    });
    rev.edit(makePatch([{ op: 'addPart', part }], `Add ${part.name} ×${qty}`));
    useUi.getState().select(rev.id, [part.id]);
    usePrefs.getState().markGuide('edit');
    close();
  };
  return (
    <Modal
      title={t('hw.title')}
      onClose={close}
      testid="add-hardware-dialog"
      wide
      footer={
        <>
          <span className="grow muted">{noPlace ? t('hw.noDrawers') : t('hw.summary', { name: name || def.name, qty, team: TEAMS.hardware.label.en })}</span>
          <button className="btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={add} disabled={rev.readOnly || qty <= 0 || noPlace} data-testid="hw-add">
            {t('hw.add')}
          </button>
        </>
      }
    >
      <p className="muted">{t('hw.intro')}</p>
      <div className="hw-grid" role="radiogroup" aria-label={t('hw.title')}>
        {HW.map((h) => (
          <button key={h.kind} role="radio" aria-checked={kind === h.kind} className={`hw-card ${kind === h.kind ? 'on' : ''}`} onClick={() => setKind(h.kind)} data-testid={`hw-${h.kind}`}>
            <Icon name={h.icon} size={34} />
            <strong>{t(h.title)}</strong>
            <span className="muted">{t(h.desc)}</span>
          </button>
        ))}
      </div>
      <div className="set-grid" style={{ marginTop: 14 }}>
        {def.sizes.length > 1 && (
          <>
            <label>{t('hw.size')}</label>
            <Choice name="hw-size" value={String(size)} options={def.sizes.map((s, i) => [String(i), s.label])} onChange={(v) => setSize(Number(v))} />
          </>
        )}
        {def.per === 'drawer' && def.kind !== 'slide' && (
          <>
            <label>{t('hw.perDrawer')}</label>
            <Choice name="hw-per" value={String(per)} options={[['1', '1'], ['2', '2']]} onChange={(v) => setPer(Number(v))} />
          </>
        )}
        {def.per === 'count' && (
          <>
            <label htmlFor="hw-count">{t('hw.count')}</label>
            <input id="hw-count" className="input" type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, Math.round(Number(e.target.value) || 1)))} style={{ width: 110 }} />
          </>
        )}
        <label htmlFor="hw-name">{t('hw.name')}</label>
        <input id="hw-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="hw-sku">{t('hw.sku')}</label>
        <input id="hw-sku" className="input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="HOONE A11383" />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Getting-started guide                                               */
/* ------------------------------------------------------------------ */

const STEPS: { s: GuideStep; k: MsgKey; target: string; go?: () => void }[] = [
  { s: 'pick', k: 'guide.pick', target: '[data-guide="parts"]', go: () => useUi.setState({ leftOpen: true, leftTab: 'outliner', view: 'model' }) },
  { s: 'edit', k: 'guide.edit', target: '[data-guide="size"]', go: () => useUi.setState({ rightOpen: true, rightTab: 'properties' }) },
  { s: 'checks', k: 'guide.checks', target: '[data-testid="view-checks"]' },
  { s: 'review', k: 'guide.review', target: '[data-testid="tab-review"]', go: () => useUi.setState({ rightOpen: true }) },
];

export function GuideCard() {
  const t = useT();
  const hidden = usePrefs((s) => s.guideHidden);
  const done = usePrefs((s) => s.guideDone);
  const setPrefs = usePrefs((s) => s.setPrefs);
  const markGuide = usePrefs((s) => s.markGuide);
  const selection = useUi((s) => s.selection.partIds.length);
  const rightTab = useUi((s) => s.rightTab);
  useEffect(() => {
    if (selection > 0) markGuide('pick');
  }, [selection, markGuide]);
  useEffect(() => {
    if (rightTab === 'review') markGuide('review');
  }, [rightTab, markGuide]);
  if (hidden) return null;
  const all = STEPS.every((x) => done.includes(x.s));
  const showMe = (target: string, go?: () => void) => {
    go?.();
    setTimeout(() => {
      const el = document.querySelector(target) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('guide-flash');
      setTimeout(() => el.classList.remove('guide-flash'), 2400);
    }, 120);
  };
  return (
    <div className="float-card guide-card" data-testid="guide">
      <div className="row">
        <strong className="grow">{t('guide.title')}</strong>
        <button className="ibtn" onClick={() => setPrefs({ guideHidden: true })} aria-label={t('guide.hide')} title={t('guide.hide')}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {all ? (
        <p className="muted" style={{ margin: '6px 0 0' }}>{t('guide.done')}</p>
      ) : (
        <ol className="guide-steps">
          {STEPS.map((x, n) => {
            const ok = done.includes(x.s);
            return (
              <li key={x.s} className={ok ? 'done' : ''} data-testid={`guide-${x.s}`}>
                <span className="step-n">{ok ? '✓' : n + 1}</span>
                <span className="grow">{t(x.k)}</span>
                {!ok && (
                  <button className="btn small" onClick={() => showMe(x.target, x.go)}>
                    {t('guide.showMe')}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
