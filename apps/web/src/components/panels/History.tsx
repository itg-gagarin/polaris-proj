'use client';
import { useEffect, useState } from 'react';
import type { AuditEvent } from '@bom/domain';
import { useEditor, useRevision } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { api } from '@/lib/api';

/** Audit log: who, what, before, after, when and source (PRD §9). */
export function History() {
  const ui = useUi();
  const { users } = useEditor();
  const rev = useRevision(ui.activeRevisionId);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    if (!rev) return;
    void api<{ events: AuditEvent[] }>(`/api/revisions/${rev.id}/audit`).then((r) => setEvents(r.events));
  }, [rev, rev?.bundle?.revision.updatedAt]);
  if (!rev) return <div className="muted">Click a frame to see its history.</div>;
  return (
    <div>
      {events.map((e) => (
        <div key={e.id} style={{ borderBottom: '1px solid var(--line)', padding: '5px 0', fontSize: 12 }}>
          <div className="row">
            <span className="chip">{e.source}</span>
            <strong className="grow ellipsis">{e.what}</strong>
          </div>
          <div className="muted">
            {e.who.split(',').map((w) => users.get(w)?.name ?? w).join(', ')} · {new Date(e.at).toLocaleString()} · {e.revisionId === rev.id ? 'this revision' : 'other revision'}
          </div>
        </div>
      ))}
    </div>
  );
}
