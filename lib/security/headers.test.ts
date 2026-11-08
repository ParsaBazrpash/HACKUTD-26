import { describe, expect, it } from 'vitest';
import { connectOrigins, contentSecurityPolicy, pwaHeaders, securityHeaders } from './headers';

const HOST = 'wss://maincloud.spacetimedb.com';

describe('security headers (T25, T31, T21)', () => {
  it('forbids framing, plugins and base tag injection', () => {
    const csp = contentSecurityPolicy({ spacetimeHost: HOST, dev: false });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it('connects only to itself and the configured Spacetime host', () => {
    const csp = contentSecurityPolicy({ spacetimeHost: HOST, dev: false });
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src'))!;
    expect(connect).toBe("connect-src 'self' wss://maincloud.spacetimedb.com https://maincloud.spacetimedb.com");
    expect(connectOrigins('ws://localhost:3000')).toEqual(['ws://localhost:3000', 'http://localhost:3000']);
    expect(connectOrigins('not a url')).toEqual([]);
  });

  it('allows eval only in development', () => {
    expect(contentSecurityPolicy({ spacetimeHost: HOST, dev: false })).not.toContain('unsafe-eval');
    expect(contentSecurityPolicy({ spacetimeHost: HOST, dev: true })).toContain('unsafe-eval');
  });

  it('sends the standard hardening headers', () => {
    const h = Object.fromEntries(securityHeaders({ spacetimeHost: HOST, dev: false }).map((x) => [x.key, x.value]));
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Strict-Transport-Security']).toContain('max-age=');
    expect(h['Permissions-Policy']).toContain('camera=()');
  });

  it('does not store the service worker script or API responses', () => {
    const rules = Object.fromEntries(
      pwaHeaders().map((rule) => [rule.source, Object.fromEntries(rule.headers.map((header) => [header.key, header.value]))]),
    );
    expect(rules['/sw.js']['Cache-Control']).toContain('no-store');
    expect(rules['/api/:path*']['Cache-Control']).toBe('no-store');
  });

  it('allows passkeys for this origin only, and needs no CSP relaxation for them', () => {
    const h = Object.fromEntries(securityHeaders({ spacetimeHost: HOST, dev: false }).map((x) => [x.key, x.value]));
    expect(h['Permissions-Policy']).toContain('publickey-credentials-create=(self)');
    expect(h['Permissions-Policy']).toContain('publickey-credentials-get=(self)');
    expect(h['Permissions-Policy']).not.toMatch(/publickey-credentials-(create|get)=\*/);
    expect(h['Content-Security-Policy']).not.toContain('unsafe-eval');
  });
});
