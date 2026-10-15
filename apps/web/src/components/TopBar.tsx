'use client';
import { useState } from 'react';
import { TEAMS } from '@bom/domain';
import { cameraSetters } from '@/lib/registry';
import { useEditor, useLiveVersion, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api, download } from '@/lib/api';
import type { AppNotification } from '@bom/domain';

export function TopBar() {
  const t = useT();
  const { boot, live, me, products, reloadBoot } = useEditor();
  useLiveVersion();
  const ui = useUi();
  const rev = useRevision(ui.activeRevisionId);
  const bundle = rev?.bundle;
  const product = bundle ? products.get(bundle.revision.productId) : null;
  const [notifOpen, setNotifOpen] = useState(false);
  const unread = boot.notifications.filter((n) => !n.read);
  const peers = live.peers();

  const follow = (userId: string) => {
    if (ui.following === userId) {
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

  const runAi = async () => {
    if (!rev) return useUi.getState().toast('Click a product frame first', 'error');
    useUi.setState({ rightTab: 'ai', rightOpen: true });
    window.dispatchEvent(new CustomEvent('bom:run-ai'));
  };

  const markRead = async () => {
    await api('/api/notifications', { method: 'POST', json: { read: unread.map((n) => n.id) } });
    await reloadBoot();
  };

  return (
    <header className="topbar">
      <span className="brand">{t('app.name')}</span>
      <span className="muted">{boot.workspace.name}</span>
      {product && bundle && (
        <span className="revchip" data-testid="revision-chip">
          <strong>{product.code}</strong>
          <span>
            Rev {bundle.revision.label} · {bundle.revision.state.replace('_', ' ')}
          </span>
          {bundle.revision.branch && <span className="chip">{bundle.revision.branch.name}</span>}
        </span>
      )}
      <span className="spacer" />
      <div className="avatars" aria-label="People here">
        {peers.map((p) => (
          <span key={p.clientId} className={`avatar ${ui.following === p.user.id ? 'following' : ''}`} style={{ background: p.user.color }} title={`${p.user.name} (${TEAMS[p.user.team as keyof typeof TEAMS]?.label.en ?? p.user.team}) · click to follow`} onClick={() => follow(p.user.id)}>
            {initials(p.user.name)}
          </span>
        ))}
        <span className="avatar" style={{ background: me.color }} title={`${me.name} (you)`}>
          {initials(me.name)}
        </span>
      </div>
      <button className="btn" onClick={() => useUi.setState({ importOpen: true })} disabled={me.external || me.role === 'viewer' || me.role === 'reviewer'} data-testid="open-import">
        {t('top.import')}
      </button>
      <button className="btn" onClick={() => useUi.setState({ rightTab: 'meeting', rightOpen: true })}>
        {t('top.meeting')}
      </button>
      <button className="btn" onClick={() => navigator.clipboard?.writeText(location.href).then(() => useUi.getState().toast('Link copied', 'success'))}>
        {t('top.share')}
      </button>
      <div style={{ position: 'relative' }}>
        <button className="btn" onClick={() => setNotifOpen((o) => !o)} aria-label={t('top.notifications')}>
          🔔 {unread.length > 0 && <span className="chip fail">{unread.length}</span>}
        </button>
        {notifOpen && (
          <div style={{ position: 'absolute', right: 0, top: 36, width: 360, maxHeight: 420, overflow: 'auto', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: 'var(--shadow)', padding: 8, zIndex: 60 }}>
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
      <button className="btn ai" onClick={runAi} disabled={!boot.ai.enabled || me.external || me.role === 'viewer' || me.role === 'reviewer'} data-testid="ai-optimize" title={boot.ai.provider === 'mock' ? 'Using the deterministic mock model (set AI_PROVIDER=claude for Claude)' : 'Claude'}>
        ✦ {t('top.aiOptimize')}
      </button>
      <select className="select" value={ui.locale} onChange={(e) => useUi.setState({ locale: e.target.value as 'en' | 'id' })} aria-label="Language">
        <option value="en">EN</option>
        <option value="id">ID</option>
      </select>
      <details style={{ position: 'relative' }}>
        <summary className="btn ghost" style={{ listStyle: 'none' }}>⋯</summary>
        <div className="col" style={{ position: 'absolute', right: 0, top: 34, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: 6, boxShadow: 'var(--shadow)', zIndex: 60, minWidth: 220 }}>
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
    </header>
  );
}

export const initials = (n: string) =>
  n
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
