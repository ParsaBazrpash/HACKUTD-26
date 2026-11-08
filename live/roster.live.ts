// Milestone M1: org roster on Maincloud with real crypto (WP2).
//
//   npm run test:live -- live/roster.live.ts
//
// Three headless clients (fake-indexeddb, a fake passkey with a test PRF secret) talk to the real
// Maincloud database. The admin creates an org, two people enroll, the admin approves, the commander
// adds both from the roster, both open the incident and see integrity checked. Then the database
// owner swaps one roster key with `spacetime sql` and the commander's client refuses to add that
// person. /api/page is stubbed here; the real call is WP3's milestone M2.
//
// The org name carries a timestamp so reruns never collide. Needs the Spacetime CLI, logged in as the
// database owner, for the key-swap step.

import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { IncidentStore, OrgStore, useStoreForTests as makeTestStore } from '@/lib/crypto/store';
import { DeviceVault, type WebAuthnPort } from '@/lib/client/passkey-lock';
import { RealIncidentClient } from '@/lib/client/real';
import { SpacetimeBackend, type TokenStore } from '@/lib/client/spacetime-backend';
import { bytesToHex } from '@/spacetimedb/src/shared/encoding';

const HOST = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'wss://maincloud.spacetimedb.com';
const DB = process.env.NEXT_PUBLIC_SPACETIME_DB_NAME || process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'zerohour-hackutd26';
const SERVER = process.env.SPACETIME_SERVER || 'maincloud';
const hasCli = spawnSync('spacetime', ['--version'], { encoding: 'utf8' }).status === 0;

const step = (msg: string) => console.log(`[M1] ${msg}`);

const memoryTokens = (): TokenStore => {
  let t: string | undefined;
  return { read: () => t, write: (v) => void (t = v) };
};

/** A fake authenticator: PRF = HMAC(secret, salt), like CTAP2 hmac-secret with an injected test secret. */
function authenticator(): WebAuthnPort {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return {
    supported: async () => true,
    create: async (salt) => ({ credentialId: new Uint8Array([9, 9, 9]), prf: hmac(sha256, secret, salt), prfEnabled: true }),
    get: async (_id, salt) => hmac(sha256, secret, salt),
  };
}

async function pagerPub(): Promise<Uint8Array> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  return new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
}

const until = async (pred: () => boolean, what: string, ms = 30000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

async function browser(name: string, pager: Uint8Array, posts: string[]) {
  const db = makeTestStore(`roster-${name}-${crypto.randomUUID()}`);
  const backend = new SpacetimeBackend(HOST, DB, memoryTokens());
  const vault = new DeviceVault({ store: db, webauthn: authenticator() });
  await vault.enable();
  const client = new RealIncidentClient(backend, {
    origin: 'https://zerohour.live',
    storeFor: (id) => new IncidentStore(id, db),
    keyStore: db,
    waitMs: 10000,
    vault,
    pagerPub: pager,
    postPage: async (body) => {
      posts.push(body);
      return { ok: true };
    },
  });
  await until(() => backend.connection() === 'ready' && backend.identityHex() !== null, `${name} connected`);
  return { name, db, backend, client, vault };
}

describe.skipIf(!hasCli)('Maincloud org roster (M1)', () => {
  it('create org, enroll, approve, add from roster, open incident, refuse a swapped roster key', async () => {
    const pager = await pagerPub();
    const posts: string[] = [];
    const [admin, jordan, sam] = await Promise.all([browser('admin', pager, posts), browser('jordan', pager, posts), browser('sam', pager, posts)]);

    const { orgId } = await admin.client.createOrg({ name: `M1 ${new Date().toISOString()}`, displayName: 'Casey', phone: '+15550100001' });
    step(`admin created org ${orgId}`);

    const enrolled: bigint[] = [];
    for (const [b, name, phone] of [[jordan, 'Jordan', '+15550100002'], [sam, 'Sam', '+15550100003']] as const) {
      const { url } = await admin.client.createEnrollLink({ ttlHours: 1 });
      const { safetyCode } = await b.client.enroll({ fragment: url.slice(url.indexOf('#') + 1), displayName: name, phone });
      await until(() => admin.client.getState().roster.some((r) => r.displayName === name && r.state === 'pending'), `${name} pending`);
      const pending = admin.client.getState().roster.find((r) => r.displayName === name)!;
      expect(pending.safetyCode).toBe(safetyCode);
      step(`${name} enrolled, safety code ${safetyCode} matches`);
      await admin.client.approveMember(pending.orgMemberId);
      await until(() => b.client.getState().org !== null, `${name} sees the org`);
      step(`${name} approved and sees the verified roster`);
      enrolled.push(pending.orgMemberId);
    }
    expect(Object.keys(await new OrgStore(orgId, jordan.db).getRoster()).length).toBe(3);

    const { incidentId } = await admin.client.createIncident({ title: `M1 roster ${new Date().toISOString()}`, displayName: 'Casey' });
    step(`commander opened incident ${incidentId}`);
    await admin.client.addFromRoster([
      { orgMemberId: enrolled[0], role: 'counsel' },
      { orgMemberId: enrolled[1], role: 'technical' },
    ]);
    step('commander added both from the roster in one call');
    for (const b of [jordan, sam]) {
      await b.client.openIncident(incidentId);
      await until(() => b.client.getState().me?.state === 'active' && b.client.getState().integrity.ok, `${b.name} integrity checked`);
      expect((await b.client.verifyAll()).ok).toBe(true);
      step(`${b.name} opened the incident, integrity checked`);
    }

    await admin.client.page([enrolled[0]]);
    expect(posts).toHaveLength(1);
    step('page request signed and posted to the stubbed /api/page');

    // The operator swaps one roster key with owner SQL.
    const victim = admin.backend.org.rows().roster.find((r) => r.orgMemberId === enrolled[1])!;
    const evil = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const evilPub = new Uint8Array(await crypto.subtle.exportKey('raw', evil.publicKey));
    const sql = `UPDATE org_member SET sign_pub = 0x${bytesToHex(evilPub)} WHERE id = ${victim.orgMemberId}`;
    const r = spawnSync('spacetime', ['sql', '--server', SERVER, DB, sql], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`spacetime sql failed: ${r.stderr || r.stdout}`);
    await until(() => admin.client.getState().roster.find((m) => m.orgMemberId === enrolled[1])?.keyChanged === true, 'key change noticed');
    step('operator swapped Sam\'s roster key; the commander client flags it');

    await expect(admin.client.addFromRoster([{ orgMemberId: enrolled[1], role: 'executive' }])).rejects.toThrow();
    step('commander client refuses to add the person with the swapped key');
  });
});
