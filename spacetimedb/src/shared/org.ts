// Org roster and paging: domain tags, statement builders and limits.
//
// Shared by the Spacetime module and the browser client, like encoding.ts. It
// imports only sibling shared files. Every signature, hash, HMAC, AAD and KDF
// input is built with `enc()` and starts with a `zh1/org/...` domain tag.
// Never sign or hash JSON.

import { enc } from './encoding';
import { isIdentityHex, isUuidV4, normalizeDisplayName } from './limits';

export const ORG_DOMAIN = {
  enrollLink: 'zh1/org/enroll-link',
  enroll: 'zh1/org/enroll',
  join: 'zh1/org/join',
  revoke: 'zh1/org/revoke',
  contact: 'zh1/org/contact',
  contactSalt: 'zh1/org/contact-salt',
  page: 'zh1/org/page',
  safety: 'zh1/org/safety',
} as const;

// --- Limits ---------------------------------------------------------------------

export const MAX_ORG_NAME = 80;
export const ENROLL_LINK_CODE_LEN = 16;
export const ENROLL_LINK_SECRET_LEN = 32;
export const ENROLL_TTL_MIN_HOURS = 1;
export const ENROLL_TTL_MAX_HOURS = 24;
export const MAX_PAGE_TARGETS = 8;
/** Maximum size of the /api/page request body in bytes. */
export const MAX_PAGE_BODY_BYTES = 16384;
/** Ephemeral ECDH public key (65) plus IV (12). */
export const SEALED_CONTACT_HEADER = 77;
/** The phone plaintext is zero-padded to 16 bytes ("+" and 15 digits is the longest), so its length leaks nothing. */
export const CONTACT_PLAINTEXT_LEN = 16;
/** Sealed contact is always header (77) + padded plaintext (16) + GCM tag (16) bytes. */
export const SEALED_CONTACT_LEN = SEALED_CONTACT_HEADER + CONTACT_PLAINTEXT_LEN + 16;
export const SEALED_CONTACT_MIN = SEALED_CONTACT_LEN;
export const SEALED_CONTACT_MAX = SEALED_CONTACT_LEN;
export const MAX_ORG_REASON = 200;
/**
 * The only reason a member's own leave signature covers. The module stores the
 * signature, not the reason, so every verifier rebuilds this exact statement.
 * Distinct from an admin revocation, which uses a different fixed reason.
 */
export const ORG_LEAVE_REASON = 'left the org';

const E164 = /^\+[0-9]{8,15}$/;
/** E.164 only: "+" then 8 to 15 digits. No spaces, dashes or leading zero after the plus. */
export const isE164 = (v: unknown): v is string => typeof v === 'string' && E164.test(v) && v[1] !== '0';

export function normalizeOrgName(raw: string): string {
  return normalizeDisplayName(raw);
}

/** True when the already-normalized name has 1..80 code points. */
export function isValidOrgName(name: string): boolean {
  const len = Array.from(name).length;
  return len >= 1 && len <= MAX_ORG_NAME;
}

export const isValidEnrollTtlHours = (h: unknown): h is number =>
  typeof h === 'number' && Number.isInteger(h) && h >= ENROLL_TTL_MIN_HOURS && h <= ENROLL_TTL_MAX_HOURS;

export { isIdentityHex, isUuidV4 };

// --- Statement builders ----------------------------------------------------------

/** Bytes hashed (SHA-256) to produce an enrollment link's stored code hash. */
export function enrollLinkInput(orgId: string, code: Uint8Array): Uint8Array {
  return enc(ORG_DOMAIN.enrollLink, orgId, code);
}

/** Message authenticated with HMAC-SHA256 under the enrollment link secret. */
export function enrollJoinInput(
  orgId: string,
  identityHex: string,
  displayName: string,
  signPub: Uint8Array,
  ecdhPub: Uint8Array,
  sealedContactHash: Uint8Array,
): Uint8Array {
  return enc(ORG_DOMAIN.join, orgId, identityHex, displayName, signPub, ecdhPub, sealedContactHash);
}

/** Statement the org admin signs to certify one roster member. */
export function enrollStatement(
  orgId: string,
  identityHex: string,
  displayName: string,
  signPub: Uint8Array,
  ecdhPub: Uint8Array,
  sealedContactHash: Uint8Array,
): Uint8Array {
  return enc(ORG_DOMAIN.enroll, orgId, identityHex, displayName, signPub, ecdhPub, sealedContactHash);
}

/** Statement the org admin signs to revoke a roster member. */
export function orgRevokeStatement(orgId: string, orgMemberId: number | bigint, identityHex: string, reason: string): Uint8Array {
  return enc(ORG_DOMAIN.revoke, orgId, orgMemberId, identityHex, reason);
}

/** AES-GCM additional data (and HKDF info) for a sealed phone number. */
export function contactAad(orgId: string, identityHex: string): Uint8Array {
  return enc(ORG_DOMAIN.contact, orgId, identityHex);
}

/** HKDF salt for a sealed phone number. */
export function contactSalt(orgId: string): Uint8Array {
  return enc(ORG_DOMAIN.contactSalt, orgId);
}

/** Orders ids ascending and rejects duplicates, so one set of people has one statement. */
export function sortedUniqueIds(ids: readonly (number | bigint)[]): bigint[] {
  const sorted = ids.map((i) => BigInt(i)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) throw new RangeError('duplicate orgMemberId');
  return sorted;
}

export interface PageTargetRef {
  orgMemberId: number | bigint;
  /** Lowercase hex identity of that roster member. */
  identityHex: string;
}

/** Orders targets by id and rejects duplicate ids or identities. */
export function sortedUniqueTargets(targets: readonly PageTargetRef[]): { orgMemberId: bigint; identityHex: string }[] {
  const sorted = targets
    .map((t) => ({ orgMemberId: BigInt(t.orgMemberId), identityHex: t.identityHex }))
    .sort((a, b) => (a.orgMemberId < b.orgMemberId ? -1 : a.orgMemberId > b.orgMemberId ? 1 : 0));
  const ids = new Set<string>();
  for (const t of sorted) {
    if (ids.has(`i:${t.orgMemberId}`) || ids.has(`h:${t.identityHex}`)) throw new RangeError('duplicate target');
    ids.add(`i:${t.orgMemberId}`);
    ids.add(`h:${t.identityHex}`);
  }
  return sorted;
}

/** Statement the commander signs to request a page. Binds each id to its person's identity. */
export function pageStatement(
  orgId: string,
  incidentId: string,
  pageId: string,
  sentAtMs: number,
  targets: readonly PageTargetRef[],
): Uint8Array {
  const sorted = sortedUniqueTargets(targets);
  return enc(ORG_DOMAIN.page, orgId, incidentId, pageId, sentAtMs, sorted.length, ...sorted.flatMap((t) => [t.orgMemberId, t.identityHex]));
}

/** Bytes hashed (SHA-256) to produce a member's org safety code. */
export function orgSafetyInput(orgId: string, identityHex: string, signPub: Uint8Array, ecdhPub: Uint8Array): Uint8Array {
  return enc(ORG_DOMAIN.safety, orgId, identityHex, signPub, ecdhPub);
}
