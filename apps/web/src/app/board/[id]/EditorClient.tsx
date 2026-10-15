'use client';
import dynamic from 'next/dynamic';

// The editor is client-only (WebGL, Yjs, IndexedDB).
const EditorApp = dynamic(() => import('@/components/EditorApp').then((m) => m.EditorApp), { ssr: false, loading: () => <div className="login muted">Loading the editor…</div> });

export function EditorClient({ boardId }: { boardId: string }) {
  return <EditorApp boardId={boardId} />;
}
