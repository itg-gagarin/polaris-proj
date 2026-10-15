import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth';
import { getRepo } from '@/server/context';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await getSession();
  if (!s) redirect('/login');
  const boards = await (await getRepo()).listBoards(s.workspace.id);
  if (s.user.external || !boards.length) redirect('/shared');
  redirect(`/board/${boards[0].id}`);
}
