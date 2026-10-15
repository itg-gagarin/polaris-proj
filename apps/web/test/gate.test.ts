import { describe, it, expect, afterEach } from 'vitest';
import { gateOk, gateToken, passwordOk } from '../src/server/gate';

describe('site password gate', () => {
  afterEach(() => {
    delete process.env.SITE_PASSWORD;
  });
  it('is open when SITE_PASSWORD is not set', () => {
    expect(gateOk(undefined)).toBe(true);
    expect(passwordOk('anything')).toBe(true);
  });
  it('accepts only the right password and its cookie token', () => {
    process.env.SITE_PASSWORD = 's3cret';
    expect(gateOk(undefined)).toBe(false);
    expect(gateOk('nope')).toBe(false);
    expect(gateOk(gateToken('s3cret'))).toBe(true);
    expect(passwordOk('s3cret')).toBe(true);
    expect(passwordOk('S3cret')).toBe(false);
  });
  it('a changed password invalidates old cookies', () => {
    process.env.SITE_PASSWORD = 'old';
    const t = gateToken('old');
    process.env.SITE_PASSWORD = 'new';
    expect(gateOk(t)).toBe(false);
  });
});
