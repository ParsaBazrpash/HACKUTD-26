// AES-256-GCM sealing of event payloads (docs/PLAN.md 4.6 and 4.7).

import { IV_LEN, MAX_CIPHERTEXT, MAX_PLAINTEXT, MIN_CIPHERTEXT } from '@/spacetimedb/src/shared/limits';
import { buf, randomBytes } from './hash';

export const CHANNEL_KEY_LEN = 32;

/** Fresh random 256-bit channel key (raw). Only the commander generates these. */
export function generateChannelKeyBytes(): Uint8Array {
  return randomBytes(CHANNEL_KEY_LEN);
}

/** Imports a raw channel key as a non-extractable AES-GCM key. */
export async function importChannelKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== CHANNEL_KEY_LEN) throw new TypeError('invalid channel key');
  return crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export interface Sealed {
  iv: Uint8Array;
  ciphertext: Uint8Array; // includes the 16-byte GCM tag
}

/** Encrypts with a fresh random 96-bit IV. `aad` binds the ciphertext to its context. */
export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Sealed> {
  if (plaintext.length < 1 || plaintext.length > MAX_PLAINTEXT) throw new RangeError('plaintext size out of range');
  const iv = randomBytes(IV_LEN);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad) }, key, buf(plaintext));
  return { iv, ciphertext: new Uint8Array(ct) };
}

/** Decrypts and authenticates. Returns null on any failure (wrong key, AAD, tampering). */
export async function open(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    if (iv.length !== IV_LEN || ciphertext.length < MIN_CIPHERTEXT || ciphertext.length > MAX_CIPHERTEXT) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad) },
      key,
      buf(ciphertext),
    );
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}
