import { NextResponse } from 'next/server';

/** Liveness for the hosting platform (no auth, no data). */
export function GET() {
  return NextResponse.json({ ok: true });
}
