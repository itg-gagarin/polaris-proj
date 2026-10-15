import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Site-wide password gate for hosted demos (SITE_PASSWORD). It sits in front of the dev user picker,
 * which on its own lets anyone act as any user. Not a substitute for real accounts (AUTH_PROVIDER=supabase).
 */
export const GATE_COOKIE = 'bom_gate';

export function gateToken(password: string): string {
  return createHash('sha256').update(`bom-studio-gate:${password}`).digest('hex');
}

export function gateEnabled(): boolean {
  return !!process.env.SITE_PASSWORD;
}

export function gateOk(cookie: string | undefined): boolean {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return true;
  if (!cookie) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(gateToken(pw));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function passwordOk(input: string): boolean {
  const pw = process.env.SITE_PASSWORD;
  if (!pw) return true;
  const a = Buffer.from(gateToken(input));
  const b = Buffer.from(gateToken(pw));
  return timingSafeEqual(a, b);
}
