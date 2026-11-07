// SHA-256 and HMAC helpers.
//
// The module has no Web Crypto, and the client must compute byte-identical
// chain hashes, so hashing uses @noble/hashes in both places (PLAN rule 6
// allows noble "where Web Crypto is unavailable (the module, and hashing
// helpers)"). Encryption, signatures, ECDH and HKDF stay on Web Crypto.

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

/** Constant-time-ish byte comparison is in shared/encoding `bytesEqual`. */
export { bytesEqual } from '@/spacetimedb/src/shared/encoding';

/** Casts a Uint8Array to a Web Crypto BufferSource (TS 5.9 typing quirk). */
export const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}
