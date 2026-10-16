import { mintSyncToken } from '@bom/sync/auth';
import { route } from '@/server/http';
import { requireSession } from '@/server/auth';

/** Short-lived token for the sync WebSocket, only for signed-in users (behind the site password). */
export const GET = route(async (req) => {
  const { user } = await requireSession(req);
  const secret = process.env.SYNC_TOKEN_SECRET;
  // Without a secret the sync server runs in dev mode and accepts "dev:<userId>".
  return { token: secret ? mintSyncToken(user.id, secret) : `dev:${user.id}` };
});
