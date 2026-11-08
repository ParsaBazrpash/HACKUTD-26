// Passkey vault: device keys encrypted at rest under a secret that only a
// passkey can produce (WebAuthn PRF extension). Opt-in, per browser.
//
//   salt     = SHA-256(enc('zh1/vault-prf', vaultId))       sent to the authenticator
//   prf      = PRF(credential, salt)                        32 bytes, never stored
//   kek      = HKDF-SHA256(prf, salt = enc('zh1/vault-salt', vaultId),
//                          info = enc('zh1/vault-kek', vaultId))   AES-GCM-256, non-extractable
//   verifier = HKDF-SHA256(prf, same salt, info = enc('zh1/vault-check', vaultId))
//   wrapped  = AES-GCM(kek, iv, pkcs8(privateKey),
//                      aad = enc('zh1/vault-wrap', vaultId, incidentId, use, signPub, ecdhPub))
//
// Private keys are generated extractable only for the moment it takes to wrap
// them, then unwrapped again as non-extractable keys for use. Raw private key
// bytes never pass through JavaScript: wrapKey and unwrapKey do the export and
// import inside Web Crypto. What sits on disk is ciphertext, the public keys and
// the vault id. The verifier is an independent HKDF output, so storing it does
// not reveal the kek; it only lets unlock tell a wrong passkey apart from a
// damaged record.
//
// Threats (docs/THREAT_MODEL.md T20, T36): protects keys in a copied or seized
// browser profile while the vault is locked. It does not protect against code
// running in the page while unlocked; that code can use the keys (but not export
// them, since the unlocked keys are non-extractable).

import { bytesEqual, enc } from '@/spacetimedb/src/shared/encoding';
import { IV_LEN } from '@/spacetimedb/src/shared/limits';
import { buf, randomBytes, sha256 } from './hash';
import { type DeviceKeys, isRawPublicKey } from './keys';

const TAG = {
  prf: 'zh1/vault-prf',
  salt: 'zh1/vault-salt',
  kek: 'zh1/vault-kek',
  check: 'zh1/vault-check',
  wrap: 'zh1/vault-wrap',
} as const;

export const VAULT_ID_LEN = 32;
export const PRF_OUTPUT_LEN = 32;
const VERIFIER_LEN = 32;

/** The unlocked vault: a wrapping key held in memory only. */
export interface VaultKey {
  vaultId: Uint8Array;
  kek: CryptoKey; // AES-GCM-256, non-extractable, wrapKey/unwrapKey only
}

/** Device keys as stored when the passkey lock is on. Contains no usable private key. */
export interface LockedDeviceKeys {
  v: 1;
  vaultId: Uint8Array;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  signWrapped: Uint8Array;
  signIv: Uint8Array;
  ecdhWrapped: Uint8Array;
  ecdhIv: Uint8Array;
}

type KeyUse = 'sign' | 'ecdh';

const isBytes = (x: unknown, len?: number): x is Uint8Array =>
  x instanceof Uint8Array && (len === undefined || x.length === len);

export function newVaultId(): Uint8Array {
  return randomBytes(VAULT_ID_LEN);
}

/** The PRF input for a vault. Deterministic, so unlock asks the authenticator the same question. */
export function vaultPrfSalt(vaultId: Uint8Array): Uint8Array {
  if (!isBytes(vaultId, VAULT_ID_LEN)) throw new TypeError('invalid vault id');
  return sha256(enc(TAG.prf, vaultId));
}

async function hkdf(prfOutput: Uint8Array, vaultId: Uint8Array): Promise<CryptoKey> {
  if (!isBytes(prfOutput, PRF_OUTPUT_LEN)) throw new TypeError('invalid PRF output');
  if (!isBytes(vaultId, VAULT_ID_LEN)) throw new TypeError('invalid vault id');
  return crypto.subtle.importKey('raw', buf(prfOutput), 'HKDF', false, ['deriveKey', 'deriveBits']);
}

/** Derives the vault key and its verifier from one PRF output. */
export async function deriveVault(
  prfOutput: Uint8Array,
  vaultId: Uint8Array,
): Promise<{ key: VaultKey; verifier: Uint8Array }> {
  const ikm = await hkdf(prfOutput, vaultId);
  const salt = buf(enc(TAG.salt, vaultId));
  const kek = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: buf(enc(TAG.kek, vaultId)) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
  const verifier = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: buf(enc(TAG.check, vaultId)) },
      ikm,
      VERIFIER_LEN * 8,
    ),
  );
  return { key: { vaultId: vaultId.slice(), kek }, verifier };
}

/** Constant-time check that a PRF output belongs to this vault. */
export function verifierMatches(expected: Uint8Array, actual: Uint8Array): boolean {
  return isBytes(expected, VERIFIER_LEN) && isBytes(actual, VERIFIER_LEN) && bytesEqual(expected, actual);
}

function wrapAad(vaultId: Uint8Array, incidentId: string, use: KeyUse, signPub: Uint8Array, ecdhPub: Uint8Array): Uint8Array {
  return enc(TAG.wrap, vaultId, incidentId, use, signPub, ecdhPub);
}

async function exportRaw(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/**
 * Generates a fresh device identity whose private keys exist on disk only as
 * ciphertext under the vault key. Returns the record to store and the same
 * keys, non-extractable, for this session.
 */
export async function generateLockedDeviceKeys(
  vault: VaultKey,
  incidentId: string,
): Promise<{ record: LockedDeviceKeys; keys: DeviceKeys }> {
  const sign = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const ecdh = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const signPub = await exportRaw(sign.publicKey);
  const ecdhPub = await exportRaw(ecdh.publicKey);
  const signIv = randomBytes(IV_LEN);
  const ecdhIv = randomBytes(IV_LEN);
  const wrap = async (key: CryptoKey, iv: Uint8Array, use: KeyUse) =>
    new Uint8Array(
      await crypto.subtle.wrapKey('pkcs8', key, vault.kek, {
        name: 'AES-GCM',
        iv: buf(iv),
        additionalData: buf(wrapAad(vault.vaultId, incidentId, use, signPub, ecdhPub)),
      }),
    );
  const record: LockedDeviceKeys = {
    v: 1,
    vaultId: vault.vaultId.slice(),
    signPub,
    ecdhPub,
    signWrapped: await wrap(sign.privateKey, signIv, 'sign'),
    signIv,
    ecdhWrapped: await wrap(ecdh.privateKey, ecdhIv, 'ecdh'),
    ecdhIv,
  };
  // Hand back non-extractable copies; the extractable originals go out of scope here.
  const keys = await openLockedDeviceKeys(vault, record, incidentId);
  if (!keys) throw new Error('vault round trip failed');
  return { record, keys };
}

/** Structural check for a stored record. Authenticity is checked by `openLockedDeviceKeys`. */
export function isLockedDeviceKeys(x: unknown): x is LockedDeviceKeys {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    r.v === 1 &&
    isBytes(r.vaultId, VAULT_ID_LEN) &&
    isRawPublicKey(r.signPub) &&
    isRawPublicKey(r.ecdhPub) &&
    isBytes(r.signWrapped) &&
    isBytes(r.signIv, IV_LEN) &&
    isBytes(r.ecdhWrapped) &&
    isBytes(r.ecdhIv, IV_LEN)
  );
}

/**
 * Unwraps a locked record into non-extractable device keys. Returns null when
 * the record does not authenticate under this vault key for this incident
 * (wrong passkey, another incident's record, swapped or edited fields).
 */
export async function openLockedDeviceKeys(
  vault: VaultKey,
  record: LockedDeviceKeys,
  incidentId: string,
): Promise<DeviceKeys | null> {
  if (!isLockedDeviceKeys(record) || !bytesEqual(record.vaultId, vault.vaultId)) return null;
  const unwrap = (wrapped: Uint8Array, iv: Uint8Array, use: KeyUse) =>
    crypto.subtle.unwrapKey(
      'pkcs8',
      buf(wrapped),
      vault.kek,
      {
        name: 'AES-GCM',
        iv: buf(iv),
        additionalData: buf(wrapAad(record.vaultId, incidentId, use, record.signPub, record.ecdhPub)),
      },
      use === 'sign' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'ECDH', namedCurve: 'P-256' },
      false,
      use === 'sign' ? ['sign'] : ['deriveBits'],
    );
  try {
    return {
      signPriv: await unwrap(record.signWrapped, record.signIv, 'sign'),
      signPub: record.signPub.slice(),
      ecdhPriv: await unwrap(record.ecdhWrapped, record.ecdhIv, 'ecdh'),
      ecdhPub: record.ecdhPub.slice(),
    };
  } catch {
    return null;
  }
}
