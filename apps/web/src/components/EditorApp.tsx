'use client';
import { useEffect, useState } from 'react';
import { api, ApiError, type Bootstrap } from '@/lib/api';
import { EditorProvider } from '@/lib/editor';
import { useUi, type MainView } from '@/lib/store';
import { hydratePrefs, usePrefs } from '@/lib/prefs';
import { Shell } from './Shell';

export function EditorApp({ boardId }: { boardId: string }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    hydratePrefs();
    // Links from Home: ?rev=<revision>&view=<model|drawing|parts|checks|board>&import=1
    const q = new URLSearchParams(location.search);
    const wantView = q.get('view') as MainView | null;
    const mode = usePrefs.getState().mode;
    const view: MainView = wantView && ['model', 'drawing', 'parts', 'checks', 'board'].includes(wantView) ? wantView : mode === 'advanced' ? useUi.getState().view : 'model';
    useUi.setState({ view: view === 'board' && mode !== 'advanced' ? 'model' : view, importOpen: q.get('import') === '1' });
    api<Bootstrap>('/api/bootstrap')
      .then((b) => {
        setBoot(b);
        const board = b.boards.find((x) => x.id === boardId);
        const first = board?.items.find((i) => i.kind === 'frame');
        const rev = q.get('rev');
        if (rev && b.revisions.some((r) => r.id === rev)) useUi.setState({ activeRevisionId: rev, activeFrameId: (board?.items.find((i) => i.kind === 'frame' && i.revisionId === rev)?.id as string | undefined) ?? null });
        else if (first && first.kind === 'frame') useUi.setState({ activeFrameId: first.id, activeRevisionId: first.revisionId });
      })
      .catch((e: Error) => {
        if (e instanceof ApiError && e.status === 401) location.href = '/login';
        else setError(e.message);
      });
  }, [boardId]);
  if (error) return <div className="login">Could not load the workspace: {error}</div>;
  if (!boot) return <div className="login muted" data-testid="loading">Loading… (the very first start prepares the Hollan House examples)</div>;
  if (!boot.boards.some((b) => b.id === boardId)) return <div className="login">Board not found or not shared with you.</div>;
  return (
    <EditorProvider boot={boot} boardId={boardId}>
      <Shell />
    </EditorProvider>
  );
}
