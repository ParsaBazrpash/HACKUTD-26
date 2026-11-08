// Security response headers (docs/PLAN.md section 7, THREAT_MODEL T10, T21, T25, T31).
// Pure so it can be tested; used by next.config.ts.

export interface HeaderPair {
  key: string;
  value: string;
}

/** ws(s) and http(s) origins for the Spacetime host, so connect-src allows exactly that server. */
export function connectOrigins(host: string): string[] {
  try {
    const u = new URL(host);
    const secure = u.protocol === 'wss:' || u.protocol === 'https:';
    const ws = `${secure ? 'wss' : 'ws'}://${u.host}`;
    const http = `${secure ? 'https' : 'http'}://${u.host}`;
    return [ws, http];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy(opts: { spacetimeHost: string; dev: boolean }): string {
  const connect = ["'self'", ...connectOrigins(opts.spacetimeHost)];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // Next.js inlines small bootstrap scripts; a nonce-based policy needs dynamic rendering for every page.
    'script-src': ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'frame-ancestors': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

export function securityHeaders(opts: { spacetimeHost: string; dev: boolean }): HeaderPair[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(opts) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // Invite secrets live in the URL fragment, which browsers never send, but keep referrers off anyway.
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Passkeys (WebAuthn) stay allowed for this origin only, for the opt-in key lock (lib/client/passkey-lock.ts).
    {
      key: 'Permissions-Policy',
      value:
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
    },
  ];
}
