// Milestone M2: a real phone rings. Only runs when PW_PAGER_LIVE=1, so `npm run test:live` never rings a phone.
//
//   PW_PAGER_LIVE=1 PUBLIC_BASE_URL=https://<production domain> npm run test:live -- live/page.live.ts
//
// The org admin signing key is kept stable across runs in live/.org-admin.local.json (gitignored, never
// committed). Its public key is printed once so it can be added to ORG_ADMIN_SIGN_PUB in Vercel.
//
// The roster steps (create org, enroll, approve, add from roster, request_page, watch my_pages) need the
// WP1 module bindings and the WP2 client. They are wired in `setupRoster` below once those are merged.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { b64urlEncode } from '@/lib/crypto/b64url';
import { bytesToHex } from '@/spacetimedb/src/shared/encoding';
import { sealContact, signEnrollment, signPageRequest } from '@/lib/crypto/org';
import { MAX_PAGE_BODY_BYTES, type PageRequestWire } from '@/lib/protocol/org';

const LIVE = process.env.PW_PAGER_LIVE === '1';
const KEY_FILE = new URL('./.org-admin.local.json', import.meta.url);

export interface AdminKey {
  priv: CryptoKey;
  pub: Uint8Array;
}

/** Loads or creates the stable admin signing key. Prints the public key the first time it is created. */
export async function loadAdminKey(): Promise<AdminKey> {
  if (existsSync(KEY_FILE)) {
    const jwk = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { priv: JsonWebKey; pub: string };
    const priv = await crypto.subtle.importKey('jwk', jwk.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const raw = Uint8Array.from(Buffer.from(jwk.pub, 'base64url'));
    return { priv, pub: raw };
  }
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  writeFileSync(KEY_FILE, JSON.stringify({ priv: jwk, pub: b64urlEncode(pub) }), { mode: 0o600 });
  console.log(`New live-test admin key. Add this to ORG_ADMIN_SIGN_PUB in Vercel (comma-separated):\n${b64urlEncode(pub)}`);
  return { priv: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']), pub };
}

export interface RosterPerson {
  orgMemberId: string;
  identityHex: string;
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  sealedContact: Uint8Array;
}

/** Builds the signed POST /api/page body for a commander and targets that the module already holds. */
export async function buildPageBody(args: {
  orgId: string;
  incidentId: string;
  pageId: string;
  admin: AdminKey;
  commander: RosterPerson & { signPriv: CryptoKey };
  targets: RosterPerson[];
  enrollSigs: Map<string, Uint8Array>;
}): Promise<PageRequestWire> {
  const sentAt = Date.now();
  const rec = async (p: RosterPerson) => ({
    identity: p.identityHex,
    displayName: p.displayName,
    signPub: b64urlEncode(p.signPub),
    ecdhPub: b64urlEncode(p.ecdhPub),
    sealedContact: b64urlEncode(p.sealedContact),
    enrollSig: b64urlEncode(
      args.enrollSigs.get(p.identityHex) ??
        (await signEnrollment(args.admin.priv, { orgId: args.orgId, identityHex: p.identityHex, displayName: p.displayName, signPub: p.signPub, ecdhPub: p.ecdhPub, sealedContact: p.sealedContact })),
    ),
  });
  const sig = await signPageRequest(args.commander.signPriv, {
    orgId: args.orgId,
    incidentId: args.incidentId,
    pageId: args.pageId,
    sentAtMs: sentAt,
    targets: args.targets.map((t) => ({ orgMemberId: BigInt(t.orgMemberId), identityHex: t.identityHex })),
  });
  const body: PageRequestWire = {
    orgId: args.orgId,
    incidentId: args.incidentId,
    pageId: args.pageId,
    sentAt,
    adminSignPub: b64urlEncode(args.admin.pub),
    commander: await rec(args.commander),
    targets: await Promise.all(args.targets.map(async (t) => ({ ...(await rec(t)), orgMemberId: t.orgMemberId }))),
    commanderSig: b64urlEncode(sig),
  };
  expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(MAX_PAGE_BODY_BYTES);
  return body;
}

describe.skipIf(!LIVE)('M2: a real phone rings (PW_PAGER_LIVE=1)', () => {
  it('needs the PUBLIC_BASE_URL and phone number', () => {
    expect(process.env.PUBLIC_BASE_URL, 'set PUBLIC_BASE_URL to the production domain').toMatch(/^https:\/\//);
    expect(process.env.PW_PAGER_PHONE, 'set PW_PAGER_PHONE to your E.164 number').toMatch(/^\+[1-9][0-9]{7,14}$/);
    void sealContact;
    void bytesToHex;
  });

  it('pages the real phone and watches calling, ringing, acknowledged', async () => {
    await loadAdminKey();
    throw new Error('Wire setupRoster to the WP1 bindings and WP2 client once they are merged, then POST buildPageBody to /api/page and watch my_pages.');
  });
});
