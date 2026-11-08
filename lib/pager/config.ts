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

/** Names only (never values) of the settings that make loadPagerConfig return null. For server logs. */
export function pagerConfigProblems(env: Record<string, string | undefined> = process.env): string[] {
  const t = (k: string): string => env[k]?.trim() ?? '';
  const out: string[] = [];
  if (!/^AC[0-9a-zA-Z]{32}$/.test(t('TWILIO_ACCOUNT_SID'))) out.push('TWILIO_ACCOUNT_SID');
  if (t('TWILIO_AUTH_TOKEN').length === 0) out.push('TWILIO_AUTH_TOKEN');
  if (!isE164(t('TWILIO_FROM'))) out.push('TWILIO_FROM (must be E.164, e.g. +15551234567)');
  if (t('PAGER_PRIVATE_KEY').length === 0) out.push('PAGER_PRIVATE_KEY');
  if (t('SPACETIME_PAGER_TOKEN').length === 0) out.push('SPACETIME_PAGER_TOKEN');
  if (t('SPACETIME_DB').length === 0) out.push('SPACETIME_DB');
  if (!t('SPACETIME_HOST').startsWith('https://')) out.push('SPACETIME_HOST (must start with https://)');
  if (!t('PUBLIC_BASE_URL').startsWith('https://')) out.push('PUBLIC_BASE_URL (must start with https://)');
  try {
    const pins = list(env.ORG_ADMIN_SIGN_PUB).map((x) => b64urlDecode(x));
    if (pins.length === 0 || pins.some((x) => x.length !== PUBKEY_LEN)) out.push('ORG_ADMIN_SIGN_PUB (missing or not a 65-byte key)');
  } catch {
    out.push('ORG_ADMIN_SIGN_PUB (not base64url)');
  }
  if (list(env.PAGER_ALLOWED_NUMBERS).some((n) => !isE164(n))) out.push('PAGER_ALLOWED_NUMBERS (every entry must be E.164)');
  return out;
}
