// Invite codes, secrets, join tags and invite links (docs/PLAN.md 4.4).
//
// The link fragment carries the code, the secret and the commander
// fingerprint. The fragment is never sent to a server. Only `codeHash` (at
// invite creation) and `code` plus `joinTag` (at redemption) ever reach the
// module. The secret is never sent.

import { bytesToHex, inviteInput, joinInput } from '@/spacetimedb/src/shared/encoding';
import {
  HASH_LEN,
  INVITE_CODE_LEN,
  INVITE_SECRET_LEN,
  isUuidV4,
} from '@/spacetimedb/src/shared/limits';
import { INVITABLE_ROLES, type Role } from '@/spacetimedb/src/shared/policy';
import { b64urlDecode, b64urlEncode } from './b64url';
import { buf, randomBytes, sha256 } from './hash';

export interface NewInvite {
  code: Uint8Array; // 16 bytes
  secret: Uint8Array; // 32 bytes
  codeHash: Uint8Array; // SHA-256(enc('zh1/invite', incidentId, code))
}

export function newInvite(incidentId: string): NewInvite {
  const code = randomBytes(INVITE_CODE_LEN);
  const secret = randomBytes(INVITE_SECRET_LEN);
  return { code, secret, codeHash: inviteCodeHash(incidentId, code) };
}

export function inviteCodeHash(incidentId: string, code: Uint8Array): Uint8Array {
  return sha256(inviteInput(incidentId, code));
}

async function hmacKey(secret: Uint8Array, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export interface JoinFields {
  incidentId: string;
  identityHex: string;
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
}

/** HMAC-SHA256(secret, enc('zh1/join', incidentId, identityHex, displayName, signPub, ecdhPub)). */
export async function computeJoinTag(secret: Uint8Array, f: JoinFields): Promise<Uint8Array> {
  const msg = joinInput(f.incidentId, f.identityHex, f.displayName, f.signPub, f.ecdhPub);
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), buf(msg)));
}

/** Constant-time check (Web Crypto verify). Never throws. */
export async function verifyJoinTag(secret: Uint8Array, f: JoinFields, tag: Uint8Array): Promise<boolean> {
  try {
    if (tag.length !== HASH_LEN) return false;
    const msg = joinInput(f.incidentId, f.identityHex, f.displayName, f.signPub, f.ecdhPub);
    return await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), buf(tag), buf(msg));
  } catch {
    return false;
  }
}

export interface InviteFragment {
  incidentId: string;
  code: Uint8Array;
  secret: Uint8Array;
  /** Full 32-byte commander fingerprint. */
  commanderFingerprint: Uint8Array;
  role: Role;
}

/** Builds `i=...&c=...&s=...&f=...&r=...` (no leading `#`). */
export function buildInviteFragment(inv: InviteFragment): string {
  return [
    `i=${inv.incidentId}`,
    `c=${b64urlEncode(inv.code)}`,
    `s=${b64urlEncode(inv.secret)}`,
    `f=${b64urlEncode(inv.commanderFingerprint)}`,
    `r=${inv.role}`,
  ].join('&');
}

export function buildInviteUrl(origin: string, inv: InviteFragment): string {
  return `${origin.replace(/\/+$/, '')}/join#${buildInviteFragment(inv)}`;
}

/**
 * Strict parser for the join fragment. Accepts a leading `#`. Rejects unknown
 * keys, duplicate keys, wrong lengths and non-invitable roles. Returns null on
 * any problem (callers show a generic "invalid link").
 */
export function parseInviteFragment(fragment: string): InviteFragment | null {
  try {
    const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    if (raw.length === 0 || raw.length > 512) return null;
    const seen = new Map<string, string>();
    for (const part of raw.split('&')) {
      const eq = part.indexOf('=');
      if (eq <= 0) return null;
      const k = part.slice(0, eq);
      if (!['i', 'c', 's', 'f', 'r'].includes(k) || seen.has(k)) return null;
      seen.set(k, part.slice(eq + 1));
    }
    if (seen.size !== 5) return null;
    const incidentId = seen.get('i')!;
    const role = seen.get('r')!;
    if (!isUuidV4(incidentId)) return null;
    if (!(INVITABLE_ROLES as readonly string[]).includes(role)) return null;
    const code = b64urlDecode(seen.get('c')!);
    const secret = b64urlDecode(seen.get('s')!);
    const fp = b64urlDecode(seen.get('f')!);
    if (code.length !== INVITE_CODE_LEN || secret.length !== INVITE_SECRET_LEN || fp.length !== HASH_LEN) return null;
    return { incidentId, code, secret, commanderFingerprint: fp, role: role as Role };
  } catch {
    return null;
  }
}

export const inviteCodeHashHex = (incidentId: string, code: Uint8Array): string =>
  bytesToHex(inviteCodeHash(incidentId, code));
