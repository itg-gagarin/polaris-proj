'use client';
import { useState } from 'react';
import type { Review as Lane, Team } from '@bom/domain';
import { can, contentHash, requiredLanesFor, TEAMS } from '@bom/domain';
import { autoAnswers, checklistFor } from '@bom/workflow';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api, download, revisionAction } from '@/lib/api';
import type { RevisionLive } from '@/lib/live';

/** Revision states, team lanes with checklists, release gate (PRD §9). */
export function Review() {
  const t = useT();
  const ui = useUi();
  const { me, boot, reloadBoot, live } = useEditor();
  const rev = useRevision(ui.activeRevisionId);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!rev?.bundle || !rev.content) return <div className="muted">Click a frame to review its revision.</div>;
  const { revision, product, reviews } = rev.bundle;
  const required = requiredLanesFor(boot.workspace.settings, product.category, product.subCategory);
  const hash = contentHash(rev.content);
  const run = async (body: Record<string, unknown>, then?: (id: string) => void) => {
    setBusy(true);
    try {
      const b = await revisionAction(revision.id, body);
      if (b.revision.id !== revision.id) {
        then?.(b.revision.id);
      } else {
        rev.setBundle(b);
      }
      await reloadBoot();
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const openRevision = (id: string) => {
    // Point every frame showing this product at the new revision.
    live.writeItems((m) => {
      for (const it of live.items) if (it.kind === 'frame' && it.revisionId === revision.id) m.set(it.id, { ...it, revisionId: id });
    });
    useUi.setState({ activeRevisionId: id, selection: { revisionId: id, partIds: [] } });
  };
  const draftNote = async () => {
    try {
      const r = await api<{ note: string }>('/api/ai/helper', { method: 'POST', json: { kind: 'revisionNote', revisionId: revision.id } });
      setNote(r.note);
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    }
  };
  const allApproved = required.every((tm) => reviews.find((r) => r.team === tm)?.state === 'approved');
  const editable = revision.state === 'draft' || revision.state === 'changes_requested';
  return (
    <div data-testid="review">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <strong>
          {product.code} Rev {revision.label}
        </strong>
        <span className={`chip ${revision.state === 'released' ? 'ok' : revision.state === 'changes_requested' ? 'fail' : 'info'}`}>{revision.state.replace('_', ' ')}</span>
        {revision.submittedHash && <span className="chip mono" title="Content hash frozen at submit">#{revision.submittedHash.slice(0, 8)}</span>}
      </div>
      {revision.notes && <div className="muted" style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{revision.notes}</div>}

      {editable && can(me, 'editBom').allowed && (
        <div className="col" style={{ margin: '8px 0' }}>
          <textarea className="input" rows={4} placeholder={t('review.note')} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row">
            <button className="btn small" onClick={draftNote} disabled={!boot.ai.enabled}>
              ✦ {t('review.draftNote')}
            </button>
            <span className="spacer" />
            <button className="btn primary small" disabled={!note.trim() || busy} onClick={() => run({ action: 'submit', note })} data-testid="submit-revision">
              {t('review.submit')}
            </button>
          </div>
        </div>
      )}

      <div className="section-title">Lanes · required: {required.map((x) => TEAMS[x].label.en).join(', ')}</div>
      {reviews.length === 0 && <div className="muted">Lanes open when the draft is submitted.</div>}
      {reviews.map((r) => (
        <LaneCard key={r.id} lane={r} rev={rev} hash={hash} busy={busy} run={run} />
      ))}

      <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
        {revision.state !== 'released' && can(me, 'releaseRevision').allowed && (
          <button className="btn primary small" disabled={!allApproved || busy || !reviews.length} title={allApproved ? '' : t('review.lanesPending')} onClick={() => run({ action: 'release' })} data-testid="release">
            {t('review.release')}
          </button>
        )}
        {revision.state === 'released' && can(me, 'editBom').allowed && (
          <button className="btn small" disabled={busy} onClick={() => run({ action: 'nextDraft' }, openRevision)}>
            {t('review.nextDraft')}
          </button>
        )}
        {revision.state !== 'released' && can(me, 'editBom').allowed && (
          <button className="btn small" disabled={busy} onClick={() => {
            const name = prompt('Name of the alternative (e.g. metal slides)');
            if (name) void run({ action: 'fork', name }, openRevision);
          }}>
            {t('review.fork')}
          </button>
        )}
        {revision.branch?.status === 'active' && can(me, 'releaseRevision').allowed && (
          <button className="btn small" disabled={busy} onClick={() => run({ action: 'promote' })}>
            {t('review.promote')}
          </button>
        )}
      </div>

      <div className="section-title">{t('common.export')}</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {(['pdf', 'xlsx', 'glb', 'dxf', 'step', 'json'] as const).map((f) => (
          <button key={f} className="btn small" onClick={() => download(`/api/revisions/${revision.id}/export?format=${f}`)}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function LaneCard({ lane, rev, hash, busy, run }: { lane: Lane; rev: RevisionLive; hash: string; busy: boolean; run: (b: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const { me, users } = useEditor();
  const locale = useUi((s) => s.locale);
  const items = checklistFor(lane.team);
  const auto = autoAnswers(lane.team, rev.analysis?.findings ?? []);
  const [checks, setChecks] = useState<Record<string, boolean>>({ ...auto, ...lane.checklist });
  const [comment, setComment] = useState('');
  const [changes, setChanges] = useState<string[] | null>(null);
  const mine = can(me, 'approveLane', { team: lane.team as Team }).allowed;
  const stale = lane.state === 'approved' && lane.hash !== hash;
  const whatChanged = async () => {
    const r = await api<{ changes: string[]; summary: { summary: string } }>('/api/ai/helper', { method: 'POST', json: { kind: 'reviewAssistant', revisionId: rev.id, team: lane.team } });
    setChanges(r.changes.length ? r.changes : ['No changes in your scope.']);
  };
  return (
    <div className={`lane ${lane.state}`} data-lane={lane.team}>
      <div className="row">
        <span style={{ width: 10, height: 10, borderRadius: 5, background: TEAMS[lane.team as Team].color }} />
        <strong className="grow">{TEAMS[lane.team as Team].label.en}</strong>
        <span className={`chip ${lane.state === 'approved' ? 'ok' : lane.state === 'changes_requested' ? 'fail' : ''}`}>{lane.state.replace('_', ' ')}</span>
      </div>
      {lane.reviewerId && <div className="muted" style={{ fontSize: 12 }}>by {users.get(lane.reviewerId)?.name ?? lane.reviewerId}{lane.at ? ` · ${new Date(lane.at).toLocaleString()}` : ''}</div>}
      {lane.resetReason && <div className="chip warn" style={{ whiteSpace: 'normal', marginTop: 4 }}>{t('review.reset', { why: lane.resetReason })}</div>}
      {stale && <div className="chip warn">Approved a different content hash</div>}
      {lane.comment && <div style={{ marginTop: 4 }}>“{lane.comment}”</div>}
      <div style={{ marginTop: 6 }}>
        {items.map((it) => (
          <label key={it.id} className="row" style={{ fontSize: 12, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={!!checks[it.id]} disabled={!mine || lane.state === 'approved'} onChange={(e) => setChecks((c) => ({ ...c, [it.id]: e.target.checked }))} />
            <span>
              {it.text[locale]}
              {auto[it.id] !== undefined && <span className="muted"> (auto: {auto[it.id] ? 'pass' : 'fail'})</span>}
            </span>
          </label>
        ))}
      </div>
      {mine && lane.state !== 'approved' && rev.bundle?.revision.state !== 'draft' && (
        <div className="col" style={{ marginTop: 6 }}>
          <input className="input" placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="row">
            <button className="btn small primary" disabled={busy} onClick={() => run({ action: 'approve', team: lane.team, hash, checklist: checks, comment })} data-testid={`approve-${lane.team}`}>
              {t('review.approve')}
            </button>
            <button className="btn small danger" disabled={busy || !comment.trim()} onClick={() => run({ action: 'requestChanges', team: lane.team, comment })}>
              {t('review.requestChanges')}
            </button>
          </div>
        </div>
      )}
      <button className="btn small ghost" onClick={whatChanged}>
        ✦ {t('review.whatChanged')}
      </button>
      {changes && (
        <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 12 }}>
          {changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
