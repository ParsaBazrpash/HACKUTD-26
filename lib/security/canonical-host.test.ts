import { describe, expect, it } from 'vitest';
import { canonicalHost, canonicalHostRedirects } from './canonical-host';

describe('canonical host redirect', () => {
  it('reads a plain https origin only', () => {
    expect(canonicalHost('https://haven.example.com/')).toBe('haven.example.com');
    expect(canonicalHost('http://haven.example.com')).toBeNull();
    expect(canonicalHost('https://haven.example.com/app')).toBeNull();
    expect(canonicalHost('https://user:pw@haven.example.com')).toBeNull();
    expect(canonicalHost('')).toBeNull();
    expect(canonicalHost(undefined)).toBeNull();
    expect(canonicalHost('not a url')).toBeNull();
  });

  it('does nothing outside the Vercel production build', () => {
    expect(canonicalHostRedirects({ VERCEL_ENV: 'preview', PUBLIC_BASE_URL: 'https://haven.example.com' })).toEqual([]);
    expect(canonicalHostRedirects({ PUBLIC_BASE_URL: 'https://haven.example.com' })).toEqual([]);
    expect(canonicalHostRedirects({ VERCEL_ENV: 'production', PUBLIC_BASE_URL: 'http://haven.example.com' })).toEqual([]);
  });

  it('sends every other host to the canonical one, except API routes', () => {
    const [rule, ...rest] = canonicalHostRedirects({ VERCEL_ENV: 'production', PUBLIC_BASE_URL: 'https://haven.example.com' });
    expect(rest).toEqual([]);
    expect(rule.destination).toBe('https://haven.example.com/:path');
    expect(rule.permanent).toBe(false);
    // The host check is an escaped literal, so "havenXexample.com" does not count as canonical.
    expect(rule.missing).toEqual([{ type: 'host', value: 'haven\\.example\\.com' }]);
    const pattern = new RegExp(`^${rule.source.replace('/:path', '/')}$`.replace('(', '(?:'));
    expect(pattern.test('/incidents')).toBe(true);
    expect(pattern.test('/api/page')).toBe(false);
  });
});
