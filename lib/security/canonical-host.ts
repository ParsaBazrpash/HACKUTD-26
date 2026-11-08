// One web address for the app. Device keys, the Spacetime sign-in and passkeys are all stored per
// web address, so a seat joined on one production domain is invisible on another. In production the
// app sends every other host to the host in PUBLIC_BASE_URL. Preview and local builds are untouched.
// The browser keeps the #fragment across the redirect, so invite and enrollment links still work.

type Redirect = {
  source: string;
  destination: string;
  permanent: boolean;
  missing: { type: 'host'; value: string }[];
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The canonical host from PUBLIC_BASE_URL, or null when it is missing, not https, or carries a path. */
export function canonicalHost(baseUrl: string | undefined): string | null {
  const raw = (baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    return url.host;
  } catch {
    return null;
  }
}

/**
 * Redirect rules for next.config. Empty unless this is the Vercel production build and PUBLIC_BASE_URL
 * names a plain https origin. API routes are left alone: Twilio webhooks already target PUBLIC_BASE_URL,
 * and a redirect would break their signature check.
 */
export function canonicalHostRedirects(env: { VERCEL_ENV?: string; PUBLIC_BASE_URL?: string }): Redirect[] {
  if (env.VERCEL_ENV !== 'production') return [];
  const host = canonicalHost(env.PUBLIC_BASE_URL);
  if (!host) return [];
  return [
    {
      source: '/:path((?!api/).*)',
      destination: `https://${host}/:path`,
      permanent: false,
      missing: [{ type: 'host', value: escapeRegex(host) }],
    },
  ];
}
