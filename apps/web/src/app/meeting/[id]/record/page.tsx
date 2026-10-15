import { notFound, redirect } from 'next/navigation';
import { TEAMS } from '@bom/domain';
import { getSession } from '@/server/auth';
import { repoFor } from '@/server/context';

export const dynamic = 'force-dynamic';

/** Combined meeting record (PRD §9 "After the meeting"): attendees, decisions, notes by part then team, open questions, transcript. */
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const repo = await repoFor(s.authUid);
  const m = await repo.getMeeting((await params).id);
  if (!m) notFound();
  const rev = await repo.getRevision(m.revisionId);
  const product = rev ? await repo.getProduct(rev.productId) : null;
  const r = m.record;
  const partName = (id: string | null) => (id ? rev?.content.parts.find((p) => p.id === id)?.name ?? id : 'Sheet / general');
  return (
    <main className="part-page" style={{ maxWidth: 900 }}>
      <h1 style={{ marginBottom: 0 }}>{m.title}</h1>
      <p className="muted">
        {product?.code} · Rev {rev?.label} · {m.state} {m.closedAt ? `· closed ${new Date(m.closedAt).toLocaleString()}` : ''}
      </p>
      {!r && <p>The record is generated when the lead closes the meeting.</p>}
      {r && (
        <>
          <p>{r.summary}</p>
          <h2>Attendees</h2>
          <ul>
            {r.attendees.map((a) => (
              <li key={a.userId}>
                {a.name} — {TEAMS[a.team].label.en}, {a.role} ({a.device})
              </li>
            ))}
          </ul>
          <h2>Decisions</h2>
          {!r.decisions.length && <p className="muted">None confirmed.</p>}
          <ol>
            {r.decisions.map((d) => (
              <li key={d.id}>
                <strong>{d.text}</strong> — {TEAMS[d.ownerTeam].label.en}
                {d.due ? `, due ${d.due}` : ''}
                {d.partIds.length ? ` · parts: ${d.partIds.map(partName).join(', ')}` : ''}
                {d.linkedThreadId ? ' · change request on the draft' : ''}
                {d.source === 'ai' ? ` · proposed by AI, confirmed` : ''}
              </li>
            ))}
          </ol>
          <h2>Notes by part</h2>
          {r.notesByPart.map((g) => (
            <section key={g.partId ?? 'general'}>
              <h3>{g.partName}</h3>
              {g.byTeam.map((t) => (
                <div key={t.team}>
                  <strong>{TEAMS[t.team].label.en}</strong>
                  <ul>
                    {t.notes.map((n) => (
                      <li key={n.id}>
                        {n.tag ? `[${n.tag}] ` : ''}
                        {n.kind === 'ink' ? '(ink note)' : n.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          <h2>Open questions</h2>
          <ul>
            {r.openQuestions.map((n) => (
              <li key={n.id}>{n.text || '(ink)'} — {partName(n.anchor.kind === 'part' ? n.anchor.partId : null)}</li>
            ))}
          </ul>
          <h2>Transcript</h2>
          {!r.transcript.length && <p className="muted">No recording.</p>}
          {r.transcript.map((t) => (
            <p key={t.id}>
              <span className="mono muted">[{t.start.toFixed(0)}s]</span> {t.text} {t.partIds.length ? <span className="muted">· {t.partIds.map(partName).join(', ')}</span> : null}
            </p>
          ))}
        </>
      )}
    </main>
  );
}
