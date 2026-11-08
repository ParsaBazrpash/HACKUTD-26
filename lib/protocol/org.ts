// Org roster and paging wire formats (WP0). Client and pager only.
//
// Zod schemas, the enrollment link fragment, and canonical statement builders.
// Every hashed, signed, HMACed or AAD input uses `enc()` with a `zh1/org/...`
// domain tag. The module-side copy lives in spacetimedb/src/shared/org.ts and
// a test checks both produce identical bytes.

import { z } from 'zod';
import { b64urlDecode, b64urlEncode } from '@/lib/crypto/b64url';
import { enc } from '@/spacetimedb/src/shared/encoding';
import { HASH_LEN, MAX_DISPLAY_NAME, PUBKEY_LEN, SIG_LEN } from '@/spacetimedb/src/shared/limits';
import {
  ENROLL_LINK_CODE_LEN,
  ENROLL_LINK_SECRET_LEN,
  MAX_ORG_REASON,
  MAX_PAGE_BODY_BYTES,
  MAX_PAGE_TARGETS,
  ORG_DOMAIN,
  SEALED_CONTACT_MAX,
  SEALED_CONTACT_MIN,
  isE164,
  isIdentityHex,
  isUuidV4,
  isValidEnrollTtlHours,
  isValidOrgName,
  normalizeOrgName,
  sortedUniqueIds,
} from '@/spacetimedb/src/shared/org';

export {
  ENROLL_LINK_CODE_LEN,
  ENROLL_LINK_SECRET_LEN,
  MAX_PAGE_BODY_BYTES,
  MAX_PAGE_TARGETS,
  isE164,
  isValidEnrollTtlHours,
  isValidOrgName,
  normalizeOrgName,
};

// --- Statement builders (client side) --------------------------------------------

export const enrollLinkInput = (orgId: string, code: Uint8Array): Uint8Array => enc(ORG_DOMAIN.enrollLink, orgId, code);

export const enrollJoinInput = (
  orgId: string,
  identityHex: string,
  displayName: string,
  signPub: Uint8Array,
  ecdhPub: Uint8Array,
  sealedContactHash: Uint8Array,
): Uint8Array => enc(ORG_DOMAIN.join, orgId, identityHex, displayName, signPub, ecdhPub, sealedContactHash);

export const enrollStatement = (
  orgId: string,
  identityHex: string,
  displayName: string,
  signPub: Uint8Array,
  ecdhPub: Uint8Array,
  sealedContactHash: Uint8Array,
): Uint8Array => enc(ORG_DOMAIN.enroll, orgId, identityHex, displayName, signPub, ecdhPub, sealedContactHash);

export const orgRevokeStatement = (orgId: string, orgMemberId: number | bigint, identityHex: string, reason: string): Uint8Array =>
  enc(ORG_DOMAIN.revoke, orgId, orgMemberId, identityHex, reason);

export const contactAad = (orgId: string, identityHex: string): Uint8Array => enc(ORG_DOMAIN.contact, orgId, identityHex);

export const contactSalt = (orgId: string): Uint8Array => enc(ORG_DOMAIN.contactSalt, orgId);

export function pageStatement(
  orgId: string,
  incidentId: string,
  pageId: string,
  sentAtMs: number,
  orgMemberIds: readonly (number | bigint)[],
): Uint8Array {
  const ids = sortedUniqueIds(orgMemberIds);
  return enc(ORG_DOMAIN.page, orgId, incidentId, pageId, sentAtMs, ids.length, ...ids);
}

export const orgSafetyInput = (orgId: string, identityHex: string, signPub: Uint8Array, ecdhPub: Uint8Array): Uint8Array =>
  enc(ORG_DOMAIN.safety, orgId, identityHex, signPub, ecdhPub);

// --- Enrollment link fragment -----------------------------------------------------

export interface EnrollFragment {
  orgId: string;
  /** 16 bytes. Only its hash is stored. */
  code: Uint8Array;
  /** 32 bytes for the HMAC join tag. Never sent anywhere. */
  secret: Uint8Array;
  /** Full 32-byte admin fingerprint to pin. */
  adminFingerprint: Uint8Array;
}

/** Builds `e=<orgId>.<code>.<secret>.<adminFingerprint>` (no leading `#`). */
export function buildEnrollFragment(f: EnrollFragment): string {
  return `e=${[f.orgId, b64urlEncode(f.code), b64urlEncode(f.secret), b64urlEncode(f.adminFingerprint)].join('.')}`;
}

export function buildEnrollUrl(origin: string, f: EnrollFragment): string {
  return `${origin.replace(/\/+$/, '')}/enroll#${buildEnrollFragment(f)}`;
}

/** Strict parser. Accepts a leading `#`. Returns null on any problem. */
export function parseEnrollFragment(fragment: string): EnrollFragment | null {
  try {
    const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
    if (raw.length === 0 || raw.length > 512 || !raw.startsWith('e=') || raw.includes('&')) return null;
    const parts = raw.slice(2).split('.');
    if (parts.length !== 4) return null;
    const [orgId, c, s, f] = parts;
    if (!isUuidV4(orgId)) return null;
    const code = b64urlDecode(c);
    const secret = b64urlDecode(s);
    const fp = b64urlDecode(f);
    if (code.length !== ENROLL_LINK_CODE_LEN || secret.length !== ENROLL_LINK_SECRET_LEN || fp.length !== HASH_LEN) return null;
    return { orgId, code, secret, adminFingerprint: fp };
  } catch {
    return null;
  }
}

// --- Zod schemas -------------------------------------------------------------------

const b64Bytes = (min: number, max: number) =>
  z
    .string()
    .max(Math.ceil((max * 4) / 3) + 2)
    .refine((s) => {
      try {
        const n = b64urlDecode(s).length;
        return n >= min && n <= max;
      } catch {
        return false;
      }
    }, 'invalid base64url bytes');

const uuid = z.string().refine(isUuidV4, 'invalid uuid');
const identityHex = z.string().refine(isIdentityHex, 'invalid identity');
const displayName = z.string().min(1).max(MAX_DISPLAY_NAME * 4);
const pub = b64Bytes(PUBKEY_LEN, PUBKEY_LEN);
const decimalId = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);

export const orgNameSchema = z
  .string()
  .transform(normalizeOrgName)
  .refine(isValidOrgName, 'org name must be 1 to 80 characters');
export const e164Schema = z.string().refine(isE164, 'phone must be E.164');
export const enrollTtlHoursSchema = z.number().refine(isValidEnrollTtlHours, 'ttl must be 1 to 24 hours');
export const orgRevokeReasonSchema = z.string().min(1).max(MAX_ORG_REASON);

export const rosterRecordSchema = z
  .object({
    identity: identityHex,
    displayName,
    signPub: pub,
    ecdhPub: pub,
    sealedContact: b64Bytes(SEALED_CONTACT_MIN, SEALED_CONTACT_MAX),
    enrollSig: b64Bytes(SIG_LEN, SIG_LEN),
  })
  .strict();
export type RosterRecordWire = z.infer<typeof rosterRecordSchema>;

export const pageTargetSchema = rosterRecordSchema.extend({ orgMemberId: decimalId }).strict();
export type PageTargetWire = z.infer<typeof pageTargetSchema>;

/** Body of POST /api/page. Bytes are base64url, bigint ids are decimal strings. */
export const pageRequestSchema = z
  .object({
    orgId: uuid,
    incidentId: uuid,
    pageId: uuid,
    sentAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** Admin signing key the records were certified under. The pager must compare it with a trusted pin. */
    adminSignPub: pub,
    commander: rosterRecordSchema,
    targets: z.array(pageTargetSchema).min(1).max(MAX_PAGE_TARGETS),
    commanderSig: b64Bytes(SIG_LEN, SIG_LEN),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const t of v.targets) {
      if (seen.has(t.orgMemberId) || seen.has(`i:${t.identity}`)) ctx.addIssue({ code: 'custom', message: 'duplicate target' });
      seen.add(t.orgMemberId);
      seen.add(`i:${t.identity}`);
    }
  });
export type PageRequestWire = z.infer<typeof pageRequestSchema>;

/**
 * Parses a raw /api/page body. Checks the byte size before JSON.parse, then
 * the schema. Returns null on any problem.
 */
export function parsePageRequestBody(raw: string): PageRequestWire | null {
  try {
    if (new TextEncoder().encode(raw).length > MAX_PAGE_BODY_BYTES) return null;
    const r = pageRequestSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
