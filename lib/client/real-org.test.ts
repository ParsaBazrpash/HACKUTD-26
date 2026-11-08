/* eslint-disable @typescript-eslint/no-explicit-any -- test plumbing over the harness's untyped rows and reducer calls */
// Org roster, enrollment, roster admission and paging in the real client:
// real crypto, the real module on the test harness, one IndexedDB and one
// fake passkey per browser.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { del as idbDel, entries as idbEntries, keys as idbKeys, type UseStore } from 'idb-keyval';
import { HarnessBackend, HarnessHub } from '@/tests/support/harness-backend';
import * as mod from '@/spacetimedb/src/index';
import type { OrgBackend, OrgMemberRow } from './backend';
import { b64urlDecode } from '@/lib/crypto/b64url';
import { openContact, verifyEnrollment, verifyPageRequest } from '@/lib/crypto/org';
import { IncidentStore, OrgStore, orgIdsOnDevice, useStoreForTests as makeTestStore } from '@/lib/crypto/store';
import { isLockedDeviceKeys } from '@/lib/crypto/vault';
import { parsePageRequestBody } from '@/lib/protocol/org';
import { SEALED_CONTACT_LEN } from '@/spacetimedb/src/shared/org';
import { DeviceVault, type WebAuthnPort } from './passkey-lock';
import { ORG_LOCKED_MESSAGE, RealIncidentClient } from './real';

const micros = (t: { microsSinceUnixEpoch: bigint }) => t.microsSinceUnixEpoch;

/** Adds the org views and reducers of the module to a harness backend (test plumbing only). */
function withOrg(b: HarnessBackend): HarnessBackend & { org: OrgBackend } {
  const any = b as any;
  const call = (r: unknown, a: object): Promise<void> => any.call(r, a);
  const view = (v: unknown): any[] => any.view(v);
  const row = (m: any): OrgMemberRow => ({
    orgMemberId: m.id,
    orgId: m.orgId,
    identityHex: m.identity.toHexString(),
    displayName: m.displayName,
    signPub: m.signPub,
    ecdhPub: m.ecdhPub,
    joinTag: m.joinTag,
    sealedContact: m.sealedContact,
    state: m.state,
    enrollSig: m.enrollSig,
    revokeSig: m.revokeSig,
    enrolledAtMicros: micros(m.enrolledAt),
    approvedAtMicros: m.approvedAt ? micros(m.approvedAt) : undefined,
    revokedAtMicros: m.revokedAt ? micros(m.revokedAt) : undefined,
  });
  const org: OrgBackend = {
    rows: () => ({
      orgs: view(mod.my_org).map((o) => ({
        id: o.id,
        name: o.name,
        adminHex: o.admin.toHexString(),
        adminSignPub: o.adminSignPub,
        adminEcdhPub: o.adminEcdhPub,
        createdAtMicros: micros(o.createdAt),
      })),
      roster: view(mod.my_roster).map(row),
      own: view(mod.my_org_status).map(row),
      pages: view(mod.my_pages).map((p) => ({
        pageId: p.pageId,
        incidentId: p.incidentId,
        orgMemberId: p.orgMemberId,
        status: p.status,
        carrierReported: p.carrierReported,
        requestedByHex: p.requestedBy.toHexString(),
        createdAtMicros: micros(p.createdAt),
        updatedAtMicros: micros(p.updatedAt),
      })),
    }),
    createOrg: (a) => call(mod.create_org, a),
    createEnrollLink: (a) => call(mod.create_enroll_link, a),
    enrollMember: (a) => call(mod.enroll_member, a),
    approveMember: (a) => call(mod.approve_member, a),
    revokeOrgMember: (a) => call(mod.revoke_org_member, a),
    linkIncidentOrg: (a) => call(mod.link_incident_org, a),
    addFromRoster: (a) => call(mod.add_from_roster, a),
    requestPage: (a) => call(mod.request_page, a),
  };
  return Object.assign(b, { org });
}

let n = 0;
const clients: RealIncidentClient[] = [];

function authenticator(): WebAuthnPort {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  return {
    supported: async () => true,
    create: async (salt) => ({ credentialId: new Uint8Array([1, 2, 3]), prf: hmac(sha256, secret, salt), prfEnabled: true }),
    get: async (_id, salt) => hmac(sha256, secret, salt),
  };
}

interface Pager {
  pub: Uint8Array;
  priv: CryptoKey;
}
async function newPager(): Promise<Pager> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])) as CryptoKeyPair;
  return { pub: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), priv: pair.privateKey };
}

function profile(hub: HarnessHub, name: string, pager: Pager, opts: { passkey?: boolean; posts?: string[] } = {}) {
  const db: UseStore = makeTestStore(`${name}-org-${++n}`);
  const backend = withOrg(hub.backend(name));
  const vault = new DeviceVault({ store: db, webauthn: authenticator() });
  const client = new RealIncidentClient(backend, {
    origin: 'https://zerohour.test',
    storeFor: (id) => new IncidentStore(id, db),
    keyStore: db,
    now: () => Number(hub.h.clock.now().microsSinceUnixEpoch / 1000n),
    waitMs: 200,
    vault,
    pagerPub: pager.pub,
    postPage: async (body) => {
      opts.posts?.push(body);
      return { ok: true };
    },
  });
  clients.push(client);
  return { name, db, backend, vault, client, ready: opts.passkey === false ? Promise.resolve() : vault.enable() };
}
type P = ReturnType<typeof profile>;

async function settle() {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(clients.map((c) => c.whenIdle()));
  }
}

const fragmentOf = (url: string) => url.slice(url.indexOf('#') + 1);
const PHONES: Record<string, string> = { Casey: '+15550100001', Jordan: '+15550100002', Sam: '+15550100003' };

async function startOrg(hub: HarnessHub, pager: Pager, posts: string[] = []) {
  const admin = profile(hub, 'admin', pager, { posts });
  await admin.ready;
  const { orgId } = await admin.client.createOrg({ name: 'Lakeside Clinic', displayName: 'Casey', phone: PHONES.Casey });
  await settle();
  return { admin, orgId };
}

async function enrollPerson(hub: HarnessHub, pager: Pager, admin: P, name: string, approve = true) {
  const p = profile(hub, name.toLowerCase(), pager);
  await p.ready;
  const { url } = await admin.client.createEnrollLink({ ttlHours: 2 });
  const { safetyCode } = await p.client.enroll({ fragment: fragmentOf(url), displayName: name, phone: PHONES[name] });
  await settle();
  const pending = admin.client.getState().roster.find((r) => r.displayName === name)!;
  expect(pending.state).toBe('pending');
  expect(pending.safetyCode).toBe(safetyCode);
  if (approve) {
    await admin.client.approveMember(pending.orgMemberId);
    await settle();
  }
  return p;
}

const rosterId = (c: RealIncidentClient, name: string) => c.getState().roster.find((r) => r.displayName === name)!.orgMemberId;

describe('org creation and enrollment', () => {
  it('creates an org, enrolls two people, approves them, and everyone sees the verified roster', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin, orgId } = await startOrg(hub, pager);
    const jordan = await enrollPerson(hub, pager, admin, 'Jordan');
    const sam = await enrollPerson(hub, pager, admin, 'Sam');

    const a = admin.client.getState();
    expect(a.org).toMatchObject({ orgId, name: 'Lakeside Clinic', myRole: 'admin' });
    expect(a.roster.map((r) => [r.displayName, r.state, r.keyChanged])).toEqual([
      ['Casey', 'active', false],
      ['Jordan', 'active', false],
      ['Sam', 'active', false],
    ]);
    for (const p of [jordan, sam]) {
      const s = p.client.getState();
      expect(s.org).toMatchObject({ orgId, myRole: 'member', adminFingerprint: a.org!.adminFingerprint });
      expect(s.roster).toHaveLength(3);
      // The roster is cached for peacetime: every certified key is in IndexedDB.
      expect(Object.keys(await new OrgStore(orgId, p.db).getRoster())).toHaveLength(3);
    }
  });

  it('org keys exist only wrapped by the vault: no plain keys, and the phone never appears in clear anywhere', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin, orgId } = await startOrg(hub, pager);
    const jordan = await enrollPerson(hub, pager, admin, 'Jordan');

    const rec = await new OrgStore(orgId, jordan.db).getLockedKeys();
    expect(isLockedDeviceKeys(rec)).toBe(true);
    // Everything in the browser store and every row the server shows: no number, no 109-byte contact in clear.
    const dump = JSON.stringify(
      [...(await idbEntries(jordan.db)), ...Object.values(admin.backend.org.rows()).flat()],
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v),
    );
    for (const phone of Object.values(PHONES)) expect(dump).not.toContain(phone);
    const row = admin.backend.org.rows().roster.find((r) => r.displayName === 'Jordan')!;
    expect(row.sealedContact.length).toBe(SEALED_CONTACT_LEN);
    expect(SEALED_CONTACT_LEN).toBe(109);
    // Only the pager can open it.
    expect(await openContact(pager.priv, orgId, row.identityHex, row.sealedContact)).toBe(PHONES.Jordan);
  });

  it('refuses createOrg and enroll without a passkey lock, and with the lock locked, before sending anything', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const nope = profile(hub, 'nopasskey', pager, { passkey: false });
    await expect(nope.client.createOrg({ name: 'X', displayName: 'Casey', phone: PHONES.Casey })).rejects.toThrow(/passkey/i);
    expect(await orgIdsOnDevice(nope.db)).toEqual([]);

    const { admin } = await startOrg(hub, pager);
    const { url } = await admin.client.createEnrollLink({ ttlHours: 1 });
    const locked = profile(hub, 'locked', pager);
    await locked.ready;
    locked.vault.lock();
    await expect(locked.client.enroll({ fragment: fragmentOf(url), displayName: 'Jordan', phone: PHONES.Jordan })).rejects.toThrow(/unlock/i);
    expect(await orgIdsOnDevice(locked.db)).toEqual([]);
    expect(admin.client.getState().roster).toHaveLength(1);
  });

  it('rejects a malformed phone number and a bad link before generating keys', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin } = await startOrg(hub, pager);
    const p = profile(hub, 'x', pager);
    await p.ready;
    const { url } = await admin.client.createEnrollLink({ ttlHours: 1 });
    await expect(p.client.enroll({ fragment: fragmentOf(url), displayName: 'Jordan', phone: '555-0100' })).rejects.toThrow(/international/);
    await expect(p.client.enroll({ fragment: 'e=nope', displayName: 'Jordan', phone: PHONES.Jordan })).rejects.toThrow(/not valid/);
    expect(await orgIdsOnDevice(p.db)).toEqual([]);
  });

  it('a used link cannot enroll a second person and leaves no keys behind', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin } = await startOrg(hub, pager);
    const { url } = await admin.client.createEnrollLink({ ttlHours: 1 });
    const first = profile(hub, 'first', pager);
    await first.ready;
    await first.client.enroll({ fragment: fragmentOf(url), displayName: 'Jordan', phone: PHONES.Jordan });
    const second = profile(hub, 'second', pager);
    await second.ready;
    await expect(second.client.enroll({ fragment: fragmentOf(url), displayName: 'Sam', phone: PHONES.Sam })).rejects.toThrow(/could not be used/);
    expect(await orgIdsOnDevice(second.db)).toEqual([]);
  });

  it('refuses to approve a request that no link of this admin proves', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin, orgId } = await startOrg(hub, pager);
    const { url } = await admin.client.createEnrollLink({ ttlHours: 1 });
    const jordan = profile(hub, 'jordan', pager);
    await jordan.ready;
    await jordan.client.enroll({ fragment: fragmentOf(url), displayName: 'Jordan', phone: PHONES.Jordan });
    await settle();
    // The admin's device forgets the link secret (or the row came from somewhere else).
    for (const k of await idbKeys(admin.db)) if (typeof k === 'string' && k.startsWith(`org/${orgId}/link/`)) await idbDel(k, admin.db);
    await expect(admin.client.approveMember(rosterId(admin.client, 'Jordan'))).rejects.toThrow(/Unverified/);
    expect(admin.client.getState().roster.find((r) => r.displayName === 'Jordan')!.state).toBe('pending');
  });

  it('with the vault locked nothing signs: approve and revoke are refused', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin } = await startOrg(hub, pager);
    const jordan = await enrollPerson(hub, pager, admin, 'Jordan', false);
    void jordan;
    admin.vault.lock();
    await expect(admin.client.approveMember(rosterId(admin.client, 'Jordan'))).rejects.toThrow(ORG_LOCKED_MESSAGE);
    await expect(admin.client.revokeOrgMember(rosterId(admin.client, 'Jordan'), 'lost phone')).rejects.toThrow(ORG_LOCKED_MESSAGE);
    expect(admin.client.getState().roster.find((r) => r.displayName === 'Jordan')!.state).toBe('pending');
  });

  it('a non-admin cannot approve or create links', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin } = await startOrg(hub, pager);
    const jordan = await enrollPerson(hub, pager, admin, 'Jordan');
    await expect(jordan.client.createEnrollLink({ ttlHours: 1 })).rejects.toThrow(/admin/);
    await expect(jordan.client.approveMember(1n)).rejects.toThrow(/admin/);
  });

  it('revoking a person marks them revoked for everyone and wipes their org keys', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin, orgId } = await startOrg(hub, pager);
    const jordan = await enrollPerson(hub, pager, admin, 'Jordan');
    await admin.client.revokeOrgMember(rosterId(admin.client, 'Jordan'), 'lost phone');
    await settle();
    expect(admin.client.getState().roster.find((r) => r.displayName === 'Jordan')!.state).toBe('revoked');
    expect(jordan.client.getState().org).toBeNull();
    expect(await new OrgStore(orgId, jordan.db).getLockedKeys()).toBeUndefined();
  });
});

async function startIncident(hub: HarnessHub, pager: Pager, posts: string[] = []) {
  const { admin, orgId } = await startOrg(hub, pager, posts);
  const jordan = await enrollPerson(hub, pager, admin, 'Jordan');
  const sam = await enrollPerson(hub, pager, admin, 'Sam');
  const { incidentId } = await admin.client.createIncident({ title: 'Ransomware at Lakeside', displayName: 'Casey' });
  await settle();
  return { admin, jordan, sam, orgId, incidentId };
}

describe('roster admission and paging', () => {
  it('the commander adds both from the roster, both open the incident with integrity checked, and a page works end to end', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const posts: string[] = [];
    const { admin, jordan, sam, orgId, incidentId } = await startIncident(hub, pager, posts);
    // The commander started the incident with org keys, not fresh ones.
    expect(await new IncidentStore(incidentId, admin.db).getDeviceRecord()).toBeUndefined();

    await admin.client.addFromRoster([
      { orgMemberId: rosterId(admin.client, 'Jordan'), role: 'counsel' },
      { orgMemberId: rosterId(admin.client, 'Sam'), role: 'technical' },
    ]);
    await settle();
    for (const p of [jordan, sam]) {
      await p.client.openIncident(incidentId);
      await settle();
      const s = p.client.getState();
      expect(s.me).toMatchObject({ state: 'active', verified: true });
      expect(s.integrity.ok).toBe(true);
      expect(s.incident).toMatchObject({ id: incidentId, title: 'Ransomware at Lakeside' });
      // Their incident keys are their org keys: nothing stored per incident.
      expect(await new IncidentStore(incidentId, p.db).getDeviceRecord()).toBeUndefined();
    }
    expect(jordan.client.getState().channels.map((c) => c.kind).sort()).toEqual(['command', 'privileged', 'technical']);
    expect(sam.client.getState().channels.map((c) => c.kind).sort()).toEqual(['command', 'technical']);
    expect(admin.client.getState().members.filter((m) => m.state === 'active')).toHaveLength(3);

    const { pageId } = await admin.client.page([rosterId(admin.client, 'Jordan'), rosterId(admin.client, 'Sam')]);
    await settle();
    expect(posts).toHaveLength(1);
    const body = parsePageRequestBody(posts[0])!;
    expect(body).not.toBeNull();
    expect(body.pageId).toBe(pageId);
    // The body verifies exactly like the pager does: admin certificates, then the commander signature over (id, identity) pairs.
    const adminPub = b64urlDecode(body.adminSignPub);
    for (const r of [body.commander, ...body.targets]) {
      expect(
        await verifyEnrollment(
          adminPub,
          {
            orgId,
            identityHex: r.identity,
            displayName: r.displayName,
            signPub: b64urlDecode(r.signPub),
            ecdhPub: b64urlDecode(r.ecdhPub),
            sealedContact: b64urlDecode(r.sealedContact),
          },
          b64urlDecode(r.enrollSig),
        ),
      ).toBe(true);
    }
    const fields = {
      orgId,
      incidentId,
      pageId,
      sentAtMs: body.sentAt,
      targets: body.targets.map((t) => ({ orgMemberId: BigInt(t.orgMemberId), identityHex: t.identity })),
    };
    expect(await verifyPageRequest(b64urlDecode(body.commander.signPub), fields, b64urlDecode(body.commanderSig))).toBe(true);
    // Tampering with a target's identity breaks the signature.
    const swapped = { ...fields, targets: [{ ...fields.targets[0], identityHex: fields.targets[1].identityHex }, fields.targets[1]] };
    expect(await verifyPageRequest(b64urlDecode(body.commander.signPub), swapped, b64urlDecode(body.commanderSig))).toBe(false);
    expect(posts[0]).not.toContain('+1555');

    // A signed timeline entry names who was paged.
    expect(admin.client.getState().timeline.map((t) => t.entry.text)).toContain('Paged Jordan (Counsel), Sam (Technical)');
    const pages = admin.client.getState().pages;
    expect(pages.map((p) => [p.displayName, p.role, p.status, p.joined])).toEqual([
      ['Jordan', 'counsel', 'requested', false],
      ['Sam', 'technical', 'requested', false],
    ]);

    // "Joined" turns true once the person authors a verified event.
    await jordan.client.announcePresence();
    await settle();
    expect(admin.client.getState().pages.find((p) => p.displayName === 'Jordan')!.joined).toBe(true);
    expect(admin.client.getState().pages.find((p) => p.displayName === 'Sam')!.joined).toBe(false);
    expect(admin.client.getState().channels.find((c) => c.kind === 'command')!.messages.map((m) => m.text)).toContain("I'm here");
  });

  it('paging again is the retry and uses a new page id; a second page inside 60 seconds is refused by the module', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const posts: string[] = [];
    const { admin, incidentId } = await startIncident(hub, pager, posts);
    void incidentId;
    await admin.client.addFromRoster([{ orgMemberId: rosterId(admin.client, 'Jordan'), role: 'counsel' }]);
    await settle();
    const first = await admin.client.page([rosterId(admin.client, 'Jordan')]);
    await expect(admin.client.page([rosterId(admin.client, 'Jordan')])).rejects.toThrow(/wait a minute/);
    hub.advanceMinutes(2);
    const second = await admin.client.page([rosterId(admin.client, 'Jordan')]);
    expect(second.pageId).not.toBe(first.pageId);
    expect(posts).toHaveLength(2);
  });

  it('refuses to page someone who was not added from the roster', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const posts: string[] = [];
    const { admin } = await startIncident(hub, pager, posts);
    await expect(admin.client.page([rosterId(admin.client, 'Jordan')])).rejects.toThrow(/not been added/);
    expect(posts).toHaveLength(0);
  });

  it('a swapped roster key is refused before any admission is signed, and nobody is added', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin, jordan, incidentId } = await startIncident(hub, pager);
    const evil = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const evilPub = new Uint8Array(await crypto.subtle.exportKey('raw', (evil as CryptoKeyPair).publicKey));
    // The operator swaps Jordan's signing key in the database.
    const row = admin.backend.org.rows().roster.find((r) => r.displayName === 'Jordan')!;
    (hub.h as any).withReducerTx((admin.backend as any).auth, (ctx: any) => {
      const cur = ctx.db.org_member.id.find(row.orgMemberId);
      ctx.db.org_member.id.update({ ...cur, signPub: evilPub });
    });
    hub.notify();
    await settle();
    const shown = admin.client.getState().roster.find((r) => r.displayName === 'Jordan')!;
    expect(shown.keyChanged).toBe(true);
    const before = admin.backend.rows().members.length;
    await expect(admin.client.addFromRoster([{ orgMemberId: row.orgMemberId, role: 'counsel' }])).rejects.toThrow(/certificate|keys changed/);
    expect(admin.backend.rows().members.length).toBe(before);
    await expect(jordan.client.openIncident(incidentId)).resolves.toBeUndefined();
  });

  it('a forged enrollment certificate (valid shape, wrong signer) is refused', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin } = await startIncident(hub, pager);
    const row = admin.backend.org.rows().roster.find((r) => r.displayName === 'Sam')!;
    const forged = row.enrollSig.slice();
    forged[5] ^= 1;
    (hub.h as any).withReducerTx((admin.backend as any).auth, (ctx: any) => {
      const cur = ctx.db.org_member.id.find(row.orgMemberId);
      ctx.db.org_member.id.update({ ...cur, enrollSig: forged });
    });
    hub.notify();
    await settle();
    await expect(admin.client.addFromRoster([{ orgMemberId: row.orgMemberId, role: 'technical' }])).rejects.toThrow(/certificate|keys changed/);
    expect(admin.client.getState().roster.find((r) => r.displayName === 'Sam')!.keyChanged).toBe(true);
  });

  it('refuses a person already in the incident, and a pick that is not on the roster', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin } = await startIncident(hub, pager);
    await admin.client.addFromRoster([{ orgMemberId: rosterId(admin.client, 'Jordan'), role: 'counsel' }]);
    await settle();
    await expect(admin.client.addFromRoster([{ orgMemberId: rosterId(admin.client, 'Jordan'), role: 'counsel' }])).rejects.toThrow(/already/);
    await expect(admin.client.addFromRoster([{ orgMemberId: 999n, role: 'counsel' }])).rejects.toThrow(/roster/);
    await expect(admin.client.addFromRoster([{ orgMemberId: rosterId(admin.client, 'Sam'), role: 'commander' as any }])).rejects.toThrow(/counsel/);
  });

  it('a roster member whose org keys are locked cannot open the incident until unlocked', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin, jordan, incidentId } = await startIncident(hub, pager);
    await admin.client.addFromRoster([{ orgMemberId: rosterId(admin.client, 'Jordan'), role: 'counsel' }]);
    await settle();
    jordan.vault.lock();
    await jordan.client.openIncident(incidentId);
    await settle();
    expect(jordan.client.getState().connection).toBe('error');
    expect(jordan.client.getState().channels).toEqual([]);
    await jordan.vault.unlock();
    await settle();
    expect(jordan.client.getState().me).toMatchObject({ state: 'active' });
    expect(jordan.client.getState().integrity.ok).toBe(true);
  });

  it('an incident started without org keys cannot use the roster', async () => {
    const hub = new HarnessHub();
    const pager = await newPager();
    const { admin } = await startOrg(hub, pager);
    await enrollPerson(hub, pager, admin, 'Jordan');
    const plain = profile(hub, 'plain', pager, { passkey: false });
    await plain.client.createIncident({ title: 'Plain', displayName: 'Pat' });
    await expect(plain.client.addFromRoster([{ orgMemberId: 1n, role: 'counsel' }])).rejects.toThrow();
  });
});
