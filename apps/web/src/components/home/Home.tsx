'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type Bootstrap, type RevisionSummary } from '@/lib/api';
import { translate, type MsgKey } from '@/lib/i18n';
import { useUi } from '@/lib/store';
import { hydratePrefs } from '@/lib/prefs';
import { Icon } from '../Icon';

/** Start page: open a product, bring one in from Excel, or open the board — and how it works. */
export function Home() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const locale = useUi((s) => s.locale);
  const t = (k: MsgKey, v?: Record<string, string | number>) => translate(locale, k, v);
  useEffect(() => {
    hydratePrefs();
    api<Bootstrap>('/api/bootstrap')
      .then((b) => {
        setBoot(b);
        useUi.setState({ locale: b.user.locale ?? 'en' });
      })
      .catch((e: Error) => (e instanceof ApiError && e.status === 401 ? (location.href = '/login') : setError(e.message)));
  }, []);
  const latest = useMemo(() => {
    const m = new Map<string, RevisionSummary>();
    for (const r of boot?.revisions ?? []) {
      const cur = m.get(r.productId);
      if (!cur || r.updatedAt > cur.updatedAt) m.set(r.productId, r);
    }
    return m;
  }, [boot]);
  if (error) return <main className="home">Could not load: {error}</main>;
  if (!boot) return <main className="home muted" data-testid="loading">Loading… (the very first start prepares the Hollan House examples)</main>;
  const board = boot.boards[0];
  const canEdit = !(boot.user.external || boot.user.role === 'viewer' || boot.user.role === 'reviewer');
  const products = boot.products.filter((p) => !q || `${p.code} ${p.name} ${p.category} ${p.subCategory}`.toLowerCase().includes(q.toLowerCase()));
  const open = (revId: string) => board && (location.href = `/board/${board.id}?rev=${encodeURIComponent(revId)}&view=model`);
  return (
    <main className="home" data-testid="home">
      <div className="home-top">
        <h1 className="grow">{t('homepage.hello', { name: boot.user.name.split(' ')[0] })}</h1>
        <select className="select" value={locale} onChange={(e) => useUi.setState({ locale: e.target.value as 'en' | 'id' })} aria-label="Language">
          <option value="en">English</option>
          <option value="id">Bahasa Indonesia</option>
        </select>
        <button
          className="btn"
          onClick={async () => {
            await api('/api/session', { method: 'DELETE' });
            location.href = '/login';
          }}
        >
          {t('homepage.signOut')}
        </button>
      </div>
      <p className="lead">{t('homepage.intro')}</p>
      <div className="home-actions">
        {canEdit && board && (
          <a className="home-action" href={`/board/${board.id}?import=1`} data-testid="home-import">
            <Icon name="share" size={28} />
            <span>
              <strong>{t('homepage.import')}</strong>
              <span className="muted">{t('homepage.importDesc')}</span>
            </span>
          </a>
        )}
        {board && (
          <a className="home-action" href={`/board/${board.id}?view=board`} data-testid="home-board">
            <Icon name="board" size={28} />
            <span>
              <strong>{t('homepage.board')}</strong>
              <span className="muted">{t('homepage.boardDesc')}</span>
            </span>
          </a>
        )}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 className="grow" style={{ margin: 0, fontSize: 20 }}>
          {t('homepage.open')}
        </h2>
        <input className="input home-search" placeholder={t('homepage.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('homepage.search')} />
      </div>
      <div className="home-grid">
        {products.map((p) => {
          const r = latest.get(p.id);
          if (!r) return null;
          return (
            <button key={p.id} className="product-card" onClick={() => open(r.id)} data-testid={`product-${p.code}`}>
              <span className="pc-name">{p.name}</span>
              <span className="pc-meta mono">{p.code}</span>
              <span className="pc-meta">
                {p.category} / {p.subCategory}
              </span>
              <span className="row" style={{ marginTop: 4 }}>
                <span className={`chip ${r.state === 'released' ? 'ok' : r.state === 'changes_requested' ? 'fail' : 'info'}`}>
                  {t('studio.version')} {r.label} · {r.state.replace('_', ' ')}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {t('homepage.lines', { n: r.parts })}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <h2 style={{ fontSize: 20, marginTop: 32 }}>{t('homepage.how')}</h2>
      <div className="home-steps">
        {(['homepage.step1', 'homepage.step2', 'homepage.step3'] as MsgKey[]).map((k, n) => (
          <div key={k} className="home-step">
            <span className="step-n">{n + 1}</span>
            <span>{t(k)}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
