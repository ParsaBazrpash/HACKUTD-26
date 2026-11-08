/* eslint-disable @typescript-eslint/no-explicit-any -- test plumbing over the harness's untyped reducer and view calls */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectionId, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CHANNELS, readableChannels, type Role } from './shared/policy';
import { admitStatement, revokeStatement } from './shared/encoding';
import { computeJoinTag, newInvite } from '@/lib/crypto/invite';
import { generateDeviceKeys, type DeviceKeys } from '@/lib/crypto/keys';
import { sign } from '@/lib/crypto/sign';
import { enrollLinkHash, sealContact, signEnrollment, signRevocation } from '@/lib/crypto/org';
import { ORG_LEAVE_REASON } from './shared/org';
import { sha256 } from '@noble/hashes/sha2.js';

// --- harness plumbing ------------------------------------------------------

// The pager identity is a constant inside index.ts. Tests run a copy of the module whose constant is the
// test pager's identity (the only difference), and one run of the real module to prove it refuses everyone
// to anyone but the real pager identity. The copy is written in beforeAll and removed in afterAll.
type ModuleShape = typeof import('./index');
let mod: ModuleShape; // patched copy: pager = authFor('pager')
let realMod: ModuleShape; // the real module
const COPY = new URL('./pager-test.gen.ts', import.meta.url);
beforeAll(async () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  realMod = (await import('./index')) as ModuleShape;
  const hex = createModuleTestHarness(realMod.default, realMod).withReducerTx(authFor('pager'), (ctx: any) => ctx.sender.toHexString() as string);
  const patched = src.replace(/const PAGER_IDENTITY_HEX = '[0-9a-f]*';/, `const PAGER_IDENTITY_HEX = '${hex}';`);
  if (patched === src) throw new Error('pager constant not found');
  writeFileSync(COPY, patched);
  mod = (await import('./pager-test.gen')) as ModuleShape;
});
afterAll(() => rmSync(COPY, { force: true }));

type Harness = ReturnType<typeof makeHarness>;
function makeHarness() {
  const h = createModuleTestHarness(mod.default, mod);
  h.clock.set(new Timestamp(1_800_000_000_000_000n));
  return h;
}
const authFor = (() => {
  const users = new Map<string, InstanceType<typeof TestAuth>>();
  return (name: string) => {
    let a = users.get(name);
    if (!a) {
      a = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'https://test', sub: name, aud: 'zerohour' }), ConnectionId.random());
      users.set(name, a);
    }
    return a;
  };
})();
const tx = <T,>(h: Harness, who: string, fn: (ctx: any) => T): T => h.withReducerTx(authFor(who), fn);
const call = (h: Harness, who: string, reducer: unknown, args: object) =>
  tx(h, who, (ctx) => (reducer as (c: unknown, a: object) => void)(ctx, args));
const view = (h: Harness, who: string, v: unknown) => (v as (c: unknown) => any[])(h.viewContext(authFor(who)));
const hexOf = (h: Harness, who: string) => tx(h, who, (ctx) => ctx.sender.toHexString() as string);
const advanceSec = (h: Harness, sec: number) =>
  h.clock.set(new Timestamp(h.clock.now().microsSinceUnixEpoch + BigInt(sec) * 1_000_000n));
const bad = (fn: () => unknown) => expect(fn).toThrow();

const PAGER_KEYS_PROMISE = generateDeviceKeys();
const uuid = () => crypto.randomUUID();

interface Person {
  who: string;
  keys: DeviceKeys;
  hex: string;
  name: string;
  phone: string;
}

/** A roster world: org admin ("admin", also the incident commander) plus people who enroll through links. */
class Org {
  h = makeHarness();
  orgId = uuid();
  people = new Map<string, Person>();
  admin!: Person;
  pagerPub!: Uint8Array;

  static async create(): Promise<Org> {
    const o = new Org();
    o.pagerPub = (await PAGER_KEYS_PROMISE).ecdhPub;
    const keys = await generateDeviceKeys();
    const hex = hexOf(o.h, 'admin');
    o.admin = { who: 'admin', keys, hex, name: 'Casey', phone: '+15550000001' };
    o.people.set('admin', o.admin);
    const sealed = await sealContact(o.pagerPub, o.orgId, hex, o.admin.phone);
    const enrollSig = await signEnrollment(keys.signPriv, {
      orgId: o.orgId,
      identityHex: hex,
      displayName: 'Casey',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      sealedContact: sealed,
    });
    call(o.h, 'admin', mod.create_org, {
      orgId: o.orgId,
      name: 'Lakeside Clinic',
      displayName: 'Casey',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      sealedContact: sealed,
      enrollSig,
    });
    return o;
  }

  /** A second org in the same database, administered by `who`. Returns the id of their active roster row. */
  async foreignOrgRow(who: string): Promise<bigint> {
    const keys = await generateDeviceKeys();
    const orgId = uuid();
    const hex = hexOf(this.h, who);
    const sealed = await sealContact(this.pagerPub, orgId, hex, '+15558888888');
    call(this.h, who, mod.create_org, {
      orgId,
      name: 'Other Org',
      displayName: 'Mal',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      sealedContact: sealed,
      enrollSig: await signEnrollment(keys.signPriv, { orgId, identityHex: hex, displayName: 'Mal', signPub: keys.signPub, ecdhPub: keys.ecdhPub, sealedContact: sealed }),
    });
    const row = [...this.h.db.org_member.iter()].find((m) => m.orgId === orgId)!;
    expect(row.state).toBe('active');
    return row.id;
  }

  link(ttlHours = 2): Uint8Array {
    const code = crypto.getRandomValues(new Uint8Array(16));
    call(this.h, 'admin', mod.create_enroll_link, { orgId: this.orgId, codeHash: enrollLinkHash(this.orgId, code), ttlHours });
    return code;
  }

  async enroll(who: string, name = who, phone = '+15551230000', code = this.link()): Promise<Person> {
    const keys = await generateDeviceKeys();
    const hex = hexOf(this.h, who);
    const sealedContact = await sealContact(this.pagerPub, this.orgId, hex, phone);
    call(this.h, who, mod.enroll_member, {
      orgId: this.orgId,
      code,
      displayName: name,
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      joinTag: new Uint8Array(32),
      sealedContact,
    });
    const p: Person = { who, keys, hex, name, phone };
    this.people.set(who, p);
    return p;
  }

  row(who: string) {
    const hex = this.people.get(who)?.hex ?? hexOf(this.h, who);
    const rows = [...this.h.db.org_member.iter()].filter((m) => m.orgId === this.orgId && m.identity.toHexString() === hex);
    return rows.find((m) => m.state === 'pending') ?? rows.find((m) => m.state === 'active') ?? rows[rows.length - 1]!;
  }

  async certSig(who: string, signer = this.admin.keys) {
    const r = this.row(who);
    return signEnrollment(signer.signPriv, {
      orgId: this.orgId,
      identityHex: r.identity.toHexString(),
      displayName: r.displayName,
      signPub: r.signPub,
      ecdhPub: r.ecdhPub,
      sealedContact: r.sealedContact,
    });
  }

  async approve(who: string) {
    const r = this.row(who);
    call(this.h, 'admin', mod.approve_member, { orgId: this.orgId, orgMemberId: r.id, enrollSig: await this.certSig(who) });
  }

  async enrollApproved(who: string, name = who) {
    const p = await this.enroll(who, name);
    await this.approve(who);
    return p;
  }

  async revokeSig(who: string, reason = 'lost phone', signer = this.admin.keys) {
    const r = this.row(who);
    return signRevocation(signer.signPriv, { orgId: this.orgId, orgMemberId: r.id, identityHex: r.identity.toHexString(), reason });
  }

  async leaveSig(who: string, reason = ORG_LEAVE_REASON, signer = this.people.get(who)!.keys) {
    const r = this.row(who);
    return signRevocation(signer.signPriv, { orgId: this.orgId, orgMemberId: r.id, identityHex: r.identity.toHexString(), reason });
  }
}

/** Org plus an incident commanded by the admin, linked to the org. */
class Room {
  org!: Org;
  incidentId = uuid();
  get h() {
    return this.org.h;
  }

  static async create(): Promise<Room> {
    const r = new Room();
    r.org = await Org.create();
    const { admin, h } = r.org;
    const admitSig = await sign(admin.keys.signPriv, admitStatement(r.incidentId, admin.hex, 'commander', 'Casey', admin.keys.signPub, admin.keys.ecdhPub));
    call(h, 'admin', mod.create_incident, {
      incidentId: r.incidentId,
      signPub: admin.keys.signPub,
      ecdhPub: admin.keys.ecdhPub,
      displayName: 'Casey',
      admitSig,
      envelopes: CHANNELS.map((kind) => ({ kind, wrapped: new Uint8Array(48), iv: new Uint8Array(12) })),
    });
    call(h, 'admin', mod.link_incident_org, { incidentId: r.incidentId, orgId: r.org.orgId });
    return r;
  }

  envelopesFor(role: string, epoch = 0) {
    const kinds = readableChannels(role as Role);
    return kinds.map((kind) => ({ kind, epoch, wrapped: new Uint8Array(48), iv: new Uint8Array(12) }));
  }

  async pick(who: string, role: 'counsel' | 'technical' | 'executive' = 'technical', patch: Record<string, unknown> = {}) {
    const p = this.org.people.get(who)!;
    const r = this.org.row(who);
    const admitSig = await sign(this.org.admin.keys.signPriv, admitStatement(this.incidentId, p.hex, role, r.displayName, r.signPub, r.ecdhPub));
    return { orgMemberId: r.id, role, admitSig, envelopes: this.envelopesFor(role), ...patch };
  }

  async add(who: string, role: 'counsel' | 'technical' | 'executive' = 'technical') {
    call(this.h, 'admin', mod.add_from_roster, { incidentId: this.incidentId, picks: [await this.pick(who, role)] });
  }

  /** Joins the incident through an ordinary invite (not the roster), with the person's roster keys. Admitted unless `admit` is false. */
  async joinByInvite(who: string, admit = true) {
    const o = this.org;
    const p = o.people.get(who)!;
    const r = o.row(who);
    const inv = newInvite(this.incidentId);
    call(this.h, 'admin', mod.create_invite, { incidentId: this.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 });
    const joinTag = await computeJoinTag(inv.secret, { incidentId: this.incidentId, identityHex: p.hex, displayName: r.displayName, signPub: r.signPub, ecdhPub: r.ecdhPub });
    call(this.h, who, mod.redeem_invite, { incidentId: this.incidentId, code: inv.code, displayName: r.displayName, signPub: r.signPub, ecdhPub: r.ecdhPub, joinTag });
    const row = () => [...this.h.db.member.iter()].find((m) => m.incidentId === this.incidentId && m.identity.toHexString() === p.hex)!;
    if (admit) {
      const admitSig = await sign(o.admin.keys.signPriv, admitStatement(this.incidentId, p.hex, 'technical', r.displayName, r.signPub, r.ecdhPub));
      call(this.h, 'admin', mod.admit_member, { incidentId: this.incidentId, memberId: row().id, admitSig, envelopes: this.envelopesFor('technical') });
    }
    return row();
  }

  /** Commander revokes a technical incident member, rotating to every remaining active reader. */
  async revokeFromIncident(who: string) {
    const o = this.org;
    const p = o.people.get(who)!;
    const row = [...this.h.db.member.iter()].find((m) => m.incidentId === this.incidentId && m.identity.toHexString() === p.hex)!;
    const remaining = [...this.h.db.member.iter()].filter((m) => m.incidentId === this.incidentId && m.state === 'active' && m.id !== row.id);
    const rotations = readableChannels('technical').map((kind) => ({
      kind,
      newEpoch: 1,
      envelopes: remaining
        .filter((m) => readableChannels(m.role as Role).includes(kind))
        .map((m) => ({ recipient: m.identity, wrapped: new Uint8Array(48), iv: new Uint8Array(12) })),
    }));
    const revokeSig = await sign(o.admin.keys.signPriv, revokeStatement(this.incidentId, p.hex, row.signPub, row.ecdhPub));
    call(this.h, 'admin', mod.revoke_member, { incidentId: this.incidentId, memberId: row.id, revokeSig, rotations });
  }

  page(ids: bigint[], pageId = uuid(), who = 'admin') {
    call(this.h, who, mod.request_page, { incidentId: this.incidentId, pageId, orgMemberIds: ids });
    return pageId;
  }

  pages(pageId?: string) {
    return [...this.h.db.page.iter()].filter((p) => !pageId || p.pageId === pageId);
  }
}

// --- org enrollment --------------------------------------------------------

describe('create_org', () => {
  it('creates the org and the admin roster row as active', async () => {
    const o = await Org.create();
    expect(o.h.db.org.count()).toBe(1n);
    const row = o.row('admin');
    expect(row.state).toBe('active');
    expect(row.sealedContact.length).toBe(109);
  });

  it('rejects a forged or wrong enrollment cert and malformed input', async () => {
    const h = makeHarness();
    const pager = (await PAGER_KEYS_PROMISE).ecdhPub;
    const keys = await generateDeviceKeys();
    const orgId = uuid();
    const hex = hexOf(h, 'admin');
    const sealed = await sealContact(pager, orgId, hex, '+15550000001');
    const fields = { orgId, identityHex: hex, displayName: 'Casey', signPub: keys.signPub, ecdhPub: keys.ecdhPub, sealedContact: sealed };
    const ok = {
      orgId,
      name: 'Lakeside',
      displayName: 'Casey',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      sealedContact: sealed,
      enrollSig: await signEnrollment(keys.signPriv, fields),
    };
    const stranger = await generateDeviceKeys();
    const fails = (patch: object) => bad(() => call(h, 'admin', mod.create_org, { ...ok, ...patch }));
    fails({ enrollSig: await signEnrollment(stranger.signPriv, fields) }); // signed by another key
    fails({ enrollSig: await signEnrollment(keys.signPriv, { ...fields, displayName: 'Mallory' }) }); // other name
    fails({ enrollSig: await signEnrollment(keys.signPriv, { ...fields, identityHex: hexOf(h, 'someone-else') }) });
    fails({ enrollSig: new Uint8Array(64) });
    fails({ sealedContact: sealed.slice(0, 100) }); // wrong sealed length
    fails({ orgId: 'nope' });
    fails({ name: ' Lakeside' }); // not normalized
    fails({ name: '' });
    expect(h.db.org.count()).toBe(0n);
    call(h, 'admin', mod.create_org, ok);
    expect(h.db.org.count()).toBe(1n);
    bad(() => call(h, 'admin', mod.create_org, ok)); // duplicate id
  });
});

describe('create_enroll_link', () => {
  it('is admin only, bounds the TTL and caps open links at 20', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice');
    const mk = (who: string, patch: object = {}) =>
      call(o.h, who, mod.create_enroll_link, { orgId: o.orgId, codeHash: sha256(crypto.getRandomValues(new Uint8Array(8))), ttlHours: 2, ...patch });
    bad(() => mk('alice')); // active member, not the admin
    bad(() => mk('stranger'));
    bad(() => mk('admin', { ttlHours: 0 }));
    bad(() => mk('admin', { ttlHours: 25 }));
    bad(() => mk('admin', { codeHash: new Uint8Array(31) }));
    for (let i = 0; i < 20; i++) mk('admin');
    bad(() => mk('admin')); // 21st open link
  });
});

describe('enroll_member', () => {
  it('inserts a pending row and burns the link', async () => {
    const o = await Org.create();
    const code = o.link();
    await o.enroll('alice', 'Alice', '+15551230001', code);
    expect(o.row('alice').state).toBe('pending');
    // The link is single use: a second person with the same code is refused (and the failure is recorded).
    const before = o.h.db.join_attempt.count();
    await o.enroll('bob', 'Bob', '+15551230002', code);
    expect(o.h.db.join_attempt.count()).toBe(before + 1n);
    expect([...o.h.db.org_member.iter()].some((m) => m.displayName === 'Bob')).toBe(false);
  });

  it('failed attempts persist (they return, never throw) and are rate limited', async () => {
    const o = await Org.create();
    const keys = await generateDeviceKeys();
    const hex = hexOf(o.h, 'mallory');
    const sealedContact = await sealContact(o.pagerPub, o.orgId, hex, '+15551239999');
    const guess = () =>
      call(o.h, 'mallory', mod.enroll_member, {
        orgId: o.orgId,
        code: crypto.getRandomValues(new Uint8Array(16)),
        displayName: 'Mal',
        signPub: keys.signPub,
        ecdhPub: keys.ecdhPub,
        joinTag: new Uint8Array(32),
        sealedContact,
      });
    for (let i = 0; i < 7; i++) guess(); // does not throw
    const rows = [...o.h.db.join_attempt.iter()].filter((a) => a.identity.toHexString() === hex);
    expect(rows.length).toBe(5); // capped at REDEEM_ATTEMPTS, later ones record nothing
    expect(rows.every((a) => !a.ok)).toBe(true);
    // Even a valid link is refused while over the limit.
    const code = o.link();
    call(o.h, 'mallory', mod.enroll_member, {
      orgId: o.orgId,
      code,
      displayName: 'Mal',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      joinTag: new Uint8Array(32),
      sealedContact,
    });
    expect(o.row('admin')).toBeTruthy();
    expect([...o.h.db.org_member.iter()].some((m) => m.displayName === 'Mal')).toBe(false);
  });

  it('refuses an expired link, another org, a duplicate name and an existing identity', async () => {
    const o = await Org.create();
    const expired = o.link(1);
    advanceSec(o.h, 3601);
    await o.enroll('alice', 'Alice', undefined, expired);
    expect(o.people.has('alice') && o.h.db.org_member.count()).toBe(1n);
    await o.enroll('bob', 'Bob');
    await o.enroll('carol', 'bob'); // same name, different case
    expect(o.h.db.org_member.count()).toBe(2n);
    await o.enroll('bob', 'Bobby'); // identity already enrolled
    expect(o.h.db.org_member.count()).toBe(2n);
  });

  it('a revoked person can enroll again with the same name, and the old row stays revoked', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    const oldId = o.row('alice').id;
    call(o.h, 'admin', mod.revoke_org_member, { orgId: o.orgId, orgMemberId: oldId, reason: 'lost phone', revokeSig: await o.revokeSig('alice') });
    await o.enroll('alice', 'Alice', '+15551230009');
    const rows = [...o.h.db.org_member.iter()].filter((m) => m.orgId === o.orgId && m.identity.toHexString() === o.people.get('alice')!.hex);
    expect(rows.map((m) => m.state).sort()).toEqual(['pending', 'revoked']);
    expect(rows.find((m) => m.state === 'revoked')!.id).toBe(oldId);
    expect(rows.find((m) => m.state === 'pending')!.displayName).toBe('Alice');
    await o.approve('alice');
    expect(o.row('alice').state).toBe('active');
    expect(o.row('alice').id).not.toBe(oldId);
    expect([...o.h.db.org_member.iter()].find((m) => m.id === oldId)!.state).toBe('revoked');
    // While the new row is active the name is taken again.
    await o.enroll('carol', 'Alice', '+15551230008');
    expect([...o.h.db.org_member.iter()].some((m) => m.identity.toHexString() === hexOf(o.h, 'carol'))).toBe(false);
  });

  it('a revoked person cannot enroll again with the old revoked keys', async () => {
    const o = await Org.create();
    const old = await o.enrollApproved('alice', 'Alice');
    call(o.h, 'admin', mod.revoke_org_member, { orgId: o.orgId, orgMemberId: o.row('alice').id, reason: 'lost phone', revokeSig: await o.revokeSig('alice') });
    const sealedContact = await sealContact(o.pagerPub, o.orgId, old.hex, '+15551230000');
    const code = o.link();
    call(o.h, 'alice', mod.enroll_member, {
      orgId: o.orgId,
      code,
      displayName: 'Alice',
      signPub: old.keys.signPub,
      ecdhPub: old.keys.ecdhPub,
      joinTag: new Uint8Array(32),
      sealedContact,
    });
    const rows = [...o.h.db.org_member.iter()].filter((m) => m.identity.toHexString() === old.hex);
    expect(rows.map((m) => m.state)).toEqual(['revoked']);
    // The link was not burned, so a fresh enrollment with it still works.
    await o.enroll('alice', 'Alice', '+15551230000', code);
    expect([...o.h.db.org_member.iter()].filter((m) => m.identity.toHexString() === old.hex).map((m) => m.state).sort()).toEqual(['pending', 'revoked']);
  });

  it('successful enrollments do not use up the guess limit, so repeated test cycles keep working', async () => {
    const o = await Org.create();
    for (let i = 0; i < 7; i++) {
      await o.enroll('alice', 'Alice');
      call(o.h, 'admin', mod.revoke_org_member, { orgId: o.orgId, orgMemberId: o.row('alice').id, reason: 'test', revokeSig: await o.revokeSig('alice', 'test') });
    }
    await o.enrollApproved('alice', 'Alice');
    expect(o.row('alice').state).toBe('active');
  });

  it('a different person can enroll under a name that only a revoked row still holds', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    call(o.h, 'admin', mod.revoke_org_member, {
      orgId: o.orgId,
      orgMemberId: o.row('alice').id,
      reason: 'lost phone',
      revokeSig: await o.revokeSig('alice'),
    });
    await o.enroll('carol', 'Alice', '+15551230008');
    const carol = [...o.h.db.org_member.iter()].find((m) => m.identity.toHexString() === hexOf(o.h, 'carol'))!;
    expect(carol.state).toBe('pending');
    expect(carol.displayName).toBe('Alice');
  });

  it('rejects malformed input outright', async () => {
    const o = await Org.create();
    const keys = await generateDeviceKeys();
    const hex = hexOf(o.h, 'alice');
    const sealedContact = await sealContact(o.pagerPub, o.orgId, hex, '+15551230001');
    const ok = { orgId: o.orgId, code: o.link(), displayName: 'Alice', signPub: keys.signPub, ecdhPub: keys.ecdhPub, joinTag: new Uint8Array(32), sealedContact };
    const fails = (patch: object) => bad(() => call(o.h, 'alice', mod.enroll_member, { ...ok, ...patch }));
    fails({ orgId: 'x' });
    fails({ code: new Uint8Array(15) });
    fails({ signPub: new Uint8Array(65) });
    fails({ joinTag: new Uint8Array(31) });
    fails({ sealedContact: sealedContact.slice(1) });
    fails({ displayName: ' Alice' });
  });
});

describe('approve_member and revoke_org_member', () => {
  it('approve verifies the enrollment certificate over exactly that row', async () => {
    const o = await Org.create();
    await o.enroll('alice', 'Alice');
    await o.enroll('bob', 'Bob');
    const a = o.row('alice');
    const approve = (who: string, sig: Uint8Array, id = a.id) => call(o.h, who, mod.approve_member, { orgId: o.orgId, orgMemberId: id, enrollSig: sig });
    const good = await o.certSig('alice');
    const stranger = await generateDeviceKeys();
    const forged = await o.certSig('alice', stranger);
    const otherRow = await o.certSig('bob');
    bad(() => approve('admin', forged));
    bad(() => approve('admin', otherRow)); // cert for another row
    bad(() => approve('admin', new Uint8Array(64)));
    bad(() => approve('alice', good)); // not the admin
    bad(() => approve('bob', good));
    bad(() => approve('admin', good, 99999n)); // no such row
    expect(o.row('alice').state).toBe('pending');
    approve('admin', good);
    expect(o.row('alice').state).toBe('active');
    bad(() => approve('admin', good)); // already active
  });

  it('a row whose phone was swapped after signing no longer verifies', async () => {
    const o = await Org.create();
    await o.enroll('alice', 'Alice');
    const r = o.row('alice');
    const other = await sealContact(o.pagerPub, o.orgId, r.identity.toHexString(), '+15559999999');
    const sig = await signEnrollment(o.admin.keys.signPriv, {
      orgId: o.orgId,
      identityHex: r.identity.toHexString(),
      displayName: r.displayName,
      signPub: r.signPub,
      ecdhPub: r.ecdhPub,
      sealedContact: other,
    });
    bad(() => call(o.h, 'admin', mod.approve_member, { orgId: o.orgId, orgMemberId: r.id, enrollSig: sig }));
  });

  it('revoke needs the admin and a valid signature; revoked rows cannot be revoked or approved again', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    await o.enrollApproved('bob', 'Bob');
    const id = o.row('alice').id;
    const revoke = (who: string, sig: Uint8Array, reason = 'lost phone', orgMemberId = id) =>
      call(o.h, who, mod.revoke_org_member, { orgId: o.orgId, orgMemberId, reason, revokeSig: sig });
    const good = await o.revokeSig('alice');
    const stranger = await generateDeviceKeys();
    const forged = await o.revokeSig('alice', 'lost phone', stranger);
    const otherReason = await o.revokeSig('alice', 'other reason');
    const forBob = await o.revokeSig('bob');
    bad(() => revoke('admin', forged));
    bad(() => revoke('admin', otherReason)); // reason is signed
    bad(() => revoke('admin', forBob)); // signature for another row
    bad(() => revoke('bob', good)); // not the admin
    bad(() => revoke('alice', good)); // cannot revoke yourself
    bad(() => revoke('admin', good, 'x'.repeat(201)));
    const adminSig = await o.revokeSig('admin');
    bad(() => revoke('admin', adminSig, 'lost phone', o.row('admin').id)); // the admin cannot be revoked
    expect(o.row('alice').state).toBe('active');
    revoke('admin', good);
    expect(o.row('alice').state).toBe('revoked');
    bad(() => revoke('admin', good)); // already revoked
    bad(() => call(o.h, 'admin', mod.approve_member, { orgId: o.orgId, orgMemberId: id, enrollSig: new Uint8Array(64) }));
  });

  it('an admin of another org cannot approve or revoke here', async () => {
    const o = await Org.create();
    await o.enroll('alice', 'Alice');
    // "mallory" creates their own org, then targets alice's org id.
    const keys = await generateDeviceKeys();
    const orgId = uuid();
    const hex = hexOf(o.h, 'mallory');
    const sealed = await sealContact(o.pagerPub, orgId, hex, '+15558888888');
    call(o.h, 'mallory', mod.create_org, {
      orgId,
      name: 'Evil',
      displayName: 'Mal',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      sealedContact: sealed,
      enrollSig: await signEnrollment(keys.signPriv, { orgId, identityHex: hex, displayName: 'Mal', signPub: keys.signPub, ecdhPub: keys.ecdhPub, sealedContact: sealed }),
    });
    const r = o.row('alice');
    const sig = await o.certSig('alice', keys);
    bad(() => call(o.h, 'mallory', mod.approve_member, { orgId: o.orgId, orgMemberId: r.id, enrollSig: sig }));
    bad(() => call(o.h, 'mallory', mod.approve_member, { orgId, orgMemberId: r.id, enrollSig: sig })); // row belongs to another org
    expect(o.row('alice').state).toBe('pending');
  });
});

// --- incident linking and roster admission -----------------------------------

describe('link_incident_org', () => {
  it('only the incident commander who is active in the org, once', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    const room = new Room();
    room.org = o;
    const { admin } = o;
    const admitSig = await sign(admin.keys.signPriv, admitStatement(room.incidentId, admin.hex, 'commander', 'Casey', admin.keys.signPub, admin.keys.ecdhPub));
    call(o.h, 'admin', mod.create_incident, {
      incidentId: room.incidentId,
      signPub: admin.keys.signPub,
      ecdhPub: admin.keys.ecdhPub,
      displayName: 'Casey',
      admitSig,
      envelopes: CHANNELS.map((kind) => ({ kind, wrapped: new Uint8Array(48), iv: new Uint8Array(12) })),
    });
    const link = (who: string, incidentId = room.incidentId, orgId = o.orgId) => call(o.h, who, mod.link_incident_org, { incidentId, orgId });
    bad(() => link('alice')); // not the commander
    bad(() => link('stranger'));
    bad(() => link('admin', room.incidentId, uuid())); // unknown org
    link('admin');
    bad(() => link('admin')); // already linked
  });

  it('a commander who is not an active org member cannot link', async () => {
    const o = await Org.create();
    const cmdKeys = await generateDeviceKeys();
    const incidentId = uuid();
    const hex = hexOf(o.h, 'outsider');
    call(o.h, 'outsider', mod.create_incident, {
      incidentId,
      signPub: cmdKeys.signPub,
      ecdhPub: cmdKeys.ecdhPub,
      displayName: 'Out',
      admitSig: await sign(cmdKeys.signPriv, admitStatement(incidentId, hex, 'commander', 'Out', cmdKeys.signPub, cmdKeys.ecdhPub)),
      envelopes: CHANNELS.map((kind) => ({ kind, wrapped: new Uint8Array(48), iv: new Uint8Array(12) })),
    });
    bad(() => call(o.h, 'outsider', mod.link_incident_org, { incidentId, orgId: o.orgId }));
    expect(o.h.db.incident_org.count()).toBe(0n);
  });
});

describe('add_from_roster', () => {
  it('admits an active roster member with the roster keys and the exact envelope set', async () => {
    const room = await Room.create();
    await room.org.enrollApproved('alice', 'Alice');
    await room.add('alice', 'counsel');
    const m = [...room.h.db.member.iter()].find((x) => x.incidentId === room.incidentId && x.displayName === 'Alice')!;
    expect(m.state).toBe('active');
    expect(m.role).toBe('counsel');
    expect(m.signPub).toEqual(room.org.row('alice').signPub);
    expect([...room.h.db.key_envelope.iter()].filter((e) => e.recipient.toHexString() === room.org.people.get('alice')!.hex).length).toBe(4);
  });

  it('refuses non-commanders, pending, revoked and other-org rows, duplicates and a revoked commander', async () => {
    const room = await Room.create();
    const o = room.org;
    await o.enrollApproved('alice', 'Alice');
    await o.enrollApproved('bob', 'Bob');
    await o.enroll('pending', 'Pen');
    await o.enrollApproved('gone', 'Gone');
    call(o.h, 'admin', mod.revoke_org_member, { orgId: o.orgId, orgMemberId: o.row('gone').id, reason: 'lost phone', revokeSig: await o.revokeSig('gone') });
    const addAs = (who: string, picks: unknown[]) => call(o.h, who, mod.add_from_roster, { incidentId: room.incidentId, picks });

    const alicePick = await room.pick('alice');
    bad(() => addAs('bob', [alicePick])); // bob is not the commander
    bad(() => addAs('stranger', [alicePick]));
    bad(() => addAs('admin', [])); // empty
    const pendingPick = await room.pick('pending');
    const gonePick = await room.pick('gone');
    bad(() => addAs('admin', [pendingPick]));
    bad(() => addAs('admin', [gonePick]));
    bad(() => addAs('admin', [alicePick, alicePick])); // duplicate in one request
    bad(() => addAs('admin', [{ ...alicePick, role: 'commander' }]));
    bad(() => addAs('admin', [{ ...alicePick, orgMemberId: 99999n }]));
    // A row of another org.
    const foreign = await o.foreignOrgRow('mallory'); // active, in a different org of the same database
    // A correctly signed admission for the foreign row, so only the org check can stop it.
    const fr = [...o.h.db.org_member.iter()].find((m) => m.id === foreign)!;
    const foreignSig = await sign(o.admin.keys.signPriv, admitStatement(room.incidentId, fr.identity.toHexString(), 'technical', fr.displayName, fr.signPub, fr.ecdhPub));
    bad(() => addAs('admin', [{ ...alicePick, orgMemberId: foreign, admitSig: foreignSig }]));
    expect([...o.h.db.member.iter()].filter((m) => m.incidentId === room.incidentId).length).toBe(1);

    addAs('admin', [alicePick]);
    const again = await room.pick('alice');
    bad(() => addAs('admin', [again])); // already in the incident

    // An incident that was never linked refuses roster admission.
    const unlinked = uuid();
    const k = o.admin.keys;
    call(o.h, 'admin', mod.create_incident, {
      incidentId: unlinked,
      signPub: k.signPub,
      ecdhPub: k.ecdhPub,
      displayName: 'Casey',
      admitSig: await sign(k.signPriv, admitStatement(unlinked, o.admin.hex, 'commander', 'Casey', k.signPub, k.ecdhPub)),
      envelopes: CHANNELS.map((kind) => ({ kind, wrapped: new Uint8Array(48), iv: new Uint8Array(12) })),
    });
    bad(() => call(o.h, 'admin', mod.add_from_roster, { incidentId: unlinked, picks: [alicePick] }));
  });

  it('admits a person again after the old incident membership is revoked, and keeps that old row', async () => {
    const room = await Room.create();
    const o = room.org;
    await o.enrollApproved('alice', 'Alice');
    await room.add('alice');
    const first = [...room.h.db.member.iter()].find((m) => m.incidentId === room.incidentId && m.displayName === 'Alice')!;
    const oldOrgId = o.row('alice').id;
    call(o.h, 'admin', mod.revoke_org_member, { orgId: o.orgId, orgMemberId: oldOrgId, reason: 'lost phone', revokeSig: await o.revokeSig('alice') });
    await o.enroll('alice', 'Alice');
    await o.approve('alice');
    await expect(room.add('alice')).rejects.toThrow(); // still an active incident member
    await room.revokeFromIncident('alice');
    const role = 'technical' as const;
    const person = o.people.get('alice')!;
    const rosterRow = o.row('alice');
    const envelopes = readableChannels(role).flatMap((kind) =>
      [0, 1].map((epoch) => ({ kind, epoch, wrapped: new Uint8Array(48), iv: new Uint8Array(12) })),
    );
    const admitSig = await sign(
      o.admin.keys.signPriv,
      admitStatement(room.incidentId, person.hex, role, rosterRow.displayName, rosterRow.signPub, rosterRow.ecdhPub),
    );
    call(room.h, 'admin', mod.add_from_roster, {
      incidentId: room.incidentId,
      picks: [{ orgMemberId: rosterRow.id, role, admitSig, envelopes }],
    });
    const rows = [...room.h.db.member.iter()].filter((m) => m.incidentId === room.incidentId && m.identity.toHexString() === person.hex);
    expect(rows.map((m) => m.state).sort()).toEqual(['active', 'revoked']);
    const active = rows.find((m) => m.state === 'active')!;
    expect(active.id).not.toBe(first.id);
    expect(active.role).toBe('technical');
    expect(active.inviteCodeHash).toBe(`roster:${rosterRow.id}`);
    expect(active.lastCounter).toBe(first.lastCounter);
    expect([...room.h.db.org_member.iter()].find((m) => m.id === oldOrgId)!.state).toBe('revoked');
    room.page([rosterRow.id]);
    expect([...room.h.db.page.iter()].some((p) => p.orgMemberId === rosterRow.id)).toBe(true);
    bad(() => room.page([oldOrgId]));
  });

  it('never brings revoked incident keys back: the same roster row cannot be added again after removal', async () => {
    const room = await Room.create();
    const o = room.org;
    await o.enrollApproved('alice', 'Alice');
    await room.add('alice');
    await room.revokeFromIncident('alice');
    // Same roster row, same keys: refused, and nothing was inserted.
    const before = [...room.h.db.member.iter()].length;
    await expect(room.add('alice')).rejects.toThrow();
    expect([...room.h.db.member.iter()].length).toBe(before);
  });

  it('refuses a forged or mismatched admission signature', async () => {
    const room = await Room.create();
    const o = room.org;
    await o.enrollApproved('alice', 'Alice');
    const r = o.row('alice');
    const stranger = await generateDeviceKeys();
    const sigBy = (keys: DeviceKeys, role: string, name = 'Alice', incident = room.incidentId) =>
      sign(keys.signPriv, admitStatement(incident, r.identity.toHexString(), role, name, r.signPub, r.ecdhPub));
    const run = async (patch: Record<string, unknown>) => bad(() => call(o.h, 'admin', mod.add_from_roster, { incidentId: room.incidentId, picks: [{ ...(patch.__base as object), ...patch }] }));
    const base = await room.pick('alice', 'technical');
    const tryPatch = (patch: Record<string, unknown>) => bad(() => call(o.h, 'admin', mod.add_from_roster, { incidentId: room.incidentId, picks: [{ ...base, ...patch }] }));
    void run;
    tryPatch({ admitSig: await sigBy(stranger, 'technical') }); // not the commander key
    tryPatch({ admitSig: await sigBy(o.admin.keys, 'counsel') }); // signed for another role
    tryPatch({ admitSig: await sigBy(o.admin.keys, 'technical', 'Mallory') });
    tryPatch({ admitSig: await sigBy(o.admin.keys, 'technical', 'Alice', uuid()) }); // another incident
    tryPatch({ admitSig: new Uint8Array(64) });
  });

  it('refuses a wrong envelope set', async () => {
    const room = await Room.create();
    const o = room.org;
    await o.enrollApproved('alice', 'Alice');
    const base = await room.pick('alice', 'technical');
    const env = base.envelopes;
    const tryPatch = (envelopes: unknown[]) => bad(() => call(o.h, 'admin', mod.add_from_roster, { incidentId: room.incidentId, picks: [{ ...base, envelopes }] }));
    tryPatch(env.slice(1)); // missing one
    tryPatch([...env, { ...env[0], kind: 'privileged' }]); // a channel the role cannot read
    tryPatch([...env.slice(1), env[1]]); // duplicate
    tryPatch(env.map((e, i) => (i === 0 ? { ...e, epoch: 1 } : e))); // wrong epoch
    tryPatch(env.map((e, i) => (i === 0 ? { ...e, wrapped: new Uint8Array(47) } : e)));
    tryPatch([]);
    expect([...o.h.db.member.iter()].filter((m) => m.incidentId === room.incidentId).length).toBe(1);
    call(o.h, 'admin', mod.add_from_roster, { incidentId: room.incidentId, picks: [base] });
  });
});

// --- paging --------------------------------------------------------------------

describe('request_page', () => {
  async function roomWith(...names: string[]) {
    const room = await Room.create();
    for (const n of names) {
      await room.org.enrollApproved(n, n);
      await room.add(n);
    }
    return room;
  }

  it('creates a requested row per target and schedules the timeout', async () => {
    const room = await roomWith('alice', 'bob');
    const ids = [room.org.row('alice').id, room.org.row('bob').id];
    const pageId = room.page(ids);
    const rows = room.pages(pageId);
    expect(rows.map((r) => r.status)).toEqual(['requested', 'requested']);
    expect(rows.every((r) => r.requestedBy.toHexString() === room.org.admin.hex && !r.carrierReported)).toBe(true);
    expect([...room.h.db.page_sweep.iter()].length).toBe(1);
  });

  it('only the commander; targets must be active roster-added incident members', async () => {
    const room = await roomWith('alice');
    const o = room.org;
    await o.enrollApproved('bob', 'Bob'); // in the org but not in the incident
    await o.enrollApproved('inviteonly', 'Inv');
    const viaInvite = await room.joinByInvite('inviteonly'); // active in the incident through an ordinary invite, not the roster
    expect(viaInvite.state).toBe('active');
    expect(viaInvite.inviteCodeHash).not.toMatch(/^roster:/);
    await o.enroll('pending', 'Pen');
    const foreign = await o.foreignOrgRow('mallory');
    const alice = o.row('alice').id;
    const ask = (who: string, ids: bigint[], pageId = uuid()) => room.page(ids, pageId, who);
    bad(() => ask('alice', [alice])); // a member, not the commander
    bad(() => ask('stranger', [alice]));
    bad(() => ask('admin', [o.row('bob').id])); // not in the incident
    bad(() => ask('admin', [o.row('inviteonly').id])); // only roster-added members can be paged
    bad(() => ask('admin', [foreign])); // a roster row of another org
    bad(() => ask('admin', [o.row('pending').id]));
    bad(() => ask('admin', [o.row('admin').id])); // the commander cannot page themselves
    bad(() => ask('admin', [99999n]));
    bad(() => ask('admin', [])); // no targets
    bad(() => ask('admin', [alice, alice])); // duplicate target
    const reused = uuid();
    ask('admin', [alice], reused);
    advanceSec(o.h, 61);
    bad(() => ask('admin', [alice], reused)); // page ids are single use
    bad(() => ask('admin', [alice], 'not-a-uuid'));
    void room;
  });

  it('a revoked org member can no longer be paged', async () => {
    const room = await roomWith('alice');
    const o = room.org;
    call(o.h, 'admin', mod.revoke_org_member, { orgId: o.orgId, orgMemberId: o.row('alice').id, reason: 'lost phone', revokeSig: await o.revokeSig('alice') });
    bad(() => room.page([o.row('alice').id]));
  });

  it('allows at most 8 targets per request', async () => {
    const names = Array.from({ length: 9 }, (_, i) => `p${i}`);
    const room = await roomWith(...names);
    const ids = names.map((n) => room.org.row(n).id);
    bad(() => room.page(ids));
    room.page(ids.slice(0, 8));
  });

  it('allows one page per target per 60 seconds', async () => {
    const room = await roomWith('alice', 'bob');
    const a = room.org.row('alice').id;
    const b = room.org.row('bob').id;
    room.page([a]);
    advanceSec(room.h, 30);
    bad(() => room.page([a])); // too soon
    bad(() => room.page([a, b])); // one hot target blocks the whole request
    expect(room.pages().length).toBe(1);
    room.page([b]); // someone else is fine
    advanceSec(room.h, 31);
    room.page([a]);
    expect(room.pages().length).toBe(3);
  });

  it('allows at most 20 page rows per incident per hour', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const room = await roomWith(...names);
    const ids = names.map((n) => room.org.row(n).id);
    room.page(ids); // 8
    advanceSec(room.h, 61);
    room.page(ids); // 16
    advanceSec(room.h, 61);
    bad(() => room.page(ids)); // would be 24
    room.page(ids.slice(0, 4)); // 20
    advanceSec(room.h, 61);
    bad(() => room.page([ids[0]])); // 21st
    advanceSec(room.h, 3600); // the window rolls
    room.page([ids[0]]);
  });
});

describe('pager_update', () => {
  async function paged() {
    const room = await Room.create();
    await room.org.enrollApproved('alice', 'Alice');
    await room.add('alice');
    const id = room.org.row('alice').id;
    const pageId = room.page([id]);
    const update = (who: string, status: string, pid = pageId, member = id) =>
      call(room.h, who, mod.pager_update, { pageId: pid, orgMemberId: member, status });
    return { room, id, pageId, update };
  }

  it('only the pager identity can write', async () => {
    const { room, pageId, update } = await paged();
    bad(() => update('admin', 'calling')); // the commander
    bad(() => update('alice', 'acknowledged')); // the paged person
    bad(() => update('stranger', 'calling'));
    expect(room.pages(pageId)[0].status).toBe('requested');
    update('pager', 'calling');
    expect(room.pages(pageId)[0].status).toBe('calling');
  });

  it('the real module refuses every caller that is not the real pager identity', async () => {
    const h = createModuleTestHarness(realMod.default, realMod);
    h.clock.set(new Timestamp(1_800_000_000_000_000n));
    for (const who of ['pager', 'admin', 'stranger']) {
      bad(() => call(h, who, realMod.pager_update, { pageId: uuid(), orgMemberId: 1n, status: 'calling' }));
    }
  });

  it('only moves forward and terminal states are final', async () => {
    const { room, pageId, update } = await paged();
    update('pager', 'ringing'); // skipping calling is fine
    bad(() => update('pager', 'calling')); // backward
    bad(() => update('pager', 'requested'));
    bad(() => update('pager', 'ringing')); // same state
    expect(room.pages(pageId)[0].carrierReported).toBe(false);
    update('pager', 'acknowledged');
    expect(room.pages(pageId)[0].carrierReported).toBe(true);
    for (const s of ['calling', 'ringing', 'no_answer', 'busy', 'failed', 'acknowledged']) bad(() => update('pager', s));
    expect(room.pages(pageId)[0].status).toBe('acknowledged');
  });

  it('rejects unknown rows, statuses and ids', async () => {
    const { id, update, pageId } = await paged();
    bad(() => update('pager', 'calling', uuid())); // no such page
    bad(() => update('pager', 'calling', pageId, id + 1n)); // no such row for that page
    bad(() => update('pager', 'exploded'));
    bad(() => update('pager', 'calling', 'nope'));
    bad(() => update('pager', 'toString'));
  });
});

describe('page_timeout', () => {
  it('a client cannot call it; the scheduler marks unfinished rows no_answer and leaves finished ones', async () => {
    const room = await Room.create();
    for (const n of ['alice', 'bob']) {
      await room.org.enrollApproved(n, n);
      await room.add(n);
    }
    const a = room.org.row('alice').id;
    const b = room.org.row('bob').id;
    const pageId = room.page([a, b]);
    call(room.h, 'pager', mod.pager_update, { pageId, orgMemberId: b, status: 'acknowledged' });
    const sweepRow = [...room.h.db.page_sweep.iter()][0];
    const arg = { arg: sweepRow };
    for (const who of ['admin', 'alice', 'pager', 'stranger']) {
      bad(() => call(room.h, who, mod.page_timeout, arg)); // direct client call
    }
    expect(room.pages(pageId).map((r) => r.status).sort()).toEqual(['acknowledged', 'requested']);
    room.h.withReducerTx(TestAuth.internal(), (ctx: any) => (mod.page_timeout as any)(ctx, arg));
    const byMember = new Map(room.pages(pageId).map((r) => [r.orgMemberId, r.status]));
    expect(byMember.get(a)).toBe('no_answer');
    expect(byMember.get(b)).toBe('acknowledged');
  });
});

// --- views ---------------------------------------------------------------------

describe('org views', () => {
  it('my_org and my_roster show an org only to its active members; pending rows only to the admin', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    await o.enroll('pending', 'Pen');
    expect(view(o.h, 'admin', mod.my_org).length).toBe(1);
    expect(view(o.h, 'alice', mod.my_org).length).toBe(1);
    expect(view(o.h, 'pending', mod.my_org).length).toBe(0);
    expect(view(o.h, 'stranger', mod.my_org).length).toBe(0);
    expect(view(o.h, 'admin', mod.my_roster).length).toBe(3);
    expect(view(o.h, 'alice', mod.my_roster).map((r) => r.displayName).sort()).toEqual(['Alice', 'Casey']);
    expect(view(o.h, 'pending', mod.my_roster).length).toBe(0);
    expect(view(o.h, 'stranger', mod.my_roster).length).toBe(0);
    // A pending person still sees their own row, so the phone can show where it stands.
    expect(view(o.h, 'pending', mod.my_org_status).map((r) => r.state)).toEqual(['pending']);
    expect(view(o.h, 'stranger', mod.my_org_status).length).toBe(0);
  });

  it('a revoked member loses the org and roster views', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    call(o.h, 'admin', mod.revoke_org_member, { orgId: o.orgId, orgMemberId: o.row('alice').id, reason: 'lost phone', revokeSig: await o.revokeSig('alice') });
    expect(view(o.h, 'alice', mod.my_org).length).toBe(0);
    expect(view(o.h, 'alice', mod.my_roster).length).toBe(0);
    expect(view(o.h, 'alice', mod.my_org_status)[0].state).toBe('revoked');
    expect(view(o.h, 'admin', mod.my_roster).find((r) => r.displayName === 'Alice')!.state).toBe('revoked');
  });

  it('my_pages shows pages only to active members of that incident', async () => {
    const room = await Room.create();
    await room.org.enrollApproved('alice', 'Alice');
    await room.org.enrollApproved('bob', 'Bob'); // org member, never added to the incident
    await room.add('alice');
    room.page([room.org.row('alice').id]);
    expect(view(room.h, 'admin', mod.my_pages).length).toBe(1);
    expect(view(room.h, 'alice', mod.my_pages).length).toBe(1);
    expect(view(room.h, 'bob', mod.my_pages).length).toBe(0);
    expect(view(room.h, 'stranger', mod.my_pages).length).toBe(0);
  });

  it('my_pages shows nothing to pending or revoked incident members', async () => {
    const room = await Room.create();
    await room.org.enrollApproved('alice', 'Alice');
    await room.org.enrollApproved('bob', 'Bob');
    await room.org.enrollApproved('carol', 'Carol');
    await room.add('alice');
    await room.add('bob');
    room.page([room.org.row('alice').id, room.org.row('bob').id]);
    expect(view(room.h, 'bob', mod.my_pages).length).toBe(2);
    await room.joinByInvite('carol', false); // pending in the incident
    expect(view(room.h, 'carol', mod.my_pages).length).toBe(0);
    await room.revokeFromIncident('bob');
    expect(view(room.h, 'bob', mod.my_pages).length).toBe(0);
    expect(view(room.h, 'alice', mod.my_pages).length).toBe(2); // still active
  });

  it('pager views return rows only to the pager identity', async () => {
    const room = await Room.create();
    await room.org.enrollApproved('alice', 'Alice');
    await room.add('alice');
    const id = room.org.row('alice').id;
    room.page([id]);
    for (const who of ['admin', 'alice', 'stranger']) {
      expect(view(room.h, who, mod.pager_org_member)).toEqual([]);
      expect(view(room.h, who, mod.pager_page)).toEqual([]);
    }
    const members = view(room.h, 'pager', mod.pager_org_member);
    expect(members.length).toBe(2);
    const alice = members.find((m: any) => m.displayName === 'Alice');
    expect(alice.state).toBe('active');
    expect(alice.identity).toBe(room.org.people.get('alice')!.hex);
    expect(alice.sealedContact.length).toBe(109);
    expect(view(room.h, 'pager', mod.pager_page)).toEqual([
      expect.objectContaining({ orgMemberId: id, status: 'requested', requestedBy: room.org.admin.hex, incidentId: room.incidentId }),
    ]);
  });

  it('the real module returns nothing to anyone but the real pager identity', async () => {
    const h = createModuleTestHarness(realMod.default, realMod);
    for (const who of ['pager', 'admin']) {
      expect(view(h, who, realMod.pager_org_member)).toEqual([]);
      expect(view(h, who, realMod.pager_page)).toEqual([]);
    }
  });
});

describe('leave_org', () => {
  it('only the member can leave, and only with their own signature over the fixed reason', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    const row = o.row('alice');
    const good = await o.leaveSig('alice');
    const wrongReason = await o.leaveSig('alice', 'lost phone');
    const adminSigned = await o.revokeSig('alice', ORG_LEAVE_REASON);
    const leave = (who: string, revokeSig: Uint8Array, orgMemberId = row.id) =>
      call(o.h, who, mod.leave_org, { orgId: o.orgId, orgMemberId, revokeSig });
    bad(() => leave('bob', good)); // not alice
    bad(() => leave('admin', good)); // the admin cannot leave someone else
    bad(() => leave('alice', wrongReason));
    bad(() => leave('alice', adminSigned)); // signed by the admin key, not alice's
    bad(() => leave('alice', new Uint8Array(64)));
    bad(() => leave('alice', good, o.row('admin').id)); // alice cannot drop the admin
    expect(o.row('alice').state).toBe('active');
    leave('alice', good);
    expect(o.row('alice').state).toBe('revoked');
    expect(view(o.h, 'alice', mod.my_org)).toEqual([]);
    bad(() => leave('alice', good)); // already left
    // The same keys cannot enroll again. enroll_member records a failure and returns.
    const again = o.link();
    const person = o.people.get('alice')!;
    const sealed = await sealContact(o.pagerPub, o.orgId, person.hex, person.phone);
    call(o.h, 'alice', mod.enroll_member, {
      orgId: o.orgId,
      code: again,
      displayName: 'Alice',
      signPub: person.keys.signPub,
      ecdhPub: person.keys.ecdhPub,
      joinTag: new Uint8Array(32),
      sealedContact: sealed,
    });
    const rows = [...o.h.db.org_member.iter()].filter((m) => m.identity.toHexString() === person.hex);
    expect(rows.map((m) => m.state)).toEqual(['revoked']);
  });

  it('a pending person can drop the enrollment', async () => {
    const o = await Org.create();
    await o.enroll('alice', 'Alice');
    expect(o.row('alice').state).toBe('pending');
    call(o.h, 'alice', mod.leave_org, { orgId: o.orgId, orgMemberId: o.row('alice').id, revokeSig: await o.leaveSig('alice') });
    expect(o.row('alice').state).toBe('revoked');
    expect(view(o.h, 'alice', mod.my_org)).toEqual([]);
  });

  it('the admin can leave and then create another org; the admin revoke path still refuses them', async () => {
    const o = await Org.create();
    await o.enrollApproved('alice', 'Alice');
    const adminRow = o.row('admin');
    const selfRevoke = await o.revokeSig('admin');
    bad(() =>
      call(o.h, 'admin', mod.revoke_org_member, {
        orgId: o.orgId,
        orgMemberId: adminRow.id,
        reason: 'lost phone',
        revokeSig: selfRevoke,
      }),
    );
    call(o.h, 'admin', mod.leave_org, { orgId: o.orgId, orgMemberId: adminRow.id, revokeSig: await o.leaveSig('admin') });
    expect(o.row('admin').state).toBe('revoked');
    expect(o.row('alice').state).toBe('active');
    expect(view(o.h, 'admin', mod.my_org)).toEqual([]);
    const aliceRevoke = await o.revokeSig('alice');
    bad(() =>
      call(o.h, 'admin', mod.revoke_org_member, {
        orgId: o.orgId,
        orgMemberId: o.row('alice').id,
        reason: 'lost phone',
        revokeSig: aliceRevoke,
      }),
    );
    const keys = await generateDeviceKeys();
    const orgId = uuid();
    const sealed = await sealContact(o.pagerPub, orgId, o.admin.hex, '+15550000009');
    call(o.h, 'admin', mod.create_org, {
      orgId,
      name: 'North Clinic',
      displayName: 'Casey',
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      sealedContact: sealed,
      enrollSig: await signEnrollment(keys.signPriv, {
        orgId,
        identityHex: o.admin.hex,
        displayName: 'Casey',
        signPub: keys.signPub,
        ecdhPub: keys.ecdhPub,
        sealedContact: sealed,
      }),
    });
    expect(view(o.h, 'admin', mod.my_org).map((org: { id: string }) => org.id)).toEqual([orgId]);
  });
});
