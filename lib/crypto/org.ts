// Org roster and paging crypto (WP0). Pure Web Crypto, runs in the browser and
// in Node 22 (`globalThis.crypto.subtle`). Hashing uses @noble via ./hash.
//
// Every signed, hashed, HMACed or AAD input is built by lib/protocol/org.ts
// with `enc()` and a `zh1/org/...` domain tag.

import {
  contactAad,
  contactSalt,
  enrollJoinInput,
  enrollLinkInput,
  enrollStatement,
  isE164,
  orgRevokeStatement,
  orgSafetyInput,
  pageStatement,
} from '@/lib/protocol/org';
import { HASH_LEN, IV_LEN, PUBKEY_LEN } from '@/spacetimedb/src/shared/limits';
import { SEALED_CONTACT_HEADER, SEALED_CONTACT_MAX, SEALED_CONTACT_MIN } from '@/spacetimedb/src/shared/org';
import { buf, randomBytes, sha256 } from './hash';
import { importEcdhPub } from './keys';
import { sign, verify } from './sign';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

// --- Enrollment link ----------------------------------------------------------------

/** SHA-256(enc('zh1/org/enroll-link', orgId, code)). Only this hash is stored. */
export const enrollLinkHash = (orgId: string, code: Uint8Array): Uint8Array => sha256(enrollLinkInput(orgId, code));

export interface EnrollJoinFields {
  orgId: string;
  identityHex: string;
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  sealedContact: Uint8Array;
}

const joinMessage = (f: EnrollJoinFields): Uint8Array =>
  enrollJoinInput(f.orgId, f.identityHex, f.displayName, f.signPub, f.ecdhPub, sha256(f.sealedContact));

async function hmacKey(secret: Uint8Array, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** HMAC-SHA256 under the link secret, so only holders of the link can enroll. */
export async function computeEnrollJoinTag(secret: Uint8Array, f: EnrollJoinFields): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), buf(joinMessage(f))));
}

/** Constant-time check. Never throws. */
export async function verifyEnrollJoinTag(secret: Uint8Array, f: EnrollJoinFields, tag: Uint8Array): Promise<boolean> {
  try {
    if (tag.length !== HASH_LEN) return false;
    return await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), buf(tag), buf(joinMessage(f)));
  } catch {
    return false;
  }
}

// --- Admin enrollment certificate -----------------------------------------------------

export interface EnrollmentFields {
  orgId: string;
  identityHex: string;
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  sealedContact: Uint8Array;
}

const enrollMessage = (f: EnrollmentFields): Uint8Array =>
  enrollStatement(f.orgId, f.identityHex, f.displayName, f.signPub, f.ecdhPub, sha256(f.sealedContact));

export const signEnrollment = (adminSignPriv: CryptoKey, f: EnrollmentFields): Promise<Uint8Array> =>
  sign(adminSignPriv, enrollMessage(f));

export const verifyEnrollment = (adminSignPub: Uint8Array | CryptoKey, f: EnrollmentFields, sig: Uint8Array): Promise<boolean> =>
  verify(adminSignPub, enrollMessage(f), sig);

// --- Revocation ------------------------------------------------------------------------

export interface RevocationFields {
  orgId: string;
  orgMemberId: bigint;
  identityHex: string;
  reason: string;
}

const revokeMessage = (f: RevocationFields): Uint8Array =>
  orgRevokeStatement(f.orgId, f.orgMemberId, f.identityHex, f.reason);

export const signRevocation = (adminSignPriv: CryptoKey, f: RevocationFields): Promise<Uint8Array> =>
  sign(adminSignPriv, revokeMessage(f));

export const verifyRevocation = (adminSignPub: Uint8Array | CryptoKey, f: RevocationFields, sig: Uint8Array): Promise<boolean> =>
  verify(adminSignPub, revokeMessage(f), sig);

// --- Page request ------------------------------------------------------------------------

export interface PageRequestFields {
  orgId: string;
  incidentId: string;
  pageId: string;
  sentAtMs: number;
  orgMemberIds: readonly bigint[];
}

/** Throws on duplicate ids; verify returns false instead. */
export async function signPageRequest(commanderSignPriv: CryptoKey, f: PageRequestFields): Promise<Uint8Array> {
  return sign(commanderSignPriv, pageStatement(f.orgId, f.incidentId, f.pageId, f.sentAtMs, f.orgMemberIds));
}

export async function verifyPageRequest(
  commanderSignPub: Uint8Array | CryptoKey,
  f: PageRequestFields,
  sig: Uint8Array,
): Promise<boolean> {
  try {
    return await verify(commanderSignPub, pageStatement(f.orgId, f.incidentId, f.pageId, f.sentAtMs, f.orgMemberIds), sig);
  } catch {
    return false;
  }
}

// --- Sealed phone number -------------------------------------------------------------------

async function contactKey(priv: CryptoKey, peerPub: Uint8Array, orgId: string, identityHex: string): Promise<CryptoKey> {
  const peer = await importEcdhPub(peerPub);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(contactSalt(orgId)), info: buf(contactAad(orgId, identityHex)) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Seals an E.164 number to the pager's public key: ephemeral ECDH P-256,
 * HKDF-SHA256, AES-256-GCM with AAD enc('zh1/org/contact', orgId, identityHex).
 * Output is ephPub (65) || iv (12) || ciphertext. Throws on a malformed number.
 */
export async function sealContact(
  pagerEcdhPub: Uint8Array,
  orgId: string,
  identityHex: string,
  e164: string,
): Promise<Uint8Array> {
  if (!isE164(e164)) throw new TypeError('phone must be E.164');
  const eph = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const key = await contactKey(eph.privateKey, pagerEcdhPub, orgId, identityHex);
  const iv = randomBytes(IV_LEN);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(contactAad(orgId, identityHex)) },
      key,
      buf(textEncoder.encode(e164)),
    ),
  );
  const out = new Uint8Array(ephPub.length + iv.length + ct.length);
  out.set(ephPub, 0);
  out.set(iv, ephPub.length);
  out.set(ct, ephPub.length + iv.length);
  return out;
}

/** Returns the E.164 number, or null if anything fails to authenticate or validate. */
export async function openContact(
  pagerEcdhPriv: CryptoKey,
  orgId: string,
  identityHex: string,
  sealed: Uint8Array,
): Promise<string | null> {
  try {
    if (!(sealed instanceof Uint8Array) || sealed.length < SEALED_CONTACT_MIN || sealed.length > SEALED_CONTACT_MAX) return null;
    const ephPub = sealed.subarray(0, PUBKEY_LEN);
    const iv = sealed.subarray(PUBKEY_LEN, SEALED_CONTACT_HEADER);
    const ct = sealed.subarray(SEALED_CONTACT_HEADER);
    const key = await contactKey(pagerEcdhPriv, ephPub, orgId, identityHex);
    const pt = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buf(iv), additionalData: buf(contactAad(orgId, identityHex)) },
        key,
        buf(ct),
      ),
    );
    const e164 = textDecoder.decode(pt);
    return isE164(e164) ? e164 : null;
  } catch {
    return null;
  }
}

// --- Safety code ------------------------------------------------------------------------------

/**
 * Spoken during approval: first 5 bytes of
 * SHA-256(enc('zh1/org/safety', orgId, identityHex, signPub, ecdhPub)) as a
 * big-endian integer, mod 10^12, shown as "123 456 789 012".
 */
export function orgSafetyCode(orgId: string, identityHex: string, signPub: Uint8Array, ecdhPub: Uint8Array): string {
  const h = sha256(orgSafetyInput(orgId, identityHex, signPub, ecdhPub));
  let n = 0n;
  for (let i = 0; i < 5; i++) n = (n << 8n) | BigInt(h[i]);
  const s = (n % 1_000_000_000_000n).toString().padStart(12, '0');
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9, 12)}`;
}
