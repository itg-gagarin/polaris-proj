import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth';
import { EditorClient } from './EditorClient';

export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  const { id } = await params;
  return <EditorClient boardId={id} />;
}
