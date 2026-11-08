import { describe, expect, it, vi } from 'vitest';
import { b64urlEncode } from '@/lib/crypto/b64url';
import { loadPagerConfig } from './config';
import { pagerUpdate } from './spacetime';
import { buildWorld } from './testkit';

vi.mock('server-only', () => ({}));

const pin = b64urlEncode(new Uint8Array([4, ...new Uint8Array(64).fill(7)]));
const good = {
  TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'tok',
  TWILIO_FROM: '+15559990000',
  PAGER_PRIVATE_KEY: 'abc',
  ORG_ADMIN_SIGN_PUB: `${pin},${pin}`,
  SPACETIME_PAGER_TOKEN: 'st',
  SPACETIME_HOST: 'https://maincloud.spacetimedb.com/',
  SPACETIME_DB: 'db',
  PUBLIC_BASE_URL: 'https://haven.example.com/',
  PAGER_ALLOWED_NUMBERS: '',
};

describe('loadPagerConfig', () => {
  it('reads a full config and trims trailing slashes', () => {
    const c = loadPagerConfig(good)!;
    expect(c.adminPins).toHaveLength(2);
    expect(c.publicBaseUrl).toBe('https://haven.example.com');
    expect(c.spacetimeHost).toBe('https://maincloud.spacetimedb.com');
    expect(c.allowedNumbers.size).toBe(0);
  });

  it.each(Object.keys(good).filter((k) => k !== 'PAGER_ALLOWED_NUMBERS'))('refuses when %s is missing', (k) => {
    expect(loadPagerConfig({ ...good, [k]: '' })).toBeNull();
  });

  it('refuses a bad pin, a non-https base, a bad allowlist entry and a bad from number', () => {
    expect(loadPagerConfig({ ...good, ORG_ADMIN_SIGN_PUB: 'AAAA' })).toBeNull();
    expect(loadPagerConfig({ ...good, PUBLIC_BASE_URL: 'http://haven.example.com' })).toBeNull();
    expect(loadPagerConfig({ ...good, PAGER_ALLOWED_NUMBERS: '5551234' })).toBeNull();
    expect(loadPagerConfig({ ...good, TWILIO_FROM: '5559990000' })).toBeNull();
  });
});

describe('pagerUpdate', () => {
  it('posts a JSON array with the u64 as a bare number and a bearer token', async () => {
    const w = await buildWorld();
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await pagerUpdate(w.cfg, f, w.pageId, '18446744073709551615', 'ringing')).toBe(true);
    expect(seen[0].url).toBe('https://db.example.com/v1/database/zerohour-test/call/pager_update');
    expect(seen[0].init.body).toBe(`["${w.pageId}",18446744073709551615,"ringing"]`);
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer spacetime-token');
  });

  it('refuses ids that are not a uuid and digits, so nothing untrusted reaches the call', async () => {
    const w = await buildWorld();
    const f = (async () => {
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;
    expect(await pagerUpdate(w.cfg, f, 'x', '1', 'ringing')).toBe(false);
    expect(await pagerUpdate(w.cfg, f, w.pageId, '1,2', 'ringing')).toBe(false);
    expect(await pagerUpdate(w.cfg, f, w.pageId, '01', 'ringing')).toBe(false);
  });
});

import { pagerConfigProblems } from './config';

describe('pagerConfigProblems', () => {
  it('lists setting names only, never values', () => {
    const problems = pagerConfigProblems({ TWILIO_AUTH_TOKEN: 'super-secret-token', TWILIO_FROM: '5551234' });
    expect(problems.join(' ')).toContain('TWILIO_FROM');
    expect(problems.join(' ')).toContain('ORG_ADMIN_SIGN_PUB');
    expect(problems.join(' ')).not.toContain('super-secret-token');
  });
});
