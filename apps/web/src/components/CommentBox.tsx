'use client';
import { useState } from 'react';
import type { Anchor } from '@bom/domain';

/** Minimal comment form for the QR part page and the buyer page (phones: view and comment). */
export function CommentBox({ revisionId, anchor }: { revisionId: string; anchor: Anchor }) {
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle');
  const send = async () => {
    setState('sending');
    const r = await fetch('/api/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revisionId, anchor, body }) });
    if (r.ok) {
      setBody('');
      setState('sent');
      location.reload();
    } else setState(((await r.json()) as { error: string }).error);
  };
  return (
    <div className="col" style={{ marginTop: 8 }}>
      <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Comment, @mention someone" />
      <div className="row">
        <button className="btn primary" disabled={!body.trim() || state === 'sending'} onClick={send}>
          Comment
        </button>
        {state !== 'idle' && state !== 'sending' && <span className="muted">{state}</span>}
      </div>
    </div>
  );
}
