import { NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken, passwordOk } from '@/server/gate';

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  const nextPath = String(form.get('next') ?? '/');
  const safeNext = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/';
  if (!passwordOk(password)) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.redirect(new URL(`/gate?error=1&next=${encodeURIComponent(safeNext)}`, req.url), 303);
  }
  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set(GATE_COOKIE, gateToken(process.env.SITE_PASSWORD ?? ''), { httpOnly: true, sameSite: 'lax', secure: new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https', path: '/', maxAge: 60 * 60 * 24 * 14 });
  return res;
}
