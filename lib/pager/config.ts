import 'server-only';

import { b64urlDecode } from '@/lib/crypto/b64url';
import { PUBKEY_LEN } from '@/spacetimedb/src/shared/limits';
import { isE164 } from '@/spacetimedb/src/shared/org';

/** Server-only pager settings. Built from env; never serialized into a response or a log line. */
export interface PagerConfig {
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  /** pkcs8, base64url. Opens sealed phone numbers only. */
  pagerPrivateKey: string;
  /** Trusted org admin signing public keys (raw P-256, 65 bytes each). */
  adminPins: Uint8Array[];
  spacetimeToken: string;
  /** HTTPS Spacetime host with no trailing slash. */
  spacetimeHost: string;
  spacetimeDb: string;
  /** Production URL with no trailing slash. Twilio webhooks and signatures use it. */
  publicBaseUrl: string;
  /** Optional demo safety net. Empty means any certified number is allowed. */
  allowedNumbers: Set<string>;
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Returns null when anything is missing or malformed, so a half-configured deploy refuses to page. */
export function loadPagerConfig(env: Record<string, string | undefined> = process.env): PagerConfig | null {
  try {
    const sid = env.TWILIO_ACCOUNT_SID?.trim() ?? '';
    const token = env.TWILIO_AUTH_TOKEN?.trim() ?? '';
    const from = env.TWILIO_FROM?.trim() ?? '';
    const priv = env.PAGER_PRIVATE_KEY?.trim() ?? '';
    const spToken = env.SPACETIME_PAGER_TOKEN?.trim() ?? '';
    const host = (env.SPACETIME_HOST?.trim() ?? '').replace(/\/+$/, '');
    const db = env.SPACETIME_DB?.trim() ?? '';
    const base = (env.PUBLIC_BASE_URL?.trim() ?? '').replace(/\/+$/, '');
    if (!/^AC[0-9a-zA-Z]{32}$/.test(sid) || token.length === 0 || !isE164(from)) return null;
    if (priv.length === 0 || spToken.length === 0 || db.length === 0) return null;
    if (!host.startsWith('https://') || !base.startsWith('https://')) return null;
    const adminPins = list(env.ORG_ADMIN_SIGN_PUB).map((s) => b64urlDecode(s));
    if (adminPins.length === 0 || adminPins.some((p) => p.length !== PUBKEY_LEN)) return null;
    const allowed = list(env.PAGER_ALLOWED_NUMBERS);
    if (allowed.some((n) => !isE164(n))) return null;
    return {
      twilioSid: sid,
      twilioToken: token,
      twilioFrom: from,
      pagerPrivateKey: priv,
      adminPins,
      spacetimeToken: spToken,
      spacetimeHost: host,
      spacetimeDb: db,
      publicBaseUrl: base,
      allowedNumbers: new Set(allowed),
    };
  } catch {
    return null;
  }
}
