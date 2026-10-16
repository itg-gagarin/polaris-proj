import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth';
import { HomeClient } from './HomeClient';

export const dynamic = 'force-dynamic';

/** Start page after sign-in. External buyers go straight to what is shared with them. */
export default async function Home() {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.user.external) redirect('/shared');
  return <HomeClient />;
}
