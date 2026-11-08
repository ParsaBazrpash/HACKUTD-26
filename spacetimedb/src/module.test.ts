/* eslint-disable @typescript-eslint/no-explicit-any -- test plumbing over the harness's untyped reducer and view calls */
import { describe, expect, it } from 'vitest';
import { ConnectionId, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import * as mod from './index';
import { CHANNELS, type ChannelKind, readableChannels, type Role } from './shared/policy';
import { bytesToHex } from './shared/encoding';
import { generateDeviceKeys, type DeviceKeys } from '@/lib/crypto/keys';
import { generateChannelKeyBytes, importChannelKey } from '@/lib/crypto/seal';
import { wrapChannelKey } from '@/lib/crypto/wrap';
import { createSealedEvent } from '@/lib/crypto/event';
import { newInvite } from '@/lib/crypto/invite';
import { computeJoinTag } from '@/lib/crypto/invite';
import { sign } from '@/lib/crypto/sign';
import { admitStatement, checkpointStatement, eventSigInput, revokeStatement } from './shared/encoding';
import { genesisHash } from '@/lib/crypto/chain';
import { verifyIncident, type RawEvent, type RosterMember } from '@/lib/crypto/verify';
import { chat, timeline } from '@/lib/crypto/testkit';
import { serializePayload } from '@/lib/protocol/events';

// --- harness plumbing ------------------------------------------------------

type Harness = ReturnType<typeof makeHarness>;
function makeHarness() {
  const h = createModuleTestHarness(mod.default, mod);
  h.clock.set(new Timestamp(1_800_000_000_000_000n));
  return h;
}
const users = new Map<string, InstanceType<typeof TestAuth>>();
const authFor = (name: string) => {
  let a = users.get(name);
  if (!a) {
    a = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'https://test', sub: name, aud: 'zerohour' }), ConnectionId.random());
    users.set(name, a);
  }
  return a;
};
const tx = <T,>(h: Harness, who: string, fn: (ctx: any) => T): T => h.withReducerTx(authFor(who), fn);
const call = (h: Harness, who: string, reducer: unknown, args: object) =>
  tx(h, who, (ctx) => (reducer as (c: unknown, a: object) => void)(ctx, args));
const view = (h: Harness, who: string, v: unknown) =>
  (v as (c: unknown) => any[])(h.viewContext(authFor(who)));
const identityHex = (h: Harness, who: string) => tx(h, who, (ctx) => ctx.sender.toHexString() as string);
/** Valid create_incident arguments for `who` (real self-certificate; envelope bytes are placeholders). */
async function createArgs(h: Harness, who: string, displayName: string, keys?: DeviceKeys, incidentId = crypto.randomUUID()) {
  const k = keys ?? (await generateDeviceKeys());
  const hex = identityHex(h, who);
  const admitSig = await sign(k.signPriv, admitStatement(incidentId, hex, 'commander', displayName, k.signPub, k.ecdhPub));
  const envelopes = CHANNELS.map((kind) => ({ kind, wrapped: new Uint8Array(48), iv: new Uint8Array(12) }));
  return { incidentId, signPub: k.signPub, ecdhPub: k.ecdhPub, displayName, admitSig, envelopes };
}
const advanceMin = (h: Harness, min: number) =>
  h.clock.set(new Timestamp(h.clock.now().microsSinceUnixEpoch + BigInt(min) * 60_000_000n));
const expectThrows = (fn: () => unknown, msg?: string) => {
  expect(fn).toThrow(msg);
};

// --- world: a commander, plus helpers to invite, admit, revoke, append -------

interface Person {
  name: string;
  role: Role;
  keys: DeviceKeys;
  hex: string;
  counter: bigint;
}

class World {
  h = makeHarness();
  incidentId = crypto.randomUUID();
  raw = new Map<string, Uint8Array>(); // `${kind}/${epoch}`
  keys = new Map<string, CryptoKey>();
  epochs: Record<ChannelKind, number> = { record: 0, command: 0, privileged: 0, technical: 0 };
  people = new Map<string, Person>();
  cmd!: Person;

  static async create(): Promise<World> {
    const w = new World();
    const keys = await generateDeviceKeys();
    const hex = identityHex(w.h, 'commander');
    w.cmd = { name: 'commander', role: 'commander', keys, hex, counter: 0n };
    w.people.set('commander', w.cmd);
    const envelopes = [];
    for (const kind of CHANNELS) {
      const raw = generateChannelKeyBytes();
      w.raw.set(`${kind}/0`, raw);
      w.keys.set(`${kind}/0`, await importChannelKey(raw));
      const wr = await wrapChannelKey(keys.ecdhPriv, keys.ecdhPub, { incidentId: w.incidentId, kind, epoch: 0, recipientIdentityHex: hex }, raw);
      envelopes.push({ kind, wrapped: wr.wrapped, iv: wr.iv });
    }
    const admitSig = await sign(keys.signPriv, admitStatement(w.incidentId, hex, 'commander', 'Casey', keys.signPub, keys.ecdhPub));
    call(w.h, 'commander', mod.create_incident, {
      incidentId: w.incidentId,
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      displayName: 'Casey',
      admitSig,
      envelopes,
    });
    return w;
  }

  /** Commander invites; the joiner redeems. Returns the pending person. */
  async join(name: string, role: Exclude<Role, 'commander'>, displayName = name): Promise<Person> {
    const inv = newInvite(this.incidentId);
    call(this.h, 'commander', mod.create_invite, { incidentId: this.incidentId, codeHash: inv.codeHash, role, ttlMinutes: 15 });
    const keys = await generateDeviceKeys();
    const hex = identityHex(this.h, name);
    const joinTag = await computeJoinTag(inv.secret, { incidentId: this.incidentId, identityHex: hex, displayName, signPub: keys.signPub, ecdhPub: keys.ecdhPub });
    call(this.h, name, mod.redeem_invite, { incidentId: this.incidentId, code: inv.code, displayName, signPub: keys.signPub, ecdhPub: keys.ecdhPub, joinTag });
    const p: Person = { name, role, keys, hex, counter: 0n };
    this.people.set(name, p);
    return p;
  }

  /** The person's newest row, preferring a live one over an older revoked row. */
  memberRow(name: string) {
    const hex = this.people.get(name)?.hex ?? identityHex(this.h, name);
    const rows = [...this.h.db.member.iter()].filter((m) => m.incidentId === this.incidentId && m.identity.toHexString() === hex);
    return rows.find((m) => m.state !== 'revoked') ?? rows[rows.length - 1]!;
  }

  allRows(name: string) {
    const hex = this.people.get(name)?.hex ?? identityHex(this.h, name);
    return [...this.h.db.member.iter()].filter((m) => m.incidentId === this.incidentId && m.identity.toHexString() === hex);
  }

  async admit(name: string, displayName = name) {
    const p = this.people.get(name)!;
    const row = this.memberRow(name);
    const envelopes = [];
    for (const kind of readableChannels(p.role)) {
      for (let e = 0; e <= this.epochs[kind]; e++) {
        const wr = await wrapChannelKey(this.cmd.keys.ecdhPriv, p.keys.ecdhPub, { incidentId: this.incidentId, kind, epoch: e, recipientIdentityHex: p.hex }, this.raw.get(`${kind}/${e}`)!);
        envelopes.push({ kind, epoch: e, wrapped: wr.wrapped, iv: wr.iv });
      }
    }
    const admitSig = await sign(this.cmd.keys.signPriv, admitStatement(this.incidentId, p.hex, p.role, displayName, p.keys.signPub, p.keys.ecdhPub));
    call(this.h, 'commander', mod.admit_member, { incidentId: this.incidentId, memberId: row.id, admitSig, envelopes });
  }

  async joinAndAdmit(name: string, role: Exclude<Role, 'commander'>) {
    const p = await this.join(name, role);
    await this.admit(name);
    return p;
  }

  async revoke(name: string) {
    const p = this.people.get(name)!;
    const row = this.memberRow(name);
    const rotations = [];
    const active = [...this.h.db.member.iter()].filter((m) => m.incidentId === this.incidentId && m.state === 'active' && m.id !== row.id);
    if (row.state === 'active') {
      for (const kind of readableChannels(p.role)) {
        const newEpoch = this.epochs[kind] + 1;
        const raw = generateChannelKeyBytes();
        const envs = [];
        for (const m of active) {
          if (!readableChannels(m.role as Role).includes(kind)) continue;
          const person = [...this.people.values()].find((x) => x.hex === m.identity.toHexString())!;
          const wr = await wrapChannelKey(this.cmd.keys.ecdhPriv, person.keys.ecdhPub, { incidentId: this.incidentId, kind, epoch: newEpoch, recipientIdentityHex: person.hex }, raw);
          envs.push({ recipient: m.identity, wrapped: wr.wrapped, iv: wr.iv });
        }
        rotations.push({ kind, newEpoch, envelopes: envs, raw });
      }
    }
    const revokeSig = await sign(this.cmd.keys.signPriv, revokeStatement(this.incidentId, p.hex, row.signPub, row.ecdhPub));
    call(this.h, 'commander', mod.revoke_member, {
      incidentId: this.incidentId,
      memberId: row.id,
      revokeSig,
      rotations: rotations.map(({ kind, newEpoch, envelopes }) => ({ kind, newEpoch, envelopes })),
    });
    for (const r of rotations) {
      this.epochs[r.kind as ChannelKind] = r.newEpoch;
      this.raw.set(`${r.kind}/${r.newEpoch}`, r.raw);
      this.keys.set(`${r.kind}/${r.newEpoch}`, await importChannelKey(r.raw));
    }
  }

  async append(name: string, channel: ChannelKind, payload = chat('hello'), o: { epoch?: number; counter?: bigint; eventId?: string } = {}) {
    const p = this.people.get(name)!;
    const epoch = o.epoch ?? this.epochs[channel];
    const counter = o.counter ?? ++p.counter;
    const eventId = o.eventId ?? crypto.randomUUID();
    const key = this.keys.get(`${channel}/${epoch}`) ?? this.keys.get(`${channel}/0`)!;
    const sealed = await createSealedEvent(
      { incidentId: this.incidentId, channel, epoch, author: p.hex, clientEventId: eventId, authorCounter: counter },
      serializePayload(payload),
      key,
      p.keys.signPriv,
    );
    advanceMin(this.h, 0);
    this.h.clock.set(new Timestamp(this.h.clock.now().microsSinceUnixEpoch + 1_000_000n));
    call(this.h, name, mod.append_event, {
      incidentId: this.incidentId,
      kind: channel,
      epoch,
      clientEventId: eventId,
      authorCounter: counter,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      signature: sealed.signature,
    });
    return { eventId, counter, sealed };
  }

  events(channel?: ChannelKind) {
    return [...this.h.db.event.iter()].filter((e) => e.incidentId === this.incidentId && (!channel || e.kind === channel));
  }
}

const sums = (rows: { kind: string }[]) => new Set(rows.map((r) => r.kind));

// --- tests -----------------------------------------------------------------

describe('create_incident', () => {
  it('creates incident, commander, 4 channels at genesis and 4 self envelopes', async () => {
    const w = await World.create();
    expect(w.h.db.incident.count()).toBe(1n);
    const chans = [...w.h.db.channel.iter()];
    expect(chans.map((c) => c.kind).sort()).toEqual([...CHANNELS].sort());
    for (const c of chans) {
      expect(c.currentEpoch).toBe(0);
      expect(c.headSeq).toBe(0n);
      expect(bytesToHex(c.headHash)).toBe(bytesToHex(genesisHash(w.incidentId, c.kind)));
    }
    const m = [...w.h.db.member.iter()][0];
    expect(m.state).toBe('active');
    expect(m.role).toBe('commander');
    expect(w.h.db.key_envelope.count()).toBe(4n);
  });

  it('rejects bad ids, keys, signatures, names and envelope sets', async () => {
    const w = await World.create();
    const keys = await generateDeviceKeys();
    const ok = await createArgs(w.h, 'other', 'Dana', keys);
    const env = ok.envelopes;
    const bad = (patch: object) => expectThrows(() => call(w.h, 'other', mod.create_incident, { ...ok, ...patch }));
    bad({ incidentId: 'nope' });
    bad({ incidentId: w.incidentId }); // duplicate id
    bad({ signPub: keys.signPub.slice(0, 64) });
    bad({ ecdhPub: new Uint8Array(65) }); // wrong marker byte
    bad({ admitSig: new Uint8Array(10) });
    bad({ displayName: '' });
    bad({ displayName: ' Dana' }); // not normalized
    bad({ envelopes: env.slice(1) });
    bad({ envelopes: [...env.slice(1), env[1]] }); // duplicate kind
    bad({ envelopes: env.map((e, i) => (i === 0 ? { ...e, wrapped: new Uint8Array(47) } : e)) });
    bad({ envelopes: env.map((e, i) => (i === 0 ? { ...e, kind: 'debug' } : e)) });
    expect(w.h.db.incident.count()).toBe(1n); // nothing was created by the failures
    call(w.h, 'other', mod.create_incident, ok); // the unmodified request is accepted
    expect(w.h.db.incident.count()).toBe(2n);
  });

  it('admitSig must verify under the presented key, for this identity, name and incident (module-side check)', async () => {
    const w = await World.create();
    const keys = await generateDeviceKeys();
    const ok = await createArgs(w.h, 'other', 'Dana', keys);
    const bad = (patch: object) => expectThrows(() => call(w.h, 'other', mod.create_incident, { ...ok, ...patch }));
    bad({ admitSig: new Uint8Array(64) });
    const stranger = await generateDeviceKeys();
    const sigByOther = await sign(stranger.signPriv, admitStatement(ok.incidentId, identityHex(w.h, 'other'), 'commander', 'Dana', keys.signPub, keys.ecdhPub));
    bad({ admitSig: sigByOther });
    const forName = await sign(keys.signPriv, admitStatement(ok.incidentId, identityHex(w.h, 'other'), 'commander', 'Mallory', keys.signPub, keys.ecdhPub));
    bad({ admitSig: forName });
    const forRole = await sign(keys.signPriv, admitStatement(ok.incidentId, identityHex(w.h, 'other'), 'counsel', 'Dana', keys.signPub, keys.ecdhPub));
    bad({ admitSig: forRole });
    const forOtherIdentity = await sign(keys.signPriv, admitStatement(ok.incidentId, identityHex(w.h, 'someone-else'), 'commander', 'Dana', keys.signPub, keys.ecdhPub));
    bad({ admitSig: forOtherIdentity });
    const forOtherIncident = await sign(keys.signPriv, admitStatement(crypto.randomUUID(), identityHex(w.h, 'other'), 'commander', 'Dana', keys.signPub, keys.ecdhPub));
    bad({ admitSig: forOtherIncident });
    call(w.h, 'other', mod.create_incident, ok);
  });

  it('caps incidents per identity at 5', async () => {
    const w = await World.create(); // 1 for 'commander'
    const keys = await generateDeviceKeys();
    for (let i = 0; i < 4; i++) call(w.h, 'commander', mod.create_incident, await createArgs(w.h, 'commander', 'Casey', keys));
    const fifth = await createArgs(w.h, 'commander', 'Casey', keys);
    expectThrows(() => call(w.h, 'commander', mod.create_incident, fifth));
  });
});

describe('create_invite', () => {
  it('only the active commander may create invites; role and ttl are validated', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    const inv = newInvite(w.incidentId);
    const base = { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 };
    expectThrows(() => call(w.h, 'dana', mod.create_invite, base), 'not authorized'); // counsel
    expectThrows(() => call(w.h, 'stranger', mod.create_invite, base), 'not authorized');
    expectThrows(() => call(w.h, 'commander', mod.create_invite, { ...base, role: 'commander' }));
    expectThrows(() => call(w.h, 'commander', mod.create_invite, { ...base, role: 'admin' }));
    expectThrows(() => call(w.h, 'commander', mod.create_invite, { ...base, ttlMinutes: 0 }));
    expectThrows(() => call(w.h, 'commander', mod.create_invite, { ...base, ttlMinutes: 61 }));
    expectThrows(() => call(w.h, 'commander', mod.create_invite, { ...base, codeHash: new Uint8Array(31) }));
    call(w.h, 'commander', mod.create_invite, base);
    expectThrows(() => call(w.h, 'commander', mod.create_invite, base)); // duplicate codeHash
  });

  it('caps unused unexpired invites at 20', async () => {
    const w = await World.create();
    for (let i = 0; i < 20; i++) call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: newInvite(w.incidentId).codeHash, role: 'technical', ttlMinutes: 15 });
    expectThrows(() => call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: newInvite(w.incidentId).codeHash, role: 'technical', ttlMinutes: 15 }));
    advanceMin(w.h, 16); // all expired
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: newInvite(w.incidentId).codeHash, role: 'technical', ttlMinutes: 15 });
  });
});

describe('redeem_invite (T16, T17)', () => {
  const redeemArgs = async (w: World, inv = newInvite(w.incidentId), name = 'Dana') => {
    const keys = await generateDeviceKeys();
    return {
      inv,
      keys,
      args: { incidentId: w.incidentId, code: inv.code, displayName: name, signPub: keys.signPub, ecdhPub: keys.ecdhPub, joinTag: new Uint8Array(32) },
    };
  };
  const attempts = (w: World, who: string) => [...w.h.db.join_attempt.iter()].filter((a) => a.identity.toHexString() === identityHex(w.h, who));

  it('a valid invite creates a pending member with the invite role, once', async () => {
    const w = await World.create();
    await w.join('dana', 'counsel');
    const row = w.memberRow('dana');
    expect(row.state).toBe('pending');
    expect(row.role).toBe('counsel');
    expect(attempts(w, 'dana').map((a) => a.ok)).toEqual([true]);
    // single use: a second person with the same code fails
    const inv = [...w.h.db.invite.iter()][0];
    expect(inv.used).toBe(true);
  });

  it('a used invite fails and records a failed attempt without throwing', async () => {
    const w = await World.create();
    const inv = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 });
    const a = await redeemArgs(w, inv, 'First');
    call(w.h, 'first', mod.redeem_invite, a.args);
    const b = await redeemArgs(w, inv, 'Second');
    call(w.h, 'second', mod.redeem_invite, b.args); // does not throw
    expect(attempts(w, 'second').map((x) => x.ok)).toEqual([false]);
    expect(w.memberRow('first').state).toBe('pending');
    expect([...w.h.db.member.iter()].some((m) => m.displayName === 'Second')).toBe(false);
  });

  it('an expired invite fails and records an attempt', async () => {
    const w = await World.create();
    const inv = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 1 });
    advanceMin(w.h, 2);
    const a = await redeemArgs(w, inv);
    call(w.h, 'late', mod.redeem_invite, a.args);
    expect(attempts(w, 'late').map((x) => x.ok)).toEqual([false]);
    expect([...w.h.db.member.iter()].length).toBe(1);
  });

  it('a wrong code, wrong incident, unknown incident all fail the same generic way', async () => {
    const w = await World.create();
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: newInvite(w.incidentId).codeHash, role: 'technical', ttlMinutes: 15 });
    const wrongCode = await redeemArgs(w);
    call(w.h, 'a', mod.redeem_invite, wrongCode.args);
    const wrongInc = await redeemArgs(w);
    call(w.h, 'b', mod.redeem_invite, { ...wrongInc.args, incidentId: crypto.randomUUID() });
    expect(attempts(w, 'a').map((x) => x.ok)).toEqual([false]);
    expect(attempts(w, 'b').map((x) => x.ok)).toEqual([false]);
    expect([...w.h.db.member.iter()].length).toBe(1);
  });

  it('the sixth attempt in 10 minutes is refused and the counter persisted (T17)', async () => {
    const w = await World.create();
    for (let i = 0; i < 5; i++) call(w.h, 'guesser', mod.redeem_invite, (await redeemArgs(w)).args);
    expect(attempts(w, 'guesser').length).toBe(5);
    // now a VALID invite: the sixth attempt must still be refused
    const inv = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 });
    call(w.h, 'guesser', mod.redeem_invite, (await redeemArgs(w, inv)).args);
    expect([...w.h.db.member.iter()].some((m) => m.identity.toHexString() === identityHex(w.h, 'guesser'))).toBe(false);
    expect(attempts(w, 'guesser').length).toBe(5);
    // after the window passes, the same invite works
    advanceMin(w.h, 11);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: newInvite(w.incidentId).codeHash, role: 'technical', ttlMinutes: 15 });
    const inv2 = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv2.codeHash, role: 'technical', ttlMinutes: 15 });
    call(w.h, 'guesser', mod.redeem_invite, (await redeemArgs(w, inv2, 'Guesser')).args);
    expect(w.memberRow('guesser').state).toBe('pending');
  });

  it('an existing member cannot redeem again; duplicate display names fail', async () => {
    const w = await World.create();
    await w.join('dana', 'counsel', 'Dana');
    const inv = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 });
    call(w.h, 'dana', mod.redeem_invite, (await redeemArgs(w, inv, 'Dana2')).args);
    expect(attempts(w, 'dana').map((a) => a.ok)).toEqual([true, false]);
    const inv2 = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv2.codeHash, role: 'technical', ttlMinutes: 15 });
    call(w.h, 'eve', mod.redeem_invite, (await redeemArgs(w, inv2, 'dANA')).args); // case-insensitive duplicate
    expect(attempts(w, 'eve').map((a) => a.ok)).toEqual([false]);
    const inv3 = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv3.codeHash, role: 'technical', ttlMinutes: 15 });
    call(w.h, 'casey2', mod.redeem_invite, (await redeemArgs(w, inv3, 'casey')).args); // clashes with the commander's name
    expect(attempts(w, 'casey2').map((a) => a.ok)).toEqual([false]);
  });

  it('a revoked invitee redeems a new invite under fresh keys, and the old row stays revoked', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    const first = w.memberRow('dana');
    await w.revoke('dana');
    expect(w.allRows('dana').map((m) => m.state)).toEqual(['revoked']);
    await w.join('dana', 'technical', 'Dana'); // same identity, same name, new keys
    expect(w.allRows('dana').map((m) => m.state).sort()).toEqual(['pending', 'revoked']);
    expect(w.allRows('dana').find((m) => m.state === 'revoked')!.id).toBe(first.id);
    await w.admit('dana', 'Dana');
    const live = w.memberRow('dana');
    expect(live.state).toBe('active');
    expect(live.id).not.toBe(first.id);
    expect(live.role).toBe('technical');
    // The new keys can write; the old revoked row is untouched.
    await w.append('dana', 'technical');
    expect(w.allRows('dana').find((m) => m.id === first.id)!.state).toBe('revoked');
  });

  it('refuses the old revoked keys on a new invite, and a live membership still blocks', async () => {
    const w = await World.create();
    const old = await w.joinAndAdmit('dana', 'counsel');
    await w.revoke('dana');
    const inv = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'counsel', ttlMinutes: 15 });
    const joinTag = new Uint8Array(32);
    const before = w.allRows('dana').length;
    call(w.h, 'dana', mod.redeem_invite, { incidentId: w.incidentId, code: inv.code, displayName: 'Dana', signPub: old.keys.signPub, ecdhPub: old.keys.ecdhPub, joinTag });
    expect(w.allRows('dana').length).toBe(before); // same signing key: refused, nothing created
    expect([...w.h.db.invite.iter()].find((i) => i.codeHash === bytesToHex(inv.codeHash))!.used).toBe(false);
    // Fresh keys work once; then the pending row blocks a second request.
    await w.join('dana', 'counsel', 'Dana');
    const again = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: again.codeHash, role: 'counsel', ttlMinutes: 15 });
    const k2 = await generateDeviceKeys();
    call(w.h, 'dana', mod.redeem_invite, { incidentId: w.incidentId, code: again.code, displayName: 'Dana', signPub: k2.signPub, ecdhPub: k2.ecdhPub, joinTag });
    expect(w.allRows('dana').length).toBe(before + 1);
  });

  it('only the same person gets a revoked incident name back, nobody else can take it', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    await w.revoke('dana');
    await w.join('eve', 'counsel', 'dana');
    expect(w.allRows('eve').length).toBe(0); // the log keeps that name for the person who held it
    await w.join('dana', 'counsel', 'dana');
    expect(w.memberRow('dana').state).toBe('pending');
  });

  it('successful joins do not use up the guess limit, so repeated test cycles keep working', async () => {
    const w = await World.create();
    for (let i = 0; i < 7; i++) {
      await w.join('dana', 'counsel', 'Dana');
      await w.revoke('dana'); // revokes the pending row
    }
    expect(w.allRows('dana').filter((m) => m.state === 'revoked').length).toBe(7);
    await w.join('dana', 'counsel', 'Dana');
    expect(w.memberRow('dana').state).toBe('pending');
  });

  it('malformed arguments are rejected outright', async () => {
    const w = await World.create();
    const a = await redeemArgs(w);
    expectThrows(() => call(w.h, 'x', mod.redeem_invite, { ...a.args, code: new Uint8Array(15) }));
    expectThrows(() => call(w.h, 'x', mod.redeem_invite, { ...a.args, joinTag: new Uint8Array(31) }));
    expectThrows(() => call(w.h, 'x', mod.redeem_invite, { ...a.args, incidentId: 'bad' }));
    expectThrows(() => call(w.h, 'x', mod.redeem_invite, { ...a.args, displayName: '‮evil' }));
  });

  it('the member cap (50) is enforced', async () => {
    const w = await World.create();
    for (let i = 0; i < 49; i++) {
      const inv = newInvite(w.incidentId);
      call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 });
      call(w.h, `u${i}`, mod.redeem_invite, (await redeemArgs(w, inv, `User ${i}`)).args);
    }
    expect([...w.h.db.member.iter()].length).toBe(50);
    const inv = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 });
    call(w.h, 'late', mod.redeem_invite, (await redeemArgs(w, inv, 'Late')).args);
    expect([...w.h.db.member.iter()].length).toBe(50);
    expect(attempts(w, 'late').map((a) => a.ok)).toEqual([false]);
  });
});

describe('admit_member', () => {
  it('only the commander admits, envelopes must match the role exactly', async () => {
    const w = await World.create();
    const tech = await w.join('sam', 'technical');
    const row = w.memberRow('sam');
    const mk = async (kind: ChannelKind, epoch = 0) => {
      const wr = await wrapChannelKey(w.cmd.keys.ecdhPriv, tech.keys.ecdhPub, { incidentId: w.incidentId, kind, epoch, recipientIdentityHex: tech.hex }, w.raw.get(`${kind}/0`)!);
      return { kind, epoch, wrapped: wr.wrapped, iv: wr.iv };
    };
    const sig = await sign(w.cmd.keys.signPriv, admitStatement(w.incidentId, tech.hex, 'technical', 'sam', tech.keys.signPub, tech.keys.ecdhPub));
    const base = { incidentId: w.incidentId, memberId: row.id, admitSig: sig };
    const good = [await mk('record'), await mk('command'), await mk('technical')];
    // The certificate itself is checked by the module: wrong signer, role or name is refused.
    const selfSigned = await sign(tech.keys.signPriv, admitStatement(w.incidentId, tech.hex, 'technical', 'sam', tech.keys.signPub, tech.keys.ecdhPub));
    const wrongRole = await sign(w.cmd.keys.signPriv, admitStatement(w.incidentId, tech.hex, 'counsel', 'sam', tech.keys.signPub, tech.keys.ecdhPub));
    const wrongName = await sign(w.cmd.keys.signPriv, admitStatement(w.incidentId, tech.hex, 'technical', 'Sam Q', tech.keys.signPub, tech.keys.ecdhPub));
    for (const admitSig of [new Uint8Array(64), selfSigned, wrongRole, wrongName]) {
      expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, admitSig, envelopes: good }));
    }
    // technical must not receive #privileged
    const priv = await mk('privileged');
    const rec3 = await mk('record', 3);
    expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, envelopes: [...good, priv] }));
    expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, envelopes: good.slice(1) })); // missing
    expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, envelopes: [...good.slice(1), good[1]] })); // dup
    expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, envelopes: [...good.slice(1), rec3] })); // wrong epoch
    expectThrows(() => call(w.h, 'sam', mod.admit_member, { ...base, envelopes: good }), 'not authorized'); // self-admit
    expectThrows(() => call(w.h, 'stranger', mod.admit_member, { ...base, envelopes: good }), 'not authorized');
    expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, admitSig: new Uint8Array(3), envelopes: good }));
    expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, memberId: 9999n, envelopes: good }));
    expect(w.memberRow('sam').state).toBe('pending');
    call(w.h, 'commander', mod.admit_member, { ...base, envelopes: good });
    expect(w.memberRow('sam').state).toBe('active');
    expectThrows(() => call(w.h, 'commander', mod.admit_member, { ...base, envelopes: good })); // already active
  });

  it('cannot admit a member of another incident', async () => {
    const w1 = await World.create();
    const w2 = new World();
    void w2;
    const p = await w1.join('dana', 'counsel');
    void p;
    // a second incident in the same database
    const otherId = crypto.randomUUID();
    call(w1.h, 'other-commander', mod.create_incident, await createArgs(w1.h, 'other-commander', 'Other', undefined, otherId));
    const row = w1.memberRow('dana');
    expectThrows(() => call(w1.h, 'other-commander', mod.admit_member, { incidentId: otherId, memberId: row.id, admitSig: new Uint8Array(64), envelopes: [] }));
    expect(w1.memberRow('dana').state).toBe('pending');
  });
});

describe('append_event', () => {
  it('assigns seq, serverTs and a chain hash that the client verifies', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    await w.joinAndAdmit('sam', 'technical');
    await w.append('commander', 'record', timeline('Ransom note'));
    await w.append('dana', 'record', timeline('Counsel engaged'));
    await w.append('sam', 'technical', chat('IOCs'));
    await w.append('dana', 'privileged', chat('privileged note'));
    await w.append('commander', 'record', timeline('Containment'));
    const rec = w.events('record');
    expect(rec.map((e) => e.seq)).toEqual([1n, 2n, 3n]);
    expect(bytesToHex(rec[0].prevHash)).toBe(bytesToHex(genesisHash(w.incidentId, 'record')));
    expect(bytesToHex(rec[1].prevHash)).toBe(bytesToHex(rec[0].hash));

    // The client's independent verification accepts the module's chain (shared vector in practice).
    const all = w.events();
    const members: RosterMember[] = [...w.h.db.member.iter()]
      .filter((m) => m.incidentId === w.incidentId)
      .map((m) => ({
        memberId: m.id,
        identityHex: m.identity.toHexString(),
        role: m.role as Role,
        state: m.state as RosterMember['state'],
        displayName: m.displayName,
        signPub: m.signPub,
        ecdhPub: m.ecdhPub,
        admitSig: m.admitSig,
        revokeSig: m.revokeSig,
        revokedAtMicros: m.revokedAt?.microsSinceUnixEpoch,
      }));
    const toRaw = (e: (typeof all)[number]): RawEvent => ({
      channel: e.kind as ChannelKind,
      seq: e.seq,
      epoch: e.epoch,
      author: e.author.toHexString(),
      clientEventId: e.clientEventId,
      authorCounter: e.authorCounter,
      iv: e.iv,
      ciphertext: e.ciphertext,
      signature: e.signature,
      serverTsMicros: e.serverTs.microsSinceUnixEpoch,
      prevHash: e.prevHash,
      hash: e.hash,
    });
    const channels: Record<string, { events: RawEvent[] }> = {};
    for (const kind of CHANNELS) channels[kind] = { events: all.filter((e) => e.kind === kind).map(toRaw) };
    const r = await verifyIncident({
      incidentId: w.incidentId,
      pinnedCommander: { signPub: w.cmd.keys.signPub, ecdhPub: w.cmd.keys.ecdhPub },
      members,
      channels,
      getChannelKey: (c, ep) => w.keys.get(`${c}/${ep}`),
      pinnedHeads: {},
    });
    expect(r.report.rosterFailures).toEqual([]);
    expect(r.report.ok).toBe(true);
    expect(r.events.length).toBe(5);
    expect(r.events.every((e) => e.verdict.ok && e.payload)).toBe(true);
    // channel head matches the last event
    const ch = [...w.h.db.channel.iter()].find((c) => c.incidentId === w.incidentId && c.kind === 'record')!;
    expect(ch.headSeq).toBe(3n);
    expect(bytesToHex(ch.headHash)).toBe(bytesToHex(rec[2].hash));
  });

  it('enforces channel write roles (executive cannot write #record, technical cannot write #privileged)', async () => {
    const w = await World.create();
    await w.joinAndAdmit('eve', 'executive');
    await w.joinAndAdmit('sam', 'technical');
    await expect(w.append('eve', 'record', timeline('x'))).rejects.toThrow('not authorized');
    await expect(w.append('sam', 'privileged')).rejects.toThrow('not authorized');
    await expect(w.append('eve', 'technical')).rejects.toThrow('not authorized');
    await w.append('eve', 'command');
    await w.append('eve', 'privileged');
    await w.append('sam', 'technical');
    expect(w.events().length).toBe(3);
  });

  it('rejects strangers, pending members and unknown channels', async () => {
    const w = await World.create();
    await w.join('pending', 'technical');
    w.people.set('stranger', { name: 'stranger', role: 'technical', keys: await generateDeviceKeys(), hex: identityHex(w.h, 'stranger'), counter: 0n });
    await expect(w.append('pending', 'technical')).rejects.toThrow('not authorized');
    await expect(w.append('stranger', 'technical')).rejects.toThrow('not authorized');
    await expect(w.append('commander', 'debug' as ChannelKind)).rejects.toThrow();
    expect(w.events().length).toBe(0);
  });

  it('rejects an epoch mismatch, a stale counter and a duplicate client event id (T6)', async () => {
    const w = await World.create();
    await w.append('commander', 'record', timeline('one')); // counter 1
    await expect(w.append('commander', 'record', timeline('bad epoch'), { epoch: 1 })).rejects.toThrow();
    await expect(w.append('commander', 'record', timeline('stale'), { counter: 1n })).rejects.toThrow(); // not greater
    await expect(w.append('commander', 'record', timeline('older'), { counter: 0n })).rejects.toThrow();
    const first = w.events()[0];
    await expect(w.append('commander', 'record', timeline('dup'), { eventId: first.clientEventId, counter: 99n })).rejects.toThrow();
    expect(w.events().length).toBe(1);
    // counters may jump ahead but must keep increasing
    await w.append('commander', 'record', timeline('jump'), { counter: 50n });
    await expect(w.append('commander', 'record', timeline('back'), { counter: 49n })).rejects.toThrow();
  });

  it('rejects malformed fields and oversized ciphertext', async () => {
    const w = await World.create();
    const clientEventId = crypto.randomUUID();
    const core = { incidentId: w.incidentId, channel: 'record' as const, epoch: 0, author: w.cmd.hex, clientEventId, authorCounter: 1n };
    const s = await createSealedEvent(core, serializePayload(timeline('x')), w.keys.get('record/0')!, w.cmd.keys.signPriv);
    const b = { incidentId: w.incidentId, kind: 'record', epoch: 0, clientEventId, authorCounter: 1n, iv: s.iv, ciphertext: s.ciphertext, signature: s.signature };
    expectThrows(() => call(w.h, 'commander', mod.append_event, { ...b, clientEventId: 'nope' }));
    expectThrows(() => call(w.h, 'commander', mod.append_event, { ...b, iv: new Uint8Array(11) }));
    expectThrows(() => call(w.h, 'commander', mod.append_event, { ...b, signature: new Uint8Array(63) }));
    expectThrows(() => call(w.h, 'commander', mod.append_event, { ...b, ciphertext: new Uint8Array(16) }));
    expectThrows(() => call(w.h, 'commander', mod.append_event, { ...b, ciphertext: new Uint8Array(16401) }));
    // The boundary size is allowed when the signature covers it.
    const big = new Uint8Array(16400).fill(5);
    const bigSig = await sign(w.cmd.keys.signPriv, eventSigInput({ ...core, iv: s.iv, ciphertext: big }));
    call(w.h, 'commander', mod.append_event, { ...b, ciphertext: big, signature: bigSig });
    expect(w.events().length).toBe(1);
  });

  it('a failed append rolls everything back (no head or counter movement)', async () => {
    const w = await World.create();
    await w.append('commander', 'record', timeline('one'));
    const before = [...w.h.db.channel.iter()].find((c) => c.kind === 'record')!;
    await expect(w.append('commander', 'record', timeline('stale'), { counter: 1n })).rejects.toThrow();
    const after = [...w.h.db.channel.iter()].find((c) => c.kind === 'record')!;
    expect(after.headSeq).toBe(before.headSeq);
    expect(bytesToHex(after.headHash)).toBe(bytesToHex(before.headHash));
  });
});

describe('revoke_member (T13)', () => {
  it('rotates every readable channel, locks the target out, and rejects old-epoch appends', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    await w.joinAndAdmit('sam', 'technical');
    await w.joinAndAdmit('eve', 'executive');
    await w.append('sam', 'technical', chat('before revoke'));
    await w.revoke('sam');

    expect(w.memberRow('sam').state).toBe('revoked');
    const chans = Object.fromEntries([...w.h.db.channel.iter()].map((c) => [c.kind, c.currentEpoch]));
    // Technical could read record, command, technical: those rotated. #privileged did not.
    expect(chans).toEqual({ record: 1, command: 1, technical: 1, privileged: 0 });
    // Old epoch appends are now rejected, for everyone
    await expect(w.append('commander', 'record', timeline('old epoch'), { epoch: 0 })).rejects.toThrow();
    await w.append('commander', 'record', timeline('new epoch'), { epoch: 1 });
    // The revoked member can no longer append at all
    await expect(w.append('sam', 'technical', chat('x'), { epoch: 1 })).rejects.toThrow('not authorized');
    // New epoch envelopes: commander, dana, eve for record/command; commander and dana for technical
    const envs = [...w.h.db.key_envelope.iter()].filter((e) => e.epoch === 1);
    const who = (kind: string) => envs.filter((e) => e.kind === kind).map((e) => e.recipient.toHexString()).sort();
    expect(who('record')).toEqual([w.cmd.hex, w.people.get('dana')!.hex, w.people.get('eve')!.hex].sort());
    expect(who('technical')).toEqual([w.cmd.hex, w.people.get('dana')!.hex].sort());
    expect(envs.some((e) => e.recipient.toHexString() === w.people.get('sam')!.hex)).toBe(false);
  });

  it('only the commander revokes, never the commander, and rotations must be exact', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    await w.joinAndAdmit('sam', 'technical');
    const sam = w.memberRow('sam');
    const samP = w.people.get('sam')!;
    const revokeSig = await sign(w.cmd.keys.signPriv, revokeStatement(w.incidentId, samP.hex, samP.keys.signPub, samP.keys.ecdhPub));
    const base = { incidentId: w.incidentId, memberId: sam.id, revokeSig };
    expectThrows(() => call(w.h, 'dana', mod.revoke_member, { ...base, rotations: [] }), 'not authorized');
    expectThrows(() => call(w.h, 'sam', mod.revoke_member, { ...base, rotations: [] }), 'not authorized');
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, memberId: w.memberRow('commander').id, rotations: [] }));
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [] })); // active target needs rotations
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, revokeSig: new Uint8Array(5), rotations: [] }));
    // A signature for a different member, or by another key, is refused even with valid rotations.
    const forDana = await sign(w.cmd.keys.signPriv, revokeStatement(w.incidentId, w.people.get('dana')!.hex, w.people.get('dana')!.keys.signPub, w.people.get('dana')!.keys.ecdhPub));
    const byOther = await sign(samP.keys.signPriv, revokeStatement(w.incidentId, samP.hex, samP.keys.signPub, samP.keys.ecdhPub));
    for (const bad of [forDana, byOther, new Uint8Array(64)]) {
      expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, revokeSig: bad, rotations: [] }));
    }
    expect(w.memberRow('sam').state).toBe('active');
    const dana = w.people.get('dana')!;
    const sealedRot = async (kind: ChannelKind, recipients: { identity: unknown; person: Person }[], newEpoch = 1) => {
      const raw = generateChannelKeyBytes();
      const envelopes = [];
      for (const r of recipients) {
        const wr = await wrapChannelKey(w.cmd.keys.ecdhPriv, r.person.keys.ecdhPub, { incidentId: w.incidentId, kind, epoch: newEpoch, recipientIdentityHex: r.person.hex }, raw);
        envelopes.push({ recipient: r.identity, wrapped: wr.wrapped, iv: wr.iv });
      }
      return { kind, newEpoch, envelopes };
    };
    const idOf = (name: string) => w.memberRow(name).identity;
    const cmdR = { identity: idOf('commander'), person: w.cmd };
    const danaR = { identity: idOf('dana'), person: dana };
    const samR = { identity: idOf('sam'), person: w.people.get('sam')! };
    const full = [await sealedRot('record', [cmdR, danaR]), await sealedRot('command', [cmdR, danaR]), await sealedRot('technical', [cmdR, danaR])];
    const missingRecipient = await sealedRot('record', [cmdR]);
    const includesRevoked = await sealedRot('record', [cmdR, danaR, samR]);
    const wrongEpoch = await sealedRot('record', [cmdR, danaR], 2);
    const extraPriv = await sealedRot('privileged', [cmdR, danaR]);
    // missing a recipient
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [missingRecipient, full[1], full[2]] }));
    // includes the revoked member
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [includesRevoked, full[1], full[2]] }));
    // wrong epoch
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [wrongEpoch, full[1], full[2]] }));
    // missing a channel
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [full[0], full[1]] }));
    // extra channel the target could not read
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [...full, extraPriv] }));
    // duplicate channel
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [full[0], full[0], full[2]] }));
    expect(w.memberRow('sam').state).toBe('active');
    call(w.h, 'commander', mod.revoke_member, { ...base, rotations: full });
    expect(w.memberRow('sam').state).toBe('revoked');
    expectThrows(() => call(w.h, 'commander', mod.revoke_member, { ...base, rotations: [] })); // already revoked
  });

  it('revoking a pending member needs no rotation', async () => {
    const w = await World.create();
    await w.join('pending', 'technical');
    await w.revoke('pending');
    expect(w.memberRow('pending').state).toBe('revoked');
    expect(Object.values(Object.fromEntries([...w.h.db.channel.iter()].map((c) => [c.kind, c.currentEpoch])))).toEqual([0, 0, 0, 0]);
  });

  it('a member admitted after a rotation receives every epoch', async () => {
    const w = await World.create();
    await w.joinAndAdmit('sam', 'technical');
    await w.revoke('sam');
    await w.joinAndAdmit('dana', 'counsel');
    const envs = [...w.h.db.key_envelope.iter()].filter((e) => e.recipient.toHexString() === w.people.get('dana')!.hex);
    const keys = envs.map((e) => `${e.kind}/${e.epoch}`).sort();
    expect(keys).toEqual(['command/0', 'command/1', 'privileged/0', 'record/0', 'record/1', 'technical/0', 'technical/1'].sort());
  });
});

describe('views filter by role and membership (T11)', () => {
  async function scene() {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    await w.joinAndAdmit('sam', 'technical');
    await w.joinAndAdmit('eve', 'executive');
    await w.append('commander', 'record', timeline('r1'));
    await w.append('dana', 'privileged', chat('priv'));
    await w.append('eve', 'command', chat('cmd'));
    await w.append('sam', 'technical', chat('tech'));
    return w;
  }

  it('technical sees no #privileged channel, events or envelopes', async () => {
    const w = await scene();
    const kinds = (v: unknown) => sums(view(w.h, 'sam', v));
    expect(kinds(mod.my_channels)).toEqual(new Set(['record', 'command', 'technical']));
    expect(kinds(mod.my_events)).toEqual(new Set(['record', 'command', 'technical']));
    expect(kinds(mod.my_envelopes)).toEqual(new Set(['record', 'command', 'technical']));
  });

  it('executive sees no #technical; counsel and commander see everything', async () => {
    const w = await scene();
    expect(sums(view(w.h, 'eve', mod.my_events))).toEqual(new Set(['record', 'command', 'privileged']));
    expect(sums(view(w.h, 'eve', mod.my_envelopes))).toEqual(new Set(['record', 'command', 'privileged']));
    expect(sums(view(w.h, 'dana', mod.my_events))).toEqual(new Set(CHANNELS));
    expect(sums(view(w.h, 'commander', mod.my_events))).toEqual(new Set(CHANNELS));
    expect(view(w.h, 'commander', mod.my_events).length).toBe(4);
  });

  it('envelopes are only ever the caller\'s own', async () => {
    const w = await scene();
    for (const who of ['commander', 'dana', 'sam', 'eve']) {
      const me = identityHex(w.h, who);
      expect(view(w.h, who, mod.my_envelopes).every((e) => e.recipient.toHexString() === me)).toBe(true);
    }
  });

  it('a stranger sees nothing from any view', async () => {
    const w = await scene();
    for (const v of [mod.my_status, mod.my_incidents, mod.my_members, mod.my_channels, mod.my_envelopes, mod.my_events, mod.my_invites, mod.my_join_attempts]) {
      expect(view(w.h, 'stranger', v)).toEqual([]);
    }
  });

  it('a pending joiner sees only the commander and themselves, and no events or keys', async () => {
    const w = await scene();
    await w.join('newbie', 'technical');
    const members = view(w.h, 'newbie', mod.my_members);
    expect(members.map((m) => m.displayName).sort()).toEqual(['Casey', 'newbie']);
    expect(view(w.h, 'newbie', mod.my_incidents).length).toBe(1);
    expect(view(w.h, 'newbie', mod.my_events)).toEqual([]);
    expect(view(w.h, 'newbie', mod.my_envelopes)).toEqual([]);
    expect(view(w.h, 'newbie', mod.my_channels)).toEqual([]);
    expect(view(w.h, 'newbie', mod.my_status).map((m) => m.state)).toEqual(['pending']);
    expect(view(w.h, 'newbie', mod.my_join_attempts).map((a) => a.ok)).toEqual([true]);
  });

  it('active members see the whole roster; only the commander sees invites', async () => {
    const w = await scene();
    expect(view(w.h, 'sam', mod.my_members).length).toBe(4);
    expect(view(w.h, 'commander', mod.my_invites).length).toBe(3);
    expect(view(w.h, 'dana', mod.my_invites)).toEqual([]);
    expect(view(w.h, 'sam', mod.my_invites)).toEqual([]);
  });

  it('a revoked member sees nothing but their own status row, and no new events (T13)', async () => {
    const w = await scene();
    await w.revoke('sam');
    expect(view(w.h, 'sam', mod.my_status).map((m) => m.state)).toEqual(['revoked']);
    for (const v of [mod.my_incidents, mod.my_members, mod.my_channels, mod.my_envelopes, mod.my_events, mod.my_invites]) {
      expect(view(w.h, 'sam', v)).toEqual([]);
    }
  });

  it('incidents are isolated from each other', async () => {
    const w = await scene();
    call(w.h, 'rival', mod.create_incident, await createArgs(w.h, 'rival', 'Rival'));
    expect(view(w.h, 'rival', mod.my_events)).toEqual([]);
    expect(view(w.h, 'rival', mod.my_members).length).toBe(1);
    expect(view(w.h, 'rival', mod.my_incidents).length).toBe(1);
    expect(view(w.h, 'commander', mod.my_incidents).length).toBe(1);
  });
});

describe('post_checkpoint (PLAN 4.10)', () => {
  const signCp = async (w: World, channel: ChannelKind, seq: bigint, hash: Uint8Array, incidentId = w.incidentId) =>
    sign(w.cmd.keys.signPriv, checkpointStatement(incidentId, channel, seq, hash));

  it('stores a commander-signed checkpoint for an existing event, only forward, and shows it to readers of that channel', async () => {
    const w = await World.create();
    await w.joinAndAdmit('sam', 'technical');
    await w.joinAndAdmit('exec', 'executive');
    await w.append('commander', 'record', timeline('one'));
    await w.append('commander', 'record', timeline('two'));
    await w.append('sam', 'technical', chat('iocs'));
    const rec = w.events('record');
    const sig = await signCp(w, 'record', 2n, rec[1].hash);
    call(w.h, 'commander', mod.post_checkpoint, { incidentId: w.incidentId, kind: 'record', seq: 2n, signature: sig });
    const rows = [...w.h.db.checkpoint.iter()];
    expect(rows.length).toBe(1);
    expect(bytesToHex(rows[0].hash)).toBe(bytesToHex(rec[1].hash));
    // not backwards, not a repeat
    const sig1 = await signCp(w, 'record', 1n, rec[0].hash);
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { incidentId: w.incidentId, kind: 'record', seq: 1n, signature: sig1 }));
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { incidentId: w.incidentId, kind: 'record', seq: 2n, signature: sig }));
    // views follow the channel read policy
    const tech = w.events('technical');
    call(w.h, 'commander', mod.post_checkpoint, {
      incidentId: w.incidentId, kind: 'technical', seq: 1n, signature: await signCp(w, 'technical', 1n, tech[0].hash),
    });
    expect(view(w.h, 'commander', mod.my_checkpoints).length).toBe(2);
    expect(view(w.h, 'sam', mod.my_checkpoints).map((c) => c.kind).sort()).toEqual(['record', 'technical']);
    expect(view(w.h, 'exec', mod.my_checkpoints).map((c) => c.kind)).toEqual(['record']);
    expect(view(w.h, 'stranger', mod.my_checkpoints)).toEqual([]);
  });

  it('refuses non-commanders, bad signatures, wrong hashes, unknown events and bad channels', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    await w.append('commander', 'record', timeline('one'));
    const ev = w.events('record')[0];
    const good = await signCp(w, 'record', 1n, ev.hash);
    const args = { incidentId: w.incidentId, kind: 'record', seq: 1n, signature: good };
    expectThrows(() => call(w.h, 'dana', mod.post_checkpoint, args), 'not authorized');
    expectThrows(() => call(w.h, 'stranger', mod.post_checkpoint, args), 'not authorized');
    // signed by someone else
    const dana = w.people.get('dana')!;
    const forged = await sign(dana.keys.signPriv, checkpointStatement(w.incidentId, 'record', 1n, ev.hash));
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { ...args, signature: forged }), 'invalid request');
    // signed over a different hash (a commander who saw another chain cannot attest to the module's)
    const wrongHash = await signCp(w, 'record', 1n, new Uint8Array(32).fill(7));
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { ...args, signature: wrongHash }), 'invalid request');
    // beyond the head, seq 0, unknown channel, short signature
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { ...args, seq: 2n }), 'invalid request');
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { ...args, seq: 0n }), 'invalid request');
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { ...args, kind: 'nope' }), 'invalid request');
    expectThrows(() => call(w.h, 'commander', mod.post_checkpoint, { ...args, signature: new Uint8Array(10) }), 'invalid request');
    expect([...w.h.db.checkpoint.iter()].length).toBe(0);
    call(w.h, 'commander', mod.post_checkpoint, args);
    expect([...w.h.db.checkpoint.iter()].length).toBe(1);
  });
});

describe('append rate bucket (T21)', () => {
  it('allows a burst of 30, then refuses until tokens refill at 3 per second', async () => {
    const w = await World.create();
    const send = async (counter: bigint) => {
      const p = w.cmd;
      const eventId = crypto.randomUUID();
      const sealed = await createSealedEvent(
        { incidentId: w.incidentId, channel: 'record', epoch: 0, author: p.hex, clientEventId: eventId, authorCounter: counter },
        serializePayload(chat('x')),
        w.keys.get('record/0')!,
        p.keys.signPriv,
      );
      call(w.h, 'commander', mod.append_event, {
        incidentId: w.incidentId, kind: 'record', epoch: 0, clientEventId: eventId, authorCounter: counter,
        iv: sealed.iv, ciphertext: sealed.ciphertext, signature: sealed.signature,
      });
    };
    for (let i = 1n; i <= 30n; i++) await send(i);
    await expect(send(31n)).rejects.toThrow();
    expect(w.events('record').length).toBe(30);
    expect(w.memberRow('commander').lastCounter).toBe(30n);
    // one second later there are three tokens again
    advanceMin(w.h, 0);
    w.h.clock.set(new Timestamp(w.h.clock.now().microsSinceUnixEpoch + 1_000_000n));
    await send(31n);
    await send(32n);
    await send(33n);
    await expect(send(34n)).rejects.toThrow();
    expect(w.events('record').length).toBe(33);
  });

  it('is per identity: one member cannot starve another', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'counsel');
    for (let i = 0; i < 30; i++) await w.append('commander', 'record');
    await w.append('dana', 'record');
    expect(w.events('record').length).toBe(31);
  });
});

describe('invite sweep (scheduled housekeeping)', () => {
  const internal = () => TestAuth.internal();
  const runSweep = (w: World, auth: ReturnType<typeof authFor> | ReturnType<typeof TestAuth.internal>) =>
    w.h.withReducerTx(auth, (ctx: any) => (mod.sweep_invites as any)(ctx, { arg: { scheduledId: 1n, scheduledAt: { tag: 'Interval', value: { __time_duration_micros__: 1n } } } }));

  it('create_invite schedules the sweep once', async () => {
    const w = await World.create();
    expect([...w.h.db.invite_sweep.iter()].length).toBe(0);
    await w.join('a', 'counsel');
    await w.join('b', 'technical');
    expect([...w.h.db.invite_sweep.iter()].length).toBe(1);
  });

  it('refuses any caller that is not the scheduler (a client cannot run it)', async () => {
    const w = await World.create();
    await w.join('a', 'counsel');
    expect(() => runSweep(w, authFor('commander'))).toThrow('not authorized');
    expect(() => runSweep(w, authFor('a'))).toThrow('not authorized');
    expect([...w.h.db.invite.iter()].length).toBe(1);
  });

  it('removes dead invites after the keep window, never live ones, and prunes old join attempts', async () => {
    const w = await World.create();
    await w.join('used', 'counsel'); // redeemed
    const inv = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: inv.codeHash, role: 'technical', ttlMinutes: 15 });
    expect([...w.h.db.invite.iter()].length).toBe(2);
    expect([...w.h.db.join_attempt.iter()].length).toBeGreaterThan(0);
    runSweep(w, internal());
    expect([...w.h.db.invite.iter()].length).toBe(2); // nothing is old yet
    advanceMin(w.h, 90);
    const live = newInvite(w.incidentId);
    call(w.h, 'commander', mod.create_invite, { incidentId: w.incidentId, codeHash: live.codeHash, role: 'executive', ttlMinutes: 30 });
    runSweep(w, internal());
    const left = [...w.h.db.invite.iter()];
    expect(left.length).toBe(1);
    expect(left[0].role).toBe('executive');
    expect([...w.h.db.join_attempt.iter()].length).toBe(0);
    // the live invite still redeems
    const keys = await generateDeviceKeys();
    const hex = identityHex(w.h, 'late');
    const joinTag = await computeJoinTag(live.secret, { incidentId: w.incidentId, identityHex: hex, displayName: 'Late', signPub: keys.signPub, ecdhPub: keys.ecdhPub });
    call(w.h, 'late', mod.redeem_invite, { incidentId: w.incidentId, code: live.code, displayName: 'Late', signPub: keys.signPub, ecdhPub: keys.ecdhPub, joinTag });
    expect([...w.h.db.member.iter()].some((m) => m.displayName === 'Late')).toBe(true);
  });
});

describe('append-only surface (T14)', () => {
  it('the module exports no reducer that updates or deletes events, edits roles, or debugs', () => {
    const exported = Object.keys(mod).filter((k) => k !== 'default');
    expect(exported.sort()).toEqual(
      [
        'admit_member', 'append_event', 'create_incident', 'create_invite', 'my_channels', 'my_checkpoints', 'my_envelopes', 'my_events',
        'my_incidents', 'my_invites', 'my_join_attempts', 'my_members', 'my_status', 'post_checkpoint', 'redeem_invite', 'revoke_member',
        'sweep_invites',
        // org roster and paging (WP1)
        'add_from_roster', 'approve_member', 'create_enroll_link', 'create_org', 'enroll_member', 'link_incident_org', 'my_org',
        'my_org_status', 'my_pages', 'my_roster', 'page_timeout', 'pager_org_member', 'pager_page', 'pager_update', 'request_page',
        'revoke_org_member',
        // live presence: connect/disconnect hooks write only the presence table, never events or roles
        'my_presence', 'presence_connect', 'presence_disconnect',
      ].sort(),
    );
    // pager_update only writes page status, gated to the pager identity; it never touches events.
    for (const name of exported.filter((n) => n !== 'pager_update')) expect(name).not.toMatch(/delete|update|edit|debug|seed|tamper|reset|set_role/i);
  });
});

describe('no module-side secrets (T28)', () => {
  it('the module and shared code never call a randomness source', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url);
    const files = ['index.ts', ...readdirSync(new URL('shared/', dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => `shared/${f}`)];
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/ctx\.random|Math\.random|getRandomValues|randomUUID|randomBytes/);
    }
  });
});

// --- presence (lifecycle reducers + my_presence) ------------------------------

describe('presence', () => {
  const connect = (w: World, who: string) => call(w.h, who, mod.presence_connect, {});
  const disconnect = (w: World, who: string) => call(w.h, who, mod.presence_disconnect, {});
  const presenceOf = (w: World, viewer: string) =>
    new Map(view(w.h, viewer, mod.my_presence).map((r: any) => [r.identity.toHexString() as string, r]));

  it('counts connections, keeps last seen, and never goes below zero', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'technical');
    connect(w, 'dana');
    connect(w, 'dana');
    expect(presenceOf(w, 'commander').get(w.people.get('dana')!.hex)?.connections).toBe(2);
    disconnect(w, 'dana');
    disconnect(w, 'dana');
    advanceMin(w.h, 5);
    disconnect(w, 'dana');
    const row = presenceOf(w, 'commander').get(w.people.get('dana')!.hex);
    expect(row?.connections).toBe(0);
    // A stray extra disconnect still records the time but never goes negative.
    expect(row?.lastSeen.microsSinceUnixEpoch).toBe(w.h.clock.now().microsSinceUnixEpoch);
  });

  it('shows presence only to people who share an incident, using the my_members rule', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'technical');
    await w.join('pat', 'counsel');
    for (const who of ['commander', 'dana', 'pat', 'stranger']) connect(w, who);
    const hex = (n: string) => w.people.get(n)?.hex ?? identityHex(w.h, n);

    // A stranger with no rows sees nobody, not even themselves.
    expect(view(w.h, 'stranger', mod.my_presence)).toEqual([]);
    // An active member sees everyone in the incident (pending included), and no outsider.
    expect(new Set(presenceOf(w, 'dana').keys())).toEqual(new Set([hex('commander'), hex('dana'), hex('pat')]));
    // A pending joiner sees only the commander and themselves.
    expect(new Set(presenceOf(w, 'pat').keys())).toEqual(new Set([hex('commander'), hex('pat')]));
  });

  it('a revoked member stops seeing presence', async () => {
    const w = await World.create();
    await w.joinAndAdmit('dana', 'technical');
    connect(w, 'commander');
    connect(w, 'dana');
    await w.revoke('dana');
    expect(view(w.h, 'dana', mod.my_presence)).toEqual([]);
    // The commander still sees the revoked person's presence row, which is harmless metadata it already had.
    expect(presenceOf(w, 'commander').has(w.people.get('dana')!.hex)).toBe(true);
  });

  it('forgets throwaway identities when their last connection closes', async () => {
    const w = await World.create();
    connect(w, 'drive-by');
    expect([...w.h.db.presence.iter()].some((r: any) => r.identity.toHexString() === identityHex(w.h, 'drive-by'))).toBe(true);
    disconnect(w, 'drive-by');
    expect([...w.h.db.presence.iter()].some((r: any) => r.identity.toHexString() === identityHex(w.h, 'drive-by'))).toBe(false);
    // A member's row stays after they leave, so the commander can see when they were last here.
    connect(w, 'commander');
    disconnect(w, 'commander');
    expect([...w.h.db.presence.iter()].some((r: any) => r.identity.toHexString() === w.cmd.hex)).toBe(true);
  });
});
