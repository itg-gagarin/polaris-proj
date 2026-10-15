'use client';
import { useState } from 'react';
import type { Finding, RevisionContent } from '@bom/domain';
import { TEAMS } from '@bom/domain';
import type { Analysis } from '@bom/engine';
import { useUi } from '@/lib/store';
import type { RevisionLive } from '@/lib/live';
import { revisionAction } from '@/lib/api';
import { useT } from '@/lib/editor';

/** Checks frame: every finding shows its rule, numbers and confidence (PRD §7, §14). */
export function Findings({ rev, analysis, revisionId, readOnly }: { rev: RevisionLive; content: RevisionContent; analysis: Analysis; revisionId: string; readOnly: boolean }) {
  const t = useT();
  const [showWaived, setShowWaived] = useState(true);
  const order = { fail: 0, warn: 1, info: 2 } as const;
  const list = analysis.findings.filter((f) => showWaived || !f.waived).sort((a, b) => order[a.severity] - order[b.severity] || a.ruleId.localeCompare(b.ruleId));
  const s = analysis.summary;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 8 }} data-testid="findings">
      <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="chip fail">{s.fail} fail</span>
        <span className="chip warn">{s.warn} warn</span>
        <span className="chip info">{s.info} info</span>
        <span className="chip">{s.waived} waived</span>
        <span className="chip">{s.unplaced} unplaced</span>
        <span className="muted">{analysis.ms.toFixed(0)} ms</span>
        <span className="spacer" />
        <label className="row muted">
          <input type="checkbox" checked={showWaived} onChange={(e) => setShowWaived(e.target.checked)} /> waived
        </label>
      </div>
      {!list.length && <div className="muted">{t('findings.none')}</div>}
      {list.map((f) => (
        <FindingCard key={f.key} f={f} rev={rev} revisionId={revisionId} readOnly={readOnly} />
      ))}
      {analysis.layout.unplaced.length > 0 && (
        <>
          <div className="section-title">Unplaced tray</div>
          {analysis.layout.unplaced.map((u) => (
            <div key={u.partId} className="finding warn" onClick={() => useUi.getState().select(revisionId, [u.partId])}>
              {rev.content?.parts.find((p) => p.id === u.partId)?.name ?? u.partId} × {u.count} <span className="muted">— {u.reason}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function FindingCard({ f, rev, revisionId, readOnly }: { f: Finding; rev: RevisionLive; revisionId: string; readOnly: boolean }) {
  const t = useT();
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'accepted-risk' | 'false-positive'>('accepted-risk');
  const waive = async () => {
    try {
      const b = await revisionAction(revisionId, { action: 'waive', findingKey: f.key, reason, kind });
      rev.applyServerContent(b.revision.content);
      rev.setBundle(b);
      setWaiving(false);
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    }
  };
  const unwaive = async () => {
    const b = await revisionAction(revisionId, { action: 'unwaive', findingKey: f.key });
    rev.applyServerContent(b.revision.content);
    rev.setBundle(b);
  };
  return (
    <div className={`finding ${f.severity} ${f.waived ? 'waived' : ''}`} data-rule={f.ruleId}>
      <div className="row">
        <strong className="grow" style={{ cursor: 'pointer' }} onClick={() => useUi.getState().select(revisionId, f.partIds)}>
          {f.title}
        </strong>
        <span className={`chip ${f.severity === 'fail' ? 'fail' : f.severity === 'warn' ? 'warn' : 'info'}`}>{f.severity}</span>
      </div>
      <div style={{ margin: '3px 0' }}>{f.message}</div>
      <div className="row muted" style={{ flexWrap: 'wrap', fontSize: 12 }}>
        <span className="mono">{f.ruleId}</span>·<span>{TEAMS[f.ownerTeam].label.en}</span>·<span>confidence {f.confidence}</span>
        {Object.entries(f.numbers)
          .slice(0, 5)
          .map(([k, v]) => (
            <span key={k} className="mono">
              {k}={Math.round(v * 10) / 10}
            </span>
          ))}
      </div>
      {f.assumptionKeys.length > 0 && <div className="muted" style={{ fontSize: 12 }}>Depends on: {f.assumptionKeys.join(', ')}</div>}
      {f.waived && (
        <div className="muted" style={{ fontSize: 12 }}>
          Waived ({f.waived.kind}): {f.waived.reason}
        </div>
      )}
      {!readOnly && (
        <div className="row" style={{ marginTop: 4 }}>
          {f.fix && !f.waived && (
            <button className="btn small" onClick={() => rev.edit({ ...f.fix!, reason: f.fix!.reason || `Fix: ${f.title}` })}>
              {t('findings.fix')}
            </button>
          )}
          {!f.waived && f.severity !== 'info' && (
            <button className="btn small ghost" onClick={() => setWaiving((w) => !w)}>
              {t('findings.waive')}
            </button>
          )}
          {f.waived && (
            <button className="btn small ghost" onClick={unwaive}>
              Remove waiver
            </button>
          )}
        </div>
      )}
      {waiving && (
        <div className="col" style={{ marginTop: 6 }}>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="accepted-risk">Accepted risk</option>
            <option value="false-positive">False positive</option>
          </select>
          <input className="input" placeholder={t('findings.waiveReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn small primary" disabled={!reason.trim()} onClick={waive}>
            {t('findings.waive')}
          </button>
        </div>
      )}
    </div>
  );
}
