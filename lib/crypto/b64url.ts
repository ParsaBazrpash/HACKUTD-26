// base64url without padding (docs/PLAN.md 4.2). Strict decoding: only the
// canonical encoding of a byte string is accepted, so two different strings
// never decode to the same bytes.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i;

export function b64urlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** Decodes canonical unpadded base64url. Throws TypeError on anything else. */
export function b64urlDecode(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length % 4 === 1) throw new TypeError('b64url: invalid input');
  const vals: number[] = [];
  for (const ch of s) {
    const v = LOOKUP[ch];
    if (v === undefined) throw new TypeError('b64url: invalid character');
    vals.push(v);
  }
  const out = new Uint8Array(Math.floor((vals.length * 6) / 8));
  let o = 0;
  let i = 0;
  for (; i + 3 < vals.length; i += 4) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3];
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = vals.length - i;
  if (rest === 2) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12);
    if ((n & 0xffff) !== 0) throw new TypeError('b64url: non-canonical');
    out[o++] = (n >> 16) & 255;
  } else if (rest === 3) {
    const n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6);
    if ((n & 0xff) !== 0) throw new TypeError('b64url: non-canonical');
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
  }
  return out;
}
