'use client';
import { useState } from 'react';
import { TEAMS } from '@bom/domain';
import { useEditor, useLiveVersion, usePresenceVersion, useRevision, useT } from '@/lib/editor';
import { useUi, type MainView, type Tool } from '@/lib/store';
import { usePrefs } from '@/lib/prefs';
import { cameraSetters } from '@/lib/registry';
import { api, download } from '@/lib/api';
import { zoomFit, zoomIn, zoomOut, zoomPercent, zoomReset } from '@/lib/zoom';
import { parseCommand } from '@/lib/commands';
import { runCommand } from '@/lib/exec';
import type { MsgKey } from '@/lib/i18n';
import type { AppNotification } from '@bom/domain';
import { Icon } from '../Icon';
import { initials } from '../TopBar';

/** Hover explanation (Settings → hints off removes them). */
export function useTip() {
  const hints = usePrefs((s) => s.hints);
  return (text: string) => (hints ? text : undefined);
}

/** Top-left: home, product, version, saved state, problems. */
export function TitleCard() {
  const t = useT();
  const tip = useTip();
  const { live, products } = useEditor();
  useLiveVersion();
  const revId = useUi((s) => s.activeRevisionId);
  const history = useUi((s) => s.historyRevisionId);
  const rev = useRevision(revId);
  const bundle = rev?.bundle;
  const product = bundle ? products.get(bundle.revision.productId) : null;
  const sibs = [...(bundle?.siblings ?? [])].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const a = rev?.analysis;
  return (
    <div className="float-card title-card" data-testid="title-card">
      <a className="ibtn big" href="/" title={tip(t('studio.home'))} aria-label={t('studio.home')} data-testid="go-home">
        <Icon name="home" />
      </a>
      <div className="title-text">
        <div className="title-product ellipsis">{product ? product.name : t('app.name')}</div>
        {product && bundle && (
          <div className="title-sub" title={product.code}>
            <select
              className="select bare"
              aria-label={t('studio.version')}
              value={history ?? bundle.revision.id}
              onChange={(e) => useUi.setState({ historyRevisionId: e.target.value === bundle.revision.id ? null : e.target.value })}
              data-testid="revision-chip"
            >
              {sibs.map((s) => (
                <option key={s.id} value={s.id}>
                  {t('studio.version')} {s.label}
                  {s.branch ? ` (${s.branch.name})` : ''} · {s.state.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {a && (
        <button className={`pill small ${a.summary.fail ? 'fail' : 'ok'}`} onClick={() => useUi.setState({ view: 'checks' })} title={tip(a.summary.fail ? t('studio.problems', { n: a.summary.fail }) : t('studio.noProblems'))} data-testid="problems-pill">
          {a.summary.fail ? `${a.summary.fail} ✕` : '✓'}
        </button>
      )}
      <span className={`save-dot ${!live.online ? 'offline' : live.saving ? 'saving' : 'saved'}`} title={!live.online ? t('studio.offline') : live.saving ? t('studio.saving') : t('studio.saved')} aria-label={!live.online ? t('studio.offline') : live.saving ? t('studio.saving') : t('studio.saved')} />
    </div>
  );
}

const VIEWS: { v: MainView; k: MsgKey; icon: string }[] = [
  { v: 'model', k: 'view.model', icon: 'cube' },
  { v: 'drawing', k: 'view.drawing', icon: 'drawing' },
  { v: 'parts', k: 'view.parts', icon: 'list' },
  { v: 'checks', k: 'view.checks', icon: 'check' },
  { v: 'board', k: 'view.board', icon: 'board' },
];

/** Top centre: what to look at. Board only in the advanced layout. */
export function ViewSwitcher() {
  const t = useT();
  const tip = useTip();
  const view = useUi((s) => s.view);
  const mode = usePrefs((s) => s.mode);
  return (
    <div className="float-card view-switch" role="tablist" aria-label="View">
      {VIEWS.filter((x) => x.v !== 'board' || mode === 'advanced').map((x) => (
        <button key={x.v} role="tab" aria-selected={view === x.v} onClick={() => useUi.setState({ view: x.v })} title={tip(x.v === 'board' ? t('view.boardHint') : t(x.k))} data-testid={`view-${x.v}`}>
          <Icon name={x.icon} size={17} />
          <span>{t(x.k)}</span>
        </button>
      ))}
    </div>
  );
}

/** Top right: people, share, notifications, AI, help, settings. */
export function TopActions() {
  const t = useT();
  const tip = useTip();
  const { boot, live, me, reloadBoot } = useEditor();
  usePresenceVersion();
  const following = useUi((s) => s.following);
  const locale = useUi((s) => s.locale);
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = boot.notifications.filter((n) => !n.read);
  const peers = live.peers();
  const canEdit = !(me.external || me.role === 'viewer' || me.role === 'reviewer');

  const follow = (userId: string) => {
    if (following === userId) {
      useUi.setState({ following: null });
      live.presence({ following: null });
      return;
    }
    useUi.setState({ following: userId });
    live.presence({ following: userId });
    const p = peers.find((x) => x.user.id === userId);
    if (p?.view) {
      useUi.setState({ board: p.view.board });
      if (p.view.frameId && p.view.camera) cameraSetters.get(p.view.frameId)?.(p.view.camera);
    }
  };
  const runAi = () => {
    if (!useUi.getState().activeRevisionId) return useUi.getState().toast(t('studio.pickProduct'), 'error');
    useUi.setState({ rightTab: 'ai', rightOpen: true });
    window.dispatchEvent(new CustomEvent('bom:run-ai'));
  };
  const markRead = async () => {
    await api('/api/notifications', { method: 'POST', json: { read: unread.map((n) => n.id) } });
    await reloadBoot();
  };
  return (
    <div className="float-card top-actions">
      <div className="avatars" aria-label="People here">
        {peers.map((p) => (
          <span key={p.clientId} className={`avatar ${following === p.user.id ? 'following' : ''}`} style={{ background: p.user.color }} title={`${p.user.name} (${TEAMS[p.user.team as keyof typeof TEAMS]?.label.en ?? p.user.team}) · click to follow`} onClick={() => follow(p.user.id)}>
            {initials(p.user.name)}
          </span>
        ))}
        <span className="avatar" style={{ background: me.color }} title={`${me.name} (you)`}>
          {initials(me.name)}
        </span>
      </div>
      <button className="btn ai" onClick={runAi} disabled={!boot.ai.enabled || !canEdit} data-testid="ai-optimize" title={tip(boot.ai.provider === 'mock' ? 'Using the deterministic mock model (set AI_PROVIDER=claude for Claude)' : 'Claude')}>
        <Icon name="sparkle" size={16} /> {t('top.aiOptimize')}
      </button>
      <button className="ibtn" onClick={() => navigator.clipboard?.writeText(location.href).then(() => useUi.getState().toast('Link copied', 'success'))} title={tip(t('top.share'))} aria-label={t('top.share')}>
        <Icon name="share" />
      </button>
      <div style={{ position: 'relative' }}>
        <button className="ibtn" onClick={() => setNotifOpen((o) => !o)} aria-label={t('top.notifications')} title={tip(t('top.notifications'))}>
          <Icon name="bell" />
          {unread.length > 0 && <span className="badge">{unread.length}</span>}
        </button>
        {notifOpen && (
          <div className="popover" style={{ right: 0, width: 360 }}>
            <div className="row">
              <strong className="grow">{t('top.notifications')}</strong>
              <button className="btn small" onClick={markRead} disabled={!unread.length}>
                Mark all read
              </button>
            </div>
            {boot.notifications.slice(0, 40).map((n: AppNotification) => (
              <div key={n.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', opacity: n.read ? 0.6 : 1 }}>
                <span className="chip">{n.kind}</span> {n.text}
              </div>
            ))}
            {!boot.notifications.length && <div className="muted">{t('common.none')}</div>}
          </div>
        )}
      </div>
      <select className="select lang" value={locale} onChange={(e) => useUi.setState({ locale: e.target.value as 'en' | 'id' })} aria-label="Language" title={tip(t('set.language'))}>
        <option value="en">EN</option>
        <option value="id">ID</option>
      </select>
      <button className="ibtn" onClick={() => useUi.setState({ helpOpen: true })} aria-label={t('studio.help')} title={tip(t('studio.help'))} data-testid="open-help">
        <Icon name="help" />
      </button>
      <button className="ibtn" onClick={() => useUi.setState({ settingsOpen: true })} aria-label={t('studio.settings')} title={tip(t('studio.settings'))} data-testid="open-settings">
        <Icon name="gear" />
      </button>
      <details className="more-menu">
        <summary className="ibtn" aria-label="More">
          <Icon name="more" />
        </summary>
        <div className="popover" style={{ right: 0, minWidth: 240 }}>
          <button className="btn ghost" onClick={() => useUi.setState({ importOpen: true })} disabled={!canEdit} data-testid="open-import">
            {t('top.import')}
          </button>
          <button className="btn ghost" onClick={() => useUi.setState({ rightTab: 'meeting', rightOpen: true })}>
            {t('top.meeting')}
          </button>
          <button className="btn ghost" onClick={() => download('/api/export-all')}>
            {t('top.exportAll')}
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              await api('/api/session', { method: 'DELETE' });
              location.href = '/login';
            }}
          >
            {t('top.signOut')} ({me.name})
          </button>
        </div>
      </details>
    </div>
  );
}

const SIMPLE_TOOLS: { tool: Tool; icon: string; k: MsgKey; key: string }[] = [
  { tool: 'select', icon: 'select', k: 'tool.select', key: 'V' },
  { tool: 'hand', icon: 'hand', k: 'tool.hand', key: 'H' },
  { tool: 'measure', icon: 'measure', k: 'tool.measure', key: 'M' },
];

/** Bottom centre (simple layout): a few big tools, Add, Undo / Redo. */
export function SimpleTools() {
  const t = useT();
  const tip = useTip();
  const { live } = useEditor();
  const tool = useUi((s) => s.tool);
  const [addOpen, setAddOpen] = useState(false);
  const revId = useUi((s) => s.activeRevisionId);
  const rev = useRevision(revId);
  const run = (c: string) => {
    const r = parseCommand(c);
    if (!r.ok) return;
    try {
      runCommand(r.command, { live });
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    }
  };
  const readOnly = !rev || rev.readOnly;
  return (
    <div className="float-card bottom-tools" role="toolbar" aria-label="Tools">
      {SIMPLE_TOOLS.map((x) => (
        <button key={x.tool} className="tool big" aria-pressed={tool === x.tool} onClick={() => useUi.setState({ tool: x.tool })} title={tip(`${t(x.k)} (${x.key})`)} aria-label={t(x.k)} data-testid={`tool-${x.tool}`}>
          <Icon name={x.icon} size={20} />
          <span className="tool-label">{t(x.k)}</span>
        </button>
      ))}
      <span className="tool-divider" />
      <div style={{ position: 'relative' }}>
        <button className="tool big add" onClick={() => setAddOpen((o) => !o)} disabled={readOnly} aria-label={t('studio.add')} title={tip(t('studio.add'))} data-testid="add-menu">
          <Icon name="plus" size={20} />
          <span className="tool-label">{t('studio.add')}</span>
        </button>
        {addOpen && (
          <div className="popover up" style={{ left: '50%', transform: 'translateX(-50%)', minWidth: 300 }} onMouseLeave={() => setAddOpen(false)}>
            <button className="btn ghost big-row" onClick={() => (setAddOpen(false), useUi.setState({ addHardwareOpen: true }))} data-testid="add-hardware">
              <Icon name="handle" /> {t('studio.addHardware')}
            </button>
            <button
              className="btn ghost big-row"
              onClick={() => {
                setAddOpen(false);
                useUi.setState({ rightTab: 'properties', rightOpen: true });
                window.dispatchEvent(new CustomEvent('bom:add-part'));
              }}
            >
              <Icon name="list" /> {t('studio.addCatalogue')}
            </button>
          </div>
        )}
      </div>
      <span className="tool-divider" />
      <button className="tool big" onClick={() => run('UNDO')} aria-label={t('studio.undo')} title={tip(`${t('studio.undo')} (Ctrl+Z)`)} data-testid="undo">
        <Icon name="undo" size={20} />
        <span className="tool-label">{t('studio.undo')}</span>
      </button>
      <button className="tool big" onClick={() => run('REDO')} aria-label={t('studio.redo')} title={tip(`${t('studio.redo')} (Ctrl+Y)`)} data-testid="redo">
        <Icon name="redo" size={20} />
        <span className="tool-label">{t('studio.redo')}</span>
      </button>
      <span className="tool-divider" />
      <ZoomButtons />
    </div>
  );
}

/** Bottom right on the board: − 100 % + and fit. */
export function ZoomControl() {
  return (
    <div className="float-card zoom-control">
      <ZoomButtons />
    </div>
  );
}

/** − 100 % + and fit. Works for the 3D model, drawing, parts list and board. */
export function ZoomButtons() {
  const t = useT();
  const tip = useTip();
  const { live } = useEditor();
  const pct = useUi((s) => zoomPercent(s));
  const [open, setOpen] = useState(false);
  return (
    <div className="zoom-buttons" data-testid="zoom-control">
      <button className="ibtn" onClick={zoomOut} aria-label={t('zoom.out')} title={tip(`${t('zoom.out')} (Ctrl −)`)} data-testid="zoom-out">
        <Icon name="minus" />
      </button>
      <div style={{ position: 'relative' }}>
        <button className="zoom-value" onClick={() => setOpen((o) => !o)} aria-label="Zoom options" data-testid="zoom-value">
          {pct}%
        </button>
        {open && (
          <div className="popover up" style={{ right: 0, minWidth: 220 }} onMouseLeave={() => setOpen(false)}>
            <button className="btn ghost big-row" onClick={() => (zoomFit(live.items), setOpen(false))}>
              {t('zoom.fit')} <span className="kbd">Shift 1</span>
            </button>
            <button className="btn ghost big-row" onClick={() => (zoomReset(), setOpen(false))}>
              {t('zoom.reset')} <span className="kbd">Shift 0</span>
            </button>
            <button className="btn ghost big-row" onClick={zoomIn}>
              {t('zoom.in')} <span className="kbd">Ctrl +</span>
            </button>
            <button className="btn ghost big-row" onClick={zoomOut}>
              {t('zoom.out')} <span className="kbd">Ctrl −</span>
            </button>
          </div>
        )}
      </div>
      <button className="ibtn" onClick={zoomIn} aria-label={t('zoom.in')} title={tip(`${t('zoom.in')} (Ctrl +)`)} data-testid="zoom-in">
        <Icon name="plus" />
      </button>
      <button className="ibtn" onClick={() => zoomFit(live.items)} aria-label={t('zoom.fit')} title={tip(`${t('zoom.fit')} (Shift+1)`)} data-testid="zoom-fit">
        <Icon name="fit" />
      </button>
    </div>
  );
}
