import { route } from '@/server/http';
import { requireSession } from '@/server/auth';

export const GET = route(async (req) => {
  const { repo } = await requireSession(req);
  return { entries: await repo.listStdParts() };
});
