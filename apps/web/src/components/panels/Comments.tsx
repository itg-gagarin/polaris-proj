'use client';
import { useState } from 'react';
import type { Anchor, NoteTag, Team, Thread } from '@bom/domain';
import { TEAM_IDS, TEAMS } from '@bom/domain';
import { useEditor, useRevision, useT } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api, threadAction, type PatchResult } from '@/lib/api';
import type { RevisionLive } from '@/lib/live';

/** Threads anchored to parts, BOM cells or the revision; mentions, tasks, suggestions (PRD §9). */
export function Comments() {
  const t = useT();
  const ui = useUi();
  const rev = useRevision(ui.selection.revisionId ?? ui.activeRevisionId);
  const [scope, setScope] = useState<'all' | 'selection' | 'open'>('open');
  const [body, setBody] = useState('');
  const [tag, setTag] = useState<NoteTag | ''>('');
  if (!rev?.bundle || !rev.content) return <div className="muted">Click a frame to see its comments.</div>;
  const sel = ui.selection.revisionId === rev.id ? ui.selection.partIds : [];
  const threads = rev.bundle.threads
    .filter((th) => scope === 'all' || (scope === 'open' ? th.status === 'open' : th.anchor.kind === 'part' && sel.includes(th.anchor.partId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const part = sel.length === 1 ? rev.content.parts.find((p) => p.id === sel[0]) : null;
  const post = async () => {
    const anchor: Anchor = part ? { kind: 'part', partId: part.id, stdCode: part.stdCode, position: part.position } : { kind: 'revision' };
    try {
      await api('/api/threads', { method: 'POST', json: { revisionId: rev.id, anchor, body, tag: tag || null } });
      setBody('');
      await rev.refresh();
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    }
  };
  return (
    <div data-testid="comments">
      <div className="row" style={{ marginBottom: 6 }}>
        {(['open', 'all', 'selection'] as const).map((s) => (
          <button key={s} className={`btn small ${scope === s ? 'primary' : ''}`} onClick={() => setScope(s)}>
            {s === 'selection' ? t('comments.onSelection') : s}
          </button>
        ))}
      </div>
      <div className="col" style={{ marginBottom: 10 }}>
        <textarea className="input" rows={3} placeholder={t('comments.placeholder')} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row">
          <select className="select" value={tag} onChange={(e) => setTag(e.target.value as NoteTag | '')} aria-label="Tag">
            <option value="">no tag</option>
            {(['question', 'issue', 'decision-needed', 'idea'] as NoteTag[]).map((x) => (
              <option key={x} value={x}>
                {t(`tag.${x}`)}
              </option>
            ))}
          </select>
          <span className="muted grow ellipsis">{part ? `on ${part.name}` : 'on the revision'}</span>
          <button className="btn primary small" disabled={!body.trim()} onClick={post}>
            {t('comments.new')}
          </button>
        </div>
      </div>
      {!threads.length && <div className="muted">{t('comments.empty')}</div>}
      {threads.map((th) => (
        <ThreadCard key={th.id} th={th} rev={rev} />
      ))}
    </div>
  );
}

export function ThreadCard({ th, rev }: { th: Thread; rev: RevisionLive }) {
  const t = useT();
  const { users, me } = useEditor();
  const [reply, setReply] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [team, setTeam] = useState<Team | ''>(th.task?.team ?? '');
  const [due, setDue] = useState('');
  const part = th.anchor.kind === 'part' ? rev.content?.parts.find((p) => p.id === (th.anchor as { partId: string }).partId) : null;
  const act = async (b: Record<string, unknown>) => {
    try {
      const r = (await threadAction(th.id, b)) as { thread: Thread } & Partial<PatchResult>;
      if (r.revision) rev.applyServerChange(r.revision.content, r.patch);
      await rev.refresh();
    } catch (e) {
      useUi.getState().toast((e as Error).message, 'error');
    }
  };
  const highlight = (text: string) => text.split(/(@[\p{L}._-]+)/u).map((s, i) => (s.startsWith('@') ? <strong key={i} style={{ color: 'var(--accent)' }}>{s}</strong> : s));
  return (
    <div className={`thread ${th.status}`}>
      <div className="row" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
        {th.kind !== 'comment' && <span className="chip warn">{th.kind === 'changeRequest' ? 'change request' : th.kind}</span>}
        {th.tag && <span className="chip info">{t(`tag.${th.tag}`)}</span>}
        {part && (
          <button className="chip" style={{ cursor: 'pointer' }} onClick={() => useUi.getState().select(rev.id, [part.id])}>
            ◎ {part.name}
          </button>
        )}
        {th.carriedFromThreadId && <span className="chip">carried forward</span>}
        {th.meetingId && <span className="chip">from meeting</span>}
        {th.task && (
          <span className={`chip ${th.task.done ? 'ok' : ''}`}>
            task · {th.task.team ? TEAMS[th.task.team].label.en : ''} {th.task.assigneeId ? `→ ${users.get(th.task.assigneeId)?.name ?? th.task.assigneeId}` : ''} {th.task.due ?? ''}
          </span>
        )}
      </div>
      {th.comments.map((c) => (
        <div key={c.id} className="comment">
          <span className="who">{users.get(c.authorId)?.name ?? c.authorId}</span> <span className="muted" style={{ fontSize: 11 }}>{new Date(c.createdAt).toLocaleString()}</span>
          <div style={{ whiteSpace: 'pre-wrap' }}>{highlight(c.body)}</div>
        </div>
      ))}
      {th.suggestion && th.status === 'open' && (
        <div className="change">
          <div className="muted" style={{ fontSize: 12 }}>Suggested change ({th.suggestion.ops.length} op): {th.suggestion.ops.map((o) => ('dim' in o ? `${o.dim} → ${(o as { value?: unknown }).value ?? (o as { expr?: unknown }).expr}` : 'field' in o ? `${o.field} → ${JSON.stringify((o as { value: unknown }).value)}` : o.op)).join(', ')}</div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn small primary" onClick={() => act({ action: 'acceptSuggestion' })}>
              {t('comments.acceptSuggestion')}
            </button>
            <button className="btn small" onClick={() => act({ action: 'rejectSuggestion', reason: prompt('Why not?') ?? 'not accepted' })}>
              {t('comments.rejectSuggestion')}
            </button>
          </div>
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input grow" placeholder={t('comments.reply')} value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reply.trim() && (act({ action: 'reply', body: reply }), setReply(''))} />
        {th.status === 'open' ? (
          <button className="btn small" onClick={() => act({ action: 'resolve' })}>
            {t('comments.resolve')}
          </button>
        ) : (
          <button className="btn small" onClick={() => act({ action: 'reopen' })}>
            {t('comments.reopen')}
          </button>
        )}
        {!me.external && (
          <button className="btn small ghost" onClick={() => setTaskOpen((o) => !o)}>
            {t('comments.toTask')}
          </button>
        )}
      </div>
      {taskOpen && (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <select className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">assignee</option>
            {[...users.values()].filter((u) => !u.external).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select className="select" value={team} onChange={(e) => setTeam(e.target.value as Team)}>
            <option value="">team</option>
            {TEAM_IDS.map((x) => (
              <option key={x} value={x}>
                {TEAMS[x].label.en}
              </option>
            ))}
          </select>
          <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn small primary" onClick={() => (act({ action: 'task', assigneeId: assignee || null, team: team || null, due: due || null }), setTaskOpen(false))}>
            {t('common.save')}
          </button>
        </div>
      )}
    </div>
  );
}
