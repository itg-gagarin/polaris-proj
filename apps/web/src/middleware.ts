import { NextResponse, type NextRequest } from 'next/server';
import { GATE_COOKIE, gateOk } from '@/server/gate';

/** Password gate (SITE_PASSWORD): every page and API route except the gate itself and the health check. */
export function middleware(req: NextRequest) {
  if (gateOk(req.cookies.get(GATE_COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Enter the site password first' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/gate';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Node runtime so SITE_PASSWORD is read when the server starts, not baked in at build time.
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|gate|api/gate|api/health).*)'],
};
