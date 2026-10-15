'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, type Bootstrap } from '@/lib/api';
import { EditorProvider } from '@/lib/editor';
import { useUi } from '@/lib/store';
import { Shell } from './Shell';

export function EditorApp({ boardId }: { boardId: string }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Bootstrap>('/api/bootstrap')
      .then((b) => {
        setBoot(b);
        const board = b.boards.find((x) => x.id === boardId);
        const first = board?.items.find((i) => i.kind === 'frame');
        if (first && first.kind === 'frame') useUi.setState({ activeFrameId: first.id, activeRevisionId: first.revisionId });
      })
      .catch((e: Error) => {
        if (e instanceof ApiError && e.status === 401) location.href = '/login';
        else setError(e.message);
      });
  }, [boardId]);
  if (error) return <div className="login">Could not load the workspace: {error}</div>;
  if (!boot) return <div className="login muted">Loading the board… (the first start imports the Hollan House fixtures)</div>;
  if (!boot.boards.some((b) => b.id === boardId)) return <div className="login">Board not found or not shared with you.</div>;
  return (
    <EditorProvider boot={boot} boardId={boardId}>
      <Shell />
    </EditorProvider>
  );
}
