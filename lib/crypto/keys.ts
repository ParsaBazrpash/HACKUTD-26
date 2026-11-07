// Device keys, fingerprints and safety codes (docs/PLAN.md 4.3).
//
// Private keys are generated non-extractable and never exported. Public keys
// are 65-byte uncompressed P-256 points.

import { bytesToHex, fingerprintInput, safetyInput } from '@/spacetimedb/src/shared/encoding';
import { PUBKEY_LEN } from '@/spacetimedb/src/shared/limits';
import { buf, sha256 } from './hash';

export interface DeviceKeys {
  signPriv: CryptoKey; // ECDSA P-256, non-extractable
  signPub: Uint8Array; // raw, 65 bytes
  ecdhPriv: CryptoKey; // ECDH P-256, non-extractable
  ecdhPub: Uint8Array; // raw, 65 bytes
}

async function exportRaw(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/** Generates a fresh device identity. Private keys are non-extractable. */
export async function generateDeviceKeys(): Promise<DeviceKeys> {
  const sign = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const ecdh = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return {
    signPriv: sign.privateKey,
    signPub: await exportRaw(sign.publicKey),
    ecdhPriv: ecdh.privateKey,
    ecdhPub: await exportRaw(ecdh.publicKey),
  };
}

/** Cheap structural check: 65 bytes, uncompressed point marker. Curve membership is checked on import. */
export function isRawPublicKey(b: unknown): b is Uint8Array {
  return b instanceof Uint8Array && b.length === PUBKEY_LEN && b[0] === 0x04;
}

/** Imports a raw ECDSA public key for verification. Throws if it is not a valid P-256 point. */
export async function importSignPub(raw: Uint8Array): Promise<CryptoKey> {
  if (!isRawPublicKey(raw)) throw new TypeError('invalid public key');
  return crypto.subtle.importKey('raw', buf(raw), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

/** Imports a raw ECDH public key. Throws if it is not a valid P-256 point. */
export async function importEcdhPub(raw: Uint8Array): Promise<CryptoKey> {
  if (!isRawPublicKey(raw)) throw new TypeError('invalid public key');
  return crypto.subtle.importKey('raw', buf(raw), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

/** Full 32-byte fingerprint: SHA-256(enc('zh1/fp', signPub, ecdhPub)). Travels in invite links. */
export function fingerprintBytes(signPub: Uint8Array, ecdhPub: Uint8Array): Uint8Array {
  return sha256(fingerprintInput(signPub, ecdhPub));
}

/** Display form: first 16 bytes as 8 groups of 4 lowercase hex characters. */
export function formatFingerprint(fp: Uint8Array): string {
  const hex = bytesToHex(fp.subarray(0, 16));
  return hex.match(/.{4}/g)!.join(' ');
}

export function fingerprint(signPub: Uint8Array, ecdhPub: Uint8Array): string {
  return formatFingerprint(fingerprintBytes(signPub, ecdhPub));
}

/**
 * Safety code read aloud during admission: first 5 bytes of
 * SHA-256(enc('zh1/safety', incidentId, identityHex, signPub, ecdhPub)) as a
 * big-endian integer, mod 10^12, zero-padded, shown as "123 456 789 012".
 */
export function safetyCode(incidentId: string, identityHex: string, signPub: Uint8Array, ecdhPub: Uint8Array): string {
  const h = sha256(safetyInput(incidentId, identityHex, signPub, ecdhPub));
  let n = 0n;
  for (let i = 0; i < 5; i++) n = (n << 8n) | BigInt(h[i]);
  const s = (n % 1_000_000_000_000n).toString().padStart(12, '0');
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9, 12)}`;
}
