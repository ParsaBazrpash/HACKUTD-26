// Size caps, rate limits and input normalization (docs/PLAN.md 5.4 and 5.5).
// Shared by the Spacetime module and the browser client. Imports nothing.

export const MAX_CIPHERTEXT = 16400;
export const MIN_CIPHERTEXT = 17; // 16-byte GCM tag plus at least one plaintext byte
export const MAX_PLAINTEXT = 12288;
export const MAX_DISPLAY_NAME = 40;
export const MAX_MEMBERS = 50;
export const MAX_OPEN_INVITES = 20;
export const INVITE_TTL_DEFAULT_MIN = 15;
export const INVITE_TTL_MAX_MIN = 60;
export const REDEEM_ATTEMPTS = 5;
export const REDEEM_WINDOW_MIN = 10;
export const MAX_INCIDENTS_PER_IDENTITY = 5;
/** P1: token bucket for appends. */
export const APPEND_BURST = 30;
export const APPEND_REFILL_PER_SEC = 3;

export const PUBKEY_LEN = 65; // uncompressed P-256 point
export const SIG_LEN = 64; // ECDSA r||s
export const HASH_LEN = 32;
export const IV_LEN = 12;
export const WRAPPED_KEY_LEN = 48; // 32-byte key plus 16-byte GCM tag
export const INVITE_CODE_LEN = 16;
export const INVITE_SECRET_LEN = 32;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Lowercase RFC 4122 version 4 UUID, as produced by `crypto.randomUUID()`. */
export const isUuidV4 = (v: unknown): v is string => typeof v === 'string' && UUID_V4.test(v);

/** Lowercase hex of a Spacetime identity (256 bits). */
export const isIdentityHex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

// Control characters and bidi overrides stripped from display names, as code
// point ranges: 0x00-0x1F, 0x7F-0x9F, 0x200E-0x200F, 0x202A-0x202E, 0x2066-0x2069
// (the PLAN 5.5 set), plus invisible format characters that enable look-alike
// names: 0x061C, 0x200B-0x200D, 0x2060, 0xFEFF.
// (Ranges, not a regex with literal characters, so no invisible characters live in source.)
const STRIPPED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x061c, 0x061c],
  [0x200b, 0x200d],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
];

function stripControls(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (!STRIPPED_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) out += ch;
  }
  return out;
}

/**
 * Normalizes a display name (PLAN 5.5): NFKC, strip control and bidi
 * characters, collapse nothing else, trim. Returns the cleaned string; callers
 * must still check `isValidDisplayName`.
 */
export function normalizeDisplayName(raw: string): string {
  return stripControls(raw.normalize('NFKC')).trim();
}

/** True when the already-normalized name has 1..40 code points. */
export function isValidDisplayName(name: string): boolean {
  const len = Array.from(name).length;
  return len >= 1 && len <= MAX_DISPLAY_NAME;
}

/** Key for case-insensitive uniqueness of display names within an incident. */
export function displayNameKey(name: string): string {
  return name.toLowerCase();
}
