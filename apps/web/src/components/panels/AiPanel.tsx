'use client';
import { useCallback, useEffect } from 'react';
import type { SuggestedRevision } from '@bom/ai';
import type { FrameItem, RevisionContent, Team } from '@bom/domain';
import { newId, TEAMS } from '@bom/domain';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api, type PatchResult } from '@/lib/api';

/**
 * AI optimize (PRD §8): rule fixes + model pass, every change re-validated; review per change,
 * low confidence and rule-less suggestions unticked; accepted changes land as one history step.
 */
export function AiPanel() {
  const t = useT();
  const ui = useUi();
  const { live, me, boot } = useEditor();
  const rev = useRevision(ui.activeRevisionId);
  const s = ui.ai.suggestion?.revisionId === rev?.id ? ui.ai.suggestion : null;

  const openCompare = useCallback(() => {
    if (!rev) return;
    const existing = live.items.find((i) => i.kind === 'frame' && i.type === 'compare' && i.revisionId === rev.id && i.props.mode === 'ai');
    if (existing) return;
    const anchor = (live.items.find((i) => i.id === useUi.getState().activeFrameId) as FrameItem | undefined) ?? (live.items.find((i) => i.kind === 'frame' && i.revisionId === rev.id) as FrameItem | undefined);
    // Right of everything on the anchor's row, so it never covers another frame.
    const ay = anchor?.rect.y ?? 0;
    const ah = anchor?.rect.h ?? 560;
    const rowRight = Math.max(0, ...live.items.filter((i) => i.rect.y < ay + ah && i.rect.y + Math.abs(i.rect.h) > ay).map((i) => i.rect.x + Math.abs(i.rect.w)));
    const f: FrameItem = { id: newId('frame'), kind: 'frame', type: 'compare', rect: { x: rowRight + 40, y: ay, w: 900, h: ah }, z: 2, title: `Compare · AI suggestion`, productId: anchor?.productId ?? null, revisionId: rev.id, props: { mode: 'ai' } };
    live.writeItems((m) => m.set(f.id, f));
  }, [rev, live]);

  const runAi = useCallback(async () => {
    if (!rev) return;
    useUi.setState({ ai: { running: true, suggestion: null, accepted: [], error: null } });
    try {
      const r = await api<{ suggestion: SuggestedRevision }>('/api/ai/optimize', { method: 'POST', json: { revisionId: rev.id } });
      useUi.setState({ ai: { running: false, suggestion: r.suggestion, accepted: r.suggestion.changes.filter((c) => c.checked).map((c) => c.id), error: null } });
      openCompare();
      // Bring the compare frame into view.
      setTimeout(() => {
        const cmp = live.items.find((i) => i.kind === 'frame' && i.type === 'compare' && i.props.mode === 'ai' && i.revisionId === rev.id);
        if (cmp) {
          const b = useUi.getState().board;
          useUi.setState({ board: { zoom: b.zoom, x: -(cmp.rect.x - 420) * b.zoom, y: b.y } });
        }
      }, 50);
    } catch (e) {
      useUi.setState({ ai: { running: false, suggestion: null, accepted: [], error: (e as Error).message } });
    }
  }, [rev, openCompare]);

  useEffect(() => {
    const h = () => void runAi();
    window.addEventListener('bom:run-ai', h);
    return () => window.removeEventListener('bom:run-ai', h);
  }, [runAi]);

  const accept = async (ids: string[]) => {
    if (!rev || !s) return;
    try {
      const r = await api<PatchResult & { rejected: { id: string; why: string }[]; applied: number }>('/api/ai/accept', { method: 'POST', json: { revisionId: rev.id, suggestion: s, acceptedIds: ids } });
      if (r.revision) rev.applyServerContent(r.revision.content as RevisionContent);
      await rev.refresh();
      useUi.getState().toast(`AI optimize, accepted by ${me.name}: ${r.applied} change(s)${r.rejected.length ? `, ${r.rejected.length} not applied` : ''}`, 'success');
      useUi.setState({ ai: { running: false, suggestion: null, accepted: [], error: null } });
      live.writeItems((m) => {
        for (const it of live.items) if (it.kind === 'frame' && it.type === 'compare' && it.props.mode === 'ai' && it.revisionId === rev.id) m.delete(it.id);
      });
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    }
  };

  if (!rev) return <div className="muted">Click a product frame, then run AI optimize.</div>;
  const byTeam = new Map<Team, NonNullable<typeof s>['changes']>();
  for (const c of s?.changes ?? []) byTeam.set(c.team, [...(byTeam.get(c.team) ?? []), c]);
  const toggle = (id: string) => useUi.setState((st) => ({ ai: { ...st.ai, accepted: st.ai.accepted.includes(id) ? st.ai.accepted.filter((x) => x !== id) : [...st.ai.accepted, id] } }));

  return (
    <div data-testid="ai-panel">
      <div className="row">
        <button className="btn ai" onClick={runAi} disabled={ui.ai.running || rev.readOnly || !boot.ai.enabled} data-testid="run-ai">
          ✦ {ui.ai.running ? t('ai.running') : t('ai.run')}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>{boot.ai.provider === 'mock' ? 'mock model (no API key)' : 'Claude'}</span>
      </div>
      {rev.readOnly && <div className="muted" style={{ marginTop: 6 }}>{t('readonly.released')}</div>}
      {ui.ai.error && <div className="chip fail" style={{ marginTop: 8, whiteSpace: 'normal' }}>{ui.ai.error}</div>}
      {s && (
        <>
          {s.explanationError && <div className="banner" style={{ marginTop: 8 }}>{t('ai.explanationFailed')} ({s.explanationError})</div>}
          <div className="row" style={{ margin: '8px 0', flexWrap: 'wrap' }}>
            <span className="chip">
              {t('ai.before')}: {s.before.fail} fail · {s.before.warn} warn
            </span>
            <span className="chip ok">
              {t('ai.after')}: {s.afterAllAccepted.fail} fail · {s.afterAllAccepted.warn} warn
            </span>
            <span className="muted">{s.model} · {(s.ms / 1000).toFixed(1)} s</span>
          </div>
          {[...byTeam.entries()].map(([team, cs]) => (
            <div key={team}>
              <div className="section-title" style={{ color: TEAMS[team].color }}>{TEAMS[team].label.en}</div>
              {cs.map((c) => (
                <label key={c.id} className={`change ${c.confidence === 'low' ? 'low' : ''}`} style={{ display: 'block' }} data-change={c.id}>
                  <div className="row">
                    <input type="checkbox" checked={ui.ai.accepted.includes(c.id)} onChange={() => toggle(c.id)} />
                    <strong className="grow">{c.title}</strong>
                    <span className={`chip ${c.label === 'Suggestion' ? 'warn' : c.label === 'Mapping' ? 'info' : 'ok'}`}>{c.label === 'Suggestion' ? t('ai.suggestion') : c.label}</span>
                  </div>
                  <div style={{ margin: '3px 0' }}>{c.reason}</div>
                  <div className="row muted" style={{ fontSize: 12, flexWrap: 'wrap' }}>
                    <span>confidence {c.confidence}</span>
                    {c.ruleId && <span className="mono">rule {c.ruleId}</span>}
                    {c.pins.map((p, i) => (
                      <span key={i} className="chip ok mono">
                        {p.field} {String(p.from ?? "—")} → {String(p.to ?? "—")}
                      </span>
                    ))}
                    {c.assumptionKeys.length > 0 && <span>depends on: {c.assumptionKeys.join(', ')} (see Assumptions)</span>}
                  </div>
                </label>
              ))}
            </div>
          ))}
          {s.notApplied.length > 0 && (
            <>
              <div className="section-title">{t('ai.notApplied')}</div>
              {s.notApplied.map((n, i) => (
                <div key={i} className="change low">
                  <strong>{n.title}</strong>
                  <div className="muted">{n.reason}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{n.why}</div>
                </div>
              ))}
            </>
          )}
          <div className="row" style={{ position: 'sticky', bottom: 0, background: 'var(--panel)', padding: '8px 0' }}>
            <button className="btn primary" onClick={() => accept(ui.ai.accepted)} disabled={!ui.ai.accepted.length} data-testid="ai-accept">
              {t('ai.acceptSelected')} ({ui.ai.accepted.length})
            </button>
            <button className="btn" onClick={() => accept(s.changes.map((c) => c.id))}>
              {t('ai.acceptAll')}
            </button>
            <button className="btn ghost" onClick={() => useUi.setState({ ai: { running: false, suggestion: null, accepted: [], error: null } })}>
              {t('ai.reject')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
