'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Decision, Meeting, MeetingNote, MeetingRole, NoteTag, Recording, Team } from '@bom/domain';
import { TEAM_IDS, TEAMS } from '@bom/domain';
import { bringEveryoneHere } from '@bom/collab';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api } from '@/lib/api';

interface MeetingBundle {
  meeting: Meeting;
  notes: MeetingNote[];
  decisions: Decision[];
  recording: Recording | null;
}

/** Meeting mode (PRD §9): setup, personal sheets, private/shared notes, presenter, recording with consent, decisions, record. */
export function MeetingPanel() {
  const ui = useUi();
  const rev = useRevision(ui.activeRevisionId);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const productId = rev?.bundle?.product.id;
  const load = useCallback(async () => {
    if (!productId) return;
    setMeetings((await api<{ meetings: Meeting[] }>(`/api/meetings?productId=${productId}`)).meetings);
  }, [productId]);
  useEffect(() => void load(), [load]);

  if (!rev?.bundle) return <div className="muted">Click a product frame to plan or join its review meeting.</div>;
  if (ui.meetingId) return <LiveMeeting meetingId={ui.meetingId} onLeave={() => (useUi.setState({ meetingId: null, following: null }), void load())} />;
  return (
    <div>
      <div className="section-title">Meetings · {rev.bundle.product.code}</div>
      {meetings.map((m) => (
        <div key={m.id} className="lane">
          <div className="row">
            <strong className="grow">{m.title}</strong>
            <span className={`chip ${m.state === 'live' ? 'ok' : ''}`}>{m.state}</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{m.participants.length} participants · agenda {m.agenda.length} items</div>
          <div className="row" style={{ marginTop: 4 }}>
            {m.state !== 'closed' && (
              <button className="btn small primary" onClick={() => useUi.setState({ meetingId: m.id })} data-testid={`join-${m.id}`}>
                Join
              </button>
            )}
            {m.state === 'closed' && (
              <a className="btn small" href={`/meeting/${m.id}/record`} target="_blank" rel="noreferrer">
                Record
              </a>
            )}
          </div>
        </div>
      ))}
      <Setup revisionId={rev.id} onCreated={(id) => (useUi.setState({ meetingId: id }), void load())} />
    </div>
  );
}

function Setup({ revisionId, onCreated }: { revisionId: string; onCreated: (id: string) => void }) {
  const t = useT();
  const { boot, me } = useEditor();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('Product review');
  const [noteTaker, setNoteTaker] = useState(me.id);
  const internal = boot.users.filter((u) => !u.external);
  const [picked, setPicked] = useState<Record<string, { team: Team; role: MeetingRole; device: 'tablet' | 'laptop' | 'paper' } | undefined>>(() => Object.fromEntries(internal.map((u) => [u.id, { team: u.teams[0] ?? 'design', role: u.id === me.id ? 'lead' : 'participant', device: 'tablet' }])));
  if (!open)
    return (
      <button className="btn" onClick={() => setOpen(true)} disabled={me.role === 'viewer' || me.role === 'reviewer' || me.external}>
        + {t('meeting.setup')}
      </button>
    );
  const create = async () => {
    const participants = Object.entries(picked)
      .filter(([, v]) => v)
      .map(([userId, v]) => ({ userId, team: v!.team, role: userId === me.id ? 'lead' : userId === noteTaker ? 'noteTaker' : v!.role, device: v!.device }));
    const r = await api<{ meeting: Meeting }>('/api/meetings', { method: 'POST', json: { revisionId, title, noteTakerId: noteTaker, participants } });
    onCreated(r.meeting.id);
  };
  return (
    <div className="col lane">
      <strong>{t('meeting.setup')}</strong>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="row">
        Note-taker
        <select className="select grow" value={noteTaker} onChange={(e) => setNoteTaker(e.target.value)}>
          {internal.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        {internal.map((u) => {
          const v = picked[u.id];
          return (
            <div key={u.id} className="row" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={!!v} onChange={(e) => setPicked((p) => ({ ...p, [u.id]: e.target.checked ? { team: u.teams[0] ?? 'design', role: 'participant', device: 'tablet' } : undefined }))} />
              <span className="grow ellipsis">{u.name}</span>
              {v && (
                <>
                  <select className="select" value={v.team} onChange={(e) => setPicked((p) => ({ ...p, [u.id]: { ...v, team: e.target.value as Team } }))}>
                    {TEAM_IDS.map((x) => (
                      <option key={x} value={x}>
                        {TEAMS[x].label.en}
                      </option>
                    ))}
                  </select>
                  <select className="select" value={v.device} onChange={(e) => setPicked((p) => ({ ...p, [u.id]: { ...v, device: e.target.value as 'tablet' } }))}>
                    <option>tablet</option>
                    <option>laptop</option>
                    <option>paper</option>
                  </select>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="row">
        <button className="btn primary" onClick={create}>
          {t('common.save')}
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function LiveMeeting({ meetingId, onLeave }: { meetingId: string; onLeave: () => void }) {
  const t = useT();
  const ui = useUi();
  const { me, users, live } = useEditor();
  const rev = useRevision(ui.activeRevisionId);
  const [b, setB] = useState<MeetingBundle | null>(null);
  const [text, setText] = useState('');
  const [tag, setTag] = useState<NoteTag | ''>('');
  const [decision, setDecision] = useState('');
  const [owner, setOwner] = useState<Team>('design');
  const [due, setDue] = useState('');
  const [segment, setSegment] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const refresh = useCallback(async () => setB(await api<MeetingBundle>(`/api/meetings/${meetingId}`)), [meetingId]);
  const act = async (body: Record<string, unknown>) => {
    try {
      const r = await api<MeetingBundle & { summary?: string }>(`/api/meetings/${meetingId}`, { method: 'POST', json: body });
      setB(r);
      if (r.summary) setSummary(r.summary);
      return r;
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
      return null;
    }
  };
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 3000);
    const h = () => void refresh();
    window.addEventListener('bom:meeting-refresh', h);
    return () => {
      clearInterval(iv);
      window.removeEventListener('bom:meeting-refresh', h);
    };
  }, [refresh]);
  if (!b) return <div className="muted">{t('common.loading')}</div>;
  const m = b.meeting;
  const isLead = m.leadId === me.id;
  const isNoteTaker = m.noteTakerId === me.id || isLead;
  const myTeam = m.participants.find((p) => p.userId === me.id)?.team ?? me.teams[0] ?? 'design';
  const consented = b.recording?.consent.find((c) => c.userId === me.id);
  const presenting = (live.awareness?.getLocalState() as { presenting?: { meetingId: string } | null } | null)?.presenting?.meetingId === meetingId;
  const presenterPeer = live.peers().find((p) => p.presenting?.meetingId === meetingId);
  const sel = ui.selection.revisionId === m.revisionId ? ui.selection.partIds : [];
  const partName = (id: string) => rev?.content?.parts.find((p) => p.id === id)?.name ?? id;
  const anchor = sel[0] ? { kind: 'part', partId: sel[0], stdCode: null, position: null } : { kind: 'sheet', sheetId: 'board', x: 0, y: 0 };
  const mine = b.notes.filter((n) => n.authorId === me.id);
  const shared = b.notes.filter((n) => n.visibility === 'shared' && n.authorId !== me.id);

  return (
    <div data-testid="meeting-panel">
      <div className="row">
        <strong className="grow">{m.title}</strong>
        <span className={`chip ${m.state === 'live' ? 'ok' : ''}`}>{m.state}</span>
        <button className="btn small ghost" onClick={onLeave}>
          Leave
        </button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
        {isLead && m.state === 'planned' && (
          <button className="btn small primary" onClick={() => act({ action: 'start' })}>
            {t('meeting.start')}
          </button>
        )}
        {isLead && (
          <button
            className={`btn small ${presenting ? 'primary' : ''}`}
            onClick={() => {
              live.presence({ presenting: presenting ? null : { meetingId } });
              void act({ action: 'presenter', view: null });
            }}
          >
            {t('meeting.present')}
          </button>
        )}
        {isLead && presenting && (
          <button className="btn small" onClick={() => bringEveryoneHere(live.boardDoc, { meetingId, by: me.id, at: Date.now(), view: (live.awareness?.getLocalState() as { view?: unknown } | null)?.view ?? { board: useUi.getState().board } })}>
            {t('meeting.bringHere')}
          </button>
        )}
        {!isLead && presenterPeer && (
          <button className={`btn small ${ui.following === presenterPeer.user.id ? 'primary' : ''}`} onClick={() => useUi.setState({ following: ui.following ? null : presenterPeer.user.id })}>
            {ui.following ? t('meeting.unfollow') : t('meeting.follow')}
          </button>
        )}
        <a className="btn small" href={`/api/meetings/${meetingId}/sheet?team=${myTeam}`} target="_blank" rel="noreferrer">
          {t('meeting.sheet')}
        </a>
      </div>

      {m.state === 'live' && !consented && (
        <div className="lane" style={{ marginTop: 8 }} role="dialog" aria-label="Recording consent">
          <div>{t('meeting.consent')}</div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn small primary" onClick={() => act({ action: 'consent', granted: true })}>
              {t('meeting.consentYes')}
            </button>
            <button className="btn small" onClick={() => act({ action: 'consent', granted: false })}>
              {t('meeting.consentNo')}
            </button>
          </div>
        </div>
      )}

      <div className="section-title">{t('meeting.agenda')}</div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
        {m.agenda.map((a, i) => (
          <li key={i} style={{ cursor: a.assemblyId ? 'pointer' : 'default' }} onClick={() => a.assemblyId && rev?.content && useUi.getState().select(m.revisionId, rev.content.parts.filter((p) => p.assemblyId === a.assemblyId).map((p) => p.id))}>
            {a.title}
          </li>
        ))}
      </ol>

      <div className="section-title">{t('meeting.myNotes')}</div>
      <div className="col">
        <textarea className="input" rows={2} placeholder={sel[0] ? `Note on ${partName(sel[0])}` : 'Note (select a part to pin it)'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <select className="select" value={tag} onChange={(e) => setTag(e.target.value as NoteTag | '')}>
            <option value="">no tag</option>
            {(['question', 'issue', 'decision-needed', 'idea'] as NoteTag[]).map((x) => (
              <option key={x} value={x}>
                {t(`tag.${x}`)}
              </option>
            ))}
          </select>
          <button className={`btn small ${ui.tool === 'pencil' ? 'primary' : ''}`} onClick={() => useUi.setState({ tool: ui.tool === 'pencil' ? 'select' : 'pencil' })} title="Ink lands in your private layer, pinned to the part it touches">
            ✎ {t('meeting.pen')}
          </button>
          <span className="spacer" />
          <button className="btn small primary" disabled={!text.trim() || m.state === 'closed'} onClick={() => (act({ action: 'note', team: myTeam, anchor, kind: 'text', text, tag: tag || null }), setText(''))}>
            {t('common.add')}
          </button>
        </div>
      </div>
      {mine.map((n) => (
        <div key={n.id} className="change" style={{ fontSize: 12 }}>
          <div className="row">
            {n.tag && <span className="chip info">{t(`tag.${n.tag}`)}</span>}
            <span className="grow">{n.kind === 'ink' ? `✎ ink (${n.ink.reduce((s, k) => s + k.points.length, 0)} pts)` : n.text}</span>
            {n.visibility === 'private' ? (
              <button className="btn small" onClick={() => act({ action: 'share', noteId: n.id })}>
                {t('meeting.share')}
              </button>
            ) : (
              <span className="chip ok">{t('meeting.shared')}</span>
            )}
          </div>
          <div className="muted">{n.anchor.kind === 'part' ? `◎ ${partName(n.anchor.partId)}` : 'sheet'}</div>
        </div>
      ))}
      {mine.some((n) => n.visibility === 'private') && (
        <button className="btn small" onClick={() => act({ action: 'publishAll' })}>
          {t('meeting.publishAll')}
        </button>
      )}

      <div className="section-title">{t('meeting.shared')} ({shared.length})</div>
      {shared.map((n) => (
        <div key={n.id} className="change" style={{ fontSize: 12 }}>
          <strong>{users.get(n.authorId)?.name}</strong> <span className="muted">{TEAMS[n.team].label.en}</span> {n.tag && <span className="chip info">{t(`tag.${n.tag}`)}</span>}
          <div>{n.kind === 'ink' ? '✎ ink' : n.text}</div>
          <div className="muted">{n.anchor.kind === 'part' ? `◎ ${partName(n.anchor.partId)}` : 'sheet'}</div>
        </div>
      ))}

      <div className="section-title">Recording & transcript</div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {isLead && !b.recording?.startedAt && m.state === 'live' && (
          <button className="btn small" onClick={() => act({ action: 'startRecording' })} title="Only participants who agreed are recorded">
            ● {t('meeting.record')}
          </button>
        )}
        {b.recording?.startedAt && <span className="chip fail">● recording</span>}
        <button className="btn small" onClick={() => act({ action: 'bookmark', at: Date.now(), label: 'Marked' })}>
          ⚑ {t('meeting.mark')}
        </button>
      </div>
      {b.recording?.startedAt && (
        <div className="row" style={{ marginTop: 4 }}>
          <input className="input grow" placeholder="Transcript segment (speech-to-text provider not configured)" value={segment} onChange={(e) => setSegment(e.target.value)} />
          <button className="btn small" disabled={!segment} onClick={() => {
            const now = (Date.now() - new Date(b.recording!.startedAt!).getTime()) / 1000;
            void act({ action: 'segment', text: segment, start: Math.max(0, now - 5), end: now, trail: [{ at: Math.max(0, now - 5), partIds: sel, sheetId: null }] });
            setSegment('');
          }}>
            {t('common.add')}
          </button>
        </div>
      )}
      {b.recording?.segments.slice(-5).map((s) => (
        <div key={s.id} className="muted" style={{ fontSize: 12 }}>
          [{s.start.toFixed(0)}s] {s.text} {s.partIds.length ? `· ◎ ${s.partIds.map(partName).join(', ')}` : ''}
        </div>
      ))}

      <div className="section-title">{t('meeting.decisions')}</div>
      {isNoteTaker && m.state !== 'closed' && (
        <div className="col">
          <input className="input" placeholder={sel.length ? `Decision on ${sel.map(partName).join(', ')}` : 'Decision (select parts to attach them)'} value={decision} onChange={(e) => setDecision(e.target.value)} />
          <div className="row">
            <select className="select" value={owner} onChange={(e) => setOwner(e.target.value as Team)}>
              {TEAM_IDS.map((x) => (
                <option key={x} value={x}>
                  {TEAMS[x].label.en}
                </option>
              ))}
            </select>
            <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
            <button className="btn small primary" disabled={!decision.trim()} onClick={() => (act({ action: 'decision', text: decision, partIds: sel, ownerTeam: owner, due: due || null }), setDecision(''))}>
              {t('common.add')}
            </button>
          </div>
          <button className="btn small" onClick={() => act({ action: 'propose' })}>
            ✦ {t('meeting.propose')}
          </button>
          {summary && <div className="muted" style={{ fontSize: 12 }}>{summary}</div>}
        </div>
      )}
      {b.decisions.map((d) => (
        <div key={d.id} className="change" style={{ fontSize: 12 }}>
          <div className="row">
            <span className="grow">{d.text}</span>
            <span className={`chip ${d.status === 'confirmed' ? 'ok' : d.status === 'rejected' ? 'fail' : 'warn'}`}>{d.status}</span>
          </div>
          <div className="muted">
            {TEAMS[d.ownerTeam].label.en} {d.due ? `· due ${d.due}` : ''} {d.partIds.length ? `· ◎ ${d.partIds.map(partName).join(', ')}` : ''} {d.source === 'ai' ? `· AI (${d.confidence})` : ''}
          </div>
          {d.status === 'proposed' && isNoteTaker && (
            <div className="row">
              <button className="btn small primary" onClick={() => act({ action: 'confirm', decisionId: d.id })}>
                {t('meeting.confirm')}
              </button>
              <button className="btn small" onClick={() => act({ action: 'reject', decisionId: d.id })}>
                {t('comments.rejectSuggestion')}
              </button>
            </div>
          )}
        </div>
      ))}

      {isLead && m.state !== 'closed' && (
        <button className="btn primary" style={{ marginTop: 10 }} onClick={async () => {
          const r = await act({ action: 'close' });
          if (r) {
            useUi.getState().toast('Meeting closed: decisions became change requests on the draft', 'success');
            window.open(`/meeting/${meetingId}/record`, '_blank');
            await rev?.refresh();
          }
        }}>
          {t('meeting.close')}
        </button>
      )}
      {m.state === 'closed' && (
        <a className="btn" href={`/meeting/${meetingId}/record`} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
          Open the meeting record
        </a>
      )}
    </div>
  );
}
