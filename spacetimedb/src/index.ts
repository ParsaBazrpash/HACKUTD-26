// ZeroHour Spacetime module (docs/PLAN.md section 5).
//
// Design rules (AGENTS.md):
// - All tables are private. Clients read only the `my_*` views and write only
//   through reducers. Every reducer validates inputs, then membership and role.
// - The module is untrusted by the clients; its checks are defense in depth.
// - Nothing here generates secrets (ctx.random is seeded, not cryptographic).
// - A throwing reducer rolls back all its writes. The failed-attempt counter in
//   redeem_invite is therefore persisted by returning normally, never by throwing.
// - No reducer updates or deletes events, edits keys, or changes roles. There
//   are no debug, seed or tamper reducers.
// - Logs contain ids and reasons only, never payload bytes.

import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx, ViewCtx } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';
import { p256 } from '@noble/curves/nist.js';
import {
  admitStatement,
  chainInput,
  eventSigInput,
  genesisInput,
  bytesToHex,
  inviteInput,
  revokeStatement,
} from './shared/encoding';
import {
  HASH_LEN,
  INVITE_CODE_LEN,
  INVITE_TTL_MAX_MIN,
  isUuidV4,
  isValidDisplayName,
  IV_LEN,
  displayNameKey,
  MAX_CIPHERTEXT,
  MAX_INCIDENTS_PER_IDENTITY,
  MAX_MEMBERS,
  MAX_OPEN_INVITES,
  MIN_CIPHERTEXT,
  normalizeDisplayName,
  PUBKEY_LEN,
  REDEEM_ATTEMPTS,
  REDEEM_WINDOW_MIN,
  SIG_LEN,
  WRAPPED_KEY_LEN,
} from './shared/limits';
import {
  CHANNELS,
  canRead,
  canWrite,
  isChannel,
  isInvitableRole,
  isRole,
  type ChannelKind,
  type Role,
} from './shared/policy';

// ---------------------------------------------------------------------------
// Tables (all private)
// ---------------------------------------------------------------------------

const incident = table(
  {},
  {
    id: t.string().primaryKey(),
    commander: t.identity().index('btree'),
    commanderSignPub: t.byteArray(),
    commanderEcdhPub: t.byteArray(),
    createdAt: t.timestamp(),
    closed: t.bool(),
  },
);

const member = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    role: t.string(),
    state: t.string(), // 'pending' | 'active' | 'revoked'
    displayName: t.string(),
    signPub: t.byteArray(),
    ecdhPub: t.byteArray(),
    joinTag: t.byteArray(),
    inviteCodeHash: t.string(), // lowercase hex of the invite codeHash (empty for the commander)
    admitSig: t.byteArray(),
    revokeSig: t.byteArray(),
    lastCounter: t.u64(),
    joinedAt: t.timestamp(),
    admittedAt: t.option(t.timestamp()),
    revokedAt: t.option(t.timestamp()),
  },
);

const invite = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.string().index('btree'),
    // Lowercase hex of SHA-256(enc('zh1/invite', incidentId, code)). The code itself is never stored.
    // Hex string rather than bytes because byte arrays are not indexable keys.
    codeHash: t.string().unique(),
    role: t.string(),
    createdBy: t.identity(),
    expiresAt: t.timestamp(),
    used: t.bool(),
    usedBy: t.identity(), // the creator identity until used (no zero-identity constant is needed)
    usedAt: t.timestamp(),
  },
);

const channel = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.string().index('btree'),
    kind: t.string(),
    currentEpoch: t.u32(),
    headSeq: t.u64(),
    headHash: t.byteArray(),
  },
);

const key_envelope = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.string().index('btree'),
    kind: t.string(),
    epoch: t.u32(),
    recipient: t.identity().index('btree'),
    wrapped: t.byteArray(),
    iv: t.byteArray(),
    createdAt: t.timestamp(),
  },
);

// Append-only: no reducer updates or deletes rows of this table.
const event = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    channelId: t.u64().index('btree'),
    incidentId: t.string(),
    kind: t.string(), // channel kind, NOT the payload kind
    seq: t.u64(),
    epoch: t.u32(),
    author: t.identity(),
    clientEventId: t.string().unique(),
    authorCounter: t.u64(),
    iv: t.byteArray(),
    ciphertext: t.byteArray(),
    signature: t.byteArray(),
    serverTs: t.timestamp(),
    prevHash: t.byteArray(),
    hash: t.byteArray(),
  },
);

const join_attempt = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    identity: t.identity().index('btree'),
    incidentId: t.string(),
    at: t.timestamp(),
    ok: t.bool(),
  },
);

const spacetimedb = schema({ incident, member, invite, channel, key_envelope, event, join_attempt });
export default spacetimedb;

type S = InferSchema<typeof spacetimedb>;
type Ctx = ReducerCtx<S>;
type VCtx = ViewCtx<S>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MICROS_PER_MIN = 60_000_000n;

const notAuthorized = () => new SenderError('not authorized');
const invalid = () => new SenderError('invalid request');

/**
 * ECDSA P-256 / SHA-256 over `msg` (defense in depth: clients verify everything
 * again). Never throws; any malformed input is simply invalid. Signatures are
 * Web Crypto r||s, which may be high-S, so lowS is not required.
 */
function sigOk(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  try {
    return p256.verify(sig, msg, pub, { lowS: false, prehash: true });
  } catch {
    return false;
  }
}

const bytesLen = (b: Uint8Array, n: number) => b instanceof Uint8Array && b.length === n;
const validPub = (b: Uint8Array) => bytesLen(b, PUBKEY_LEN) && b[0] === 0x04;

function genesisOf(incidentId: string, kind: string): Uint8Array {
  return sha256(genesisInput(incidentId, kind));
}

function membersOf(ctx: Ctx | VCtx, incidentId: string) {
  return [...ctx.db.member.incidentId.filter(incidentId)];
}

/** The caller's member row in an incident, any state, or undefined. */
function myMemberRow(ctx: Ctx | VCtx, incidentId: string) {
  const me = ctx.sender.toHexString();
  for (const m of ctx.db.member.incidentId.filter(incidentId)) {
    if (m.identity.toHexString() === me) return m;
  }
  return undefined;
}

/** The caller's active member row, or throws 'not authorized'. */
function activeMember(ctx: Ctx, incidentId: string) {
  if (typeof incidentId !== 'string' || incidentId.length > 64) throw notAuthorized();
  const m = myMemberRow(ctx, incidentId);
  if (!m || m.state !== 'active' || !isRole(m.role)) throw notAuthorized();
  return m;
}

/** The caller as active commander of the incident, or throws 'not authorized'. */
function activeCommander(ctx: Ctx, incidentId: string) {
  const m = activeMember(ctx, incidentId);
  const inc = ctx.db.incident.id.find(incidentId);
  if (m.role !== 'commander' || !inc || inc.commander.toHexString() !== ctx.sender.toHexString()) {
    throw notAuthorized();
  }
  return { member: m, incident: inc };
}

function channelsOf(ctx: Ctx | VCtx, incidentId: string) {
  return [...ctx.db.channel.incidentId.filter(incidentId)];
}

function validName(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 400) throw invalid();
  const n = normalizeDisplayName(raw);
  // The client sends the normalized form; anything else is rejected rather than silently rewritten.
  if (n !== raw || !isValidDisplayName(n)) throw invalid();
  return n;
}

function nameTaken(ctx: Ctx, incidentId: string, name: string): boolean {
  const key = displayNameKey(name);
  return membersOf(ctx, incidentId).some((m) => displayNameKey(m.displayName) === key);
}

const micros = (ts: { microsSinceUnixEpoch: bigint }) => ts.microsSinceUnixEpoch;

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

const EnvelopeInit = t.object('EnvelopeInit', {
  kind: t.string(),
  wrapped: t.byteArray(),
  iv: t.byteArray(),
});

export const create_incident = spacetimedb.reducer(
  {
    incidentId: t.string(),
    signPub: t.byteArray(),
    ecdhPub: t.byteArray(),
    displayName: t.string(),
    admitSig: t.byteArray(),
    envelopes: t.array(EnvelopeInit),
  },
  (ctx, { incidentId, signPub, ecdhPub, displayName, admitSig, envelopes }) => {
    if (!isUuidV4(incidentId)) throw invalid();
    if (!validPub(signPub) || !validPub(ecdhPub) || !bytesLen(admitSig, SIG_LEN)) throw invalid();
    const name = validName(displayName);
    if (ctx.db.incident.id.find(incidentId)) throw invalid();
    // The commander self-certifies: the certificate must verify under the key it presents.
    if (!sigOk(signPub, admitStatement(incidentId, ctx.sender.toHexString(), 'commander', name, signPub, ecdhPub), admitSig)) {
      throw invalid();
    }

    let owned = 0;
    for (const _i of ctx.db.incident.commander.filter(ctx.sender)) {
      void _i;
      owned++;
    }
    if (owned >= MAX_INCIDENTS_PER_IDENTITY) throw invalid();

    // exactly one envelope per channel kind
    if (envelopes.length !== CHANNELS.length) throw invalid();
    const byKind = new Map<string, { wrapped: Uint8Array; iv: Uint8Array }>();
    for (const e of envelopes) {
      if (!isChannel(e.kind) || byKind.has(e.kind)) throw invalid();
      if (!bytesLen(e.wrapped, WRAPPED_KEY_LEN) || !bytesLen(e.iv, IV_LEN)) throw invalid();
      byKind.set(e.kind, { wrapped: e.wrapped, iv: e.iv });
    }

    ctx.db.incident.insert({
      id: incidentId,
      commander: ctx.sender,
      commanderSignPub: signPub,
      commanderEcdhPub: ecdhPub,
      createdAt: ctx.timestamp,
      closed: false,
    });
    ctx.db.member.insert({
      id: 0n,
      incidentId,
      identity: ctx.sender,
      role: 'commander',
      state: 'active',
      displayName: name,
      signPub,
      ecdhPub,
      joinTag: new Uint8Array(HASH_LEN),
      inviteCodeHash: '',
      admitSig,
      revokeSig: new Uint8Array(0),
      lastCounter: 0n,
      joinedAt: ctx.timestamp,
      admittedAt: ctx.timestamp,
      revokedAt: undefined,
    });
    for (const kind of CHANNELS) {
      ctx.db.channel.insert({
        id: 0n,
        incidentId,
        kind,
        currentEpoch: 0,
        headSeq: 0n,
        headHash: genesisOf(incidentId, kind),
      });
      const env = byKind.get(kind)!;
      ctx.db.key_envelope.insert({
        id: 0n,
        incidentId,
        kind,
        epoch: 0,
        recipient: ctx.sender,
        wrapped: env.wrapped,
        iv: env.iv,
        createdAt: ctx.timestamp,
      });
    }
    console.log(`incident created ${incidentId}`);
  },
);

export const create_invite = spacetimedb.reducer(
  { incidentId: t.string(), codeHash: t.byteArray(), role: t.string(), ttlMinutes: t.u32() },
  (ctx, { incidentId, codeHash, role, ttlMinutes }) => {
    const { incident: inc } = activeCommander(ctx, incidentId);
    if (inc.closed) throw invalid();
    if (!isInvitableRole(role)) throw invalid();
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > INVITE_TTL_MAX_MIN) throw invalid();
    if (!bytesLen(codeHash, HASH_LEN)) throw invalid();
    const hex = bytesToHex(codeHash);
    if (ctx.db.invite.codeHash.find(hex)) throw invalid();

    const now = micros(ctx.timestamp);
    let open = 0;
    for (const i of ctx.db.invite.incidentId.filter(incidentId)) {
      if (!i.used && micros(i.expiresAt) > now) open++;
    }
    if (open >= MAX_OPEN_INVITES) throw invalid();

    ctx.db.invite.insert({
      id: 0n,
      incidentId,
      codeHash: hex,
      role,
      createdBy: ctx.sender,
      expiresAt: new Timestamp(now + BigInt(ttlMinutes) * MICROS_PER_MIN),
      used: false,
      usedBy: ctx.sender,
      usedAt: ctx.timestamp,
    });
  },
);

export const redeem_invite = spacetimedb.reducer(
  {
    incidentId: t.string(),
    code: t.byteArray(),
    displayName: t.string(),
    signPub: t.byteArray(),
    ecdhPub: t.byteArray(),
    joinTag: t.byteArray(),
  },
  (ctx, { incidentId, code, displayName, signPub, ecdhPub, joinTag }) => {
    // Malformed requests are not brute-force attempts: reject them outright.
    if (!isUuidV4(incidentId)) throw invalid();
    if (!bytesLen(code, INVITE_CODE_LEN) || !validPub(signPub) || !validPub(ecdhPub) || !bytesLen(joinTag, HASH_LEN)) {
      throw invalid();
    }
    const name = validName(displayName);

    // Rate limit per identity. Over the limit: return without recording more rows.
    const now = micros(ctx.timestamp);
    const windowStart = now - BigInt(REDEEM_WINDOW_MIN) * MICROS_PER_MIN;
    let recent = 0;
    for (const a of ctx.db.join_attempt.identity.filter(ctx.sender)) {
      if (micros(a.at) >= windowStart) recent++;
    }
    if (recent >= REDEEM_ATTEMPTS) return;

    // Every failure below records an attempt and RETURNS (a throw would roll the record back).
    const failed = () => {
      ctx.db.join_attempt.insert({ id: 0n, identity: ctx.sender, incidentId, at: ctx.timestamp, ok: false });
    };

    const hex = bytesToHex(sha256(inviteInput(incidentId, code)));
    const inv = ctx.db.invite.codeHash.find(hex);
    const inc = ctx.db.incident.id.find(incidentId);
    if (!inv || !inc || inv.incidentId !== incidentId || inv.used || micros(inv.expiresAt) <= now || inc.closed) {
      return failed();
    }
    const members = membersOf(ctx, incidentId);
    const me = ctx.sender.toHexString();
    if (members.some((m) => m.identity.toHexString() === me)) return failed();
    if (members.length >= MAX_MEMBERS) return failed();
    if (nameTaken(ctx, incidentId, name)) return failed();
    if (!isInvitableRole(inv.role)) return failed();

    ctx.db.invite.id.update({ ...inv, used: true, usedBy: ctx.sender, usedAt: ctx.timestamp });
    ctx.db.member.insert({
      id: 0n,
      incidentId,
      identity: ctx.sender,
      role: inv.role,
      state: 'pending',
      displayName: name,
      signPub,
      ecdhPub,
      joinTag,
      inviteCodeHash: hex,
      admitSig: new Uint8Array(0),
      revokeSig: new Uint8Array(0),
      lastCounter: 0n,
      joinedAt: ctx.timestamp,
      admittedAt: undefined,
      revokedAt: undefined,
    });
    ctx.db.join_attempt.insert({ id: 0n, identity: ctx.sender, incidentId, at: ctx.timestamp, ok: true });
  },
);

const EnvelopeAdmit = t.object('EnvelopeAdmit', {
  kind: t.string(),
  epoch: t.u32(),
  wrapped: t.byteArray(),
  iv: t.byteArray(),
});

export const admit_member = spacetimedb.reducer(
  { incidentId: t.string(), memberId: t.u64(), admitSig: t.byteArray(), envelopes: t.array(EnvelopeAdmit) },
  (ctx, { incidentId, memberId, admitSig, envelopes }) => {
    const { incident: inc } = activeCommander(ctx, incidentId);
    if (!bytesLen(admitSig, SIG_LEN)) throw invalid();
    const target = ctx.db.member.id.find(memberId);
    if (!target || target.incidentId !== incidentId || target.state !== 'pending' || !isRole(target.role)) {
      throw invalid();
    }
    // The certificate must be the commander's signature over exactly this member.
    if (
      !sigOk(
        inc.commanderSignPub,
        admitStatement(incidentId, target.identity.toHexString(), target.role, target.displayName, target.signPub, target.ecdhPub),
        admitSig,
      )
    ) {
      throw invalid();
    }

    // Envelopes must cover exactly every epoch 0..currentEpoch of every channel the role can read.
    const expected = new Set<string>();
    for (const ch of channelsOf(ctx, incidentId)) {
      if (!isChannel(ch.kind) || !canRead(target.role as Role, ch.kind)) continue;
      for (let e = 0; e <= ch.currentEpoch; e++) expected.add(`${ch.kind}/${e}`);
    }
    if (envelopes.length !== expected.size) throw invalid();
    const seen = new Set<string>();
    for (const e of envelopes) {
      const key = `${e.kind}/${e.epoch}`;
      if (!expected.has(key) || seen.has(key)) throw invalid();
      if (!bytesLen(e.wrapped, WRAPPED_KEY_LEN) || !bytesLen(e.iv, IV_LEN)) throw invalid();
      seen.add(key);
    }

    ctx.db.member.id.update({ ...target, state: 'active', admitSig, admittedAt: ctx.timestamp });
    for (const e of envelopes) {
      ctx.db.key_envelope.insert({
        id: 0n,
        incidentId,
        kind: e.kind,
        epoch: e.epoch,
        recipient: target.identity,
        wrapped: e.wrapped,
        iv: e.iv,
        createdAt: ctx.timestamp,
      });
    }
  },
);

const RotationEnvelope = t.object('RotationEnvelope', {
  recipient: t.identity(),
  wrapped: t.byteArray(),
  iv: t.byteArray(),
});
const Rotation = t.object('Rotation', {
  kind: t.string(),
  newEpoch: t.u32(),
  envelopes: t.array(RotationEnvelope),
});

export const revoke_member = spacetimedb.reducer(
  { incidentId: t.string(), memberId: t.u64(), revokeSig: t.byteArray(), rotations: t.array(Rotation) },
  (ctx, { incidentId, memberId, revokeSig, rotations }) => {
    const { incident: inc } = activeCommander(ctx, incidentId);
    if (!bytesLen(revokeSig, SIG_LEN)) throw invalid();
    const target = ctx.db.member.id.find(memberId);
    if (!target || target.incidentId !== incidentId || !isRole(target.role)) throw invalid();
    if (target.role === 'commander') throw invalid();
    if (!sigOk(inc.commanderSignPub, revokeStatement(incidentId, target.identity.toHexString()), revokeSig)) throw invalid();
    if (target.state !== 'pending' && target.state !== 'active') throw invalid();

    const channels = channelsOf(ctx, incidentId);
    const members = membersOf(ctx, incidentId);

    // Which channels must rotate: every channel the target could read, only if they were active.
    const mustRotate = new Map<string, number>(); // kind -> newEpoch
    if (target.state === 'active') {
      for (const ch of channels) {
        if (isChannel(ch.kind) && canRead(target.role as Role, ch.kind)) mustRotate.set(ch.kind, ch.currentEpoch + 1);
      }
    }
    if (rotations.length !== mustRotate.size) throw invalid();

    const seenKinds = new Set<string>();
    for (const r of rotations) {
      if (!mustRotate.has(r.kind) || seenKinds.has(r.kind) || r.newEpoch !== mustRotate.get(r.kind)) throw invalid();
      seenKinds.add(r.kind);
      // exactly the remaining active members who can read the channel
      const want = new Set<string>();
      for (const m of members) {
        if (m.state === 'active' && m.id !== target.id && isRole(m.role) && canRead(m.role as Role, r.kind as ChannelKind)) {
          want.add(m.identity.toHexString());
        }
      }
      if (r.envelopes.length !== want.size) throw invalid();
      const got = new Set<string>();
      for (const e of r.envelopes) {
        const h = e.recipient.toHexString();
        if (!want.has(h) || got.has(h)) throw invalid();
        if (!bytesLen(e.wrapped, WRAPPED_KEY_LEN) || !bytesLen(e.iv, IV_LEN)) throw invalid();
        got.add(h);
      }
    }

    ctx.db.member.id.update({ ...target, state: 'revoked', revokeSig, revokedAt: ctx.timestamp });
    for (const r of rotations) {
      const ch = channels.find((c) => c.kind === r.kind)!;
      ctx.db.channel.id.update({ ...ch, currentEpoch: r.newEpoch });
      for (const e of r.envelopes) {
        ctx.db.key_envelope.insert({
          id: 0n,
          incidentId,
          kind: r.kind,
          epoch: r.newEpoch,
          recipient: e.recipient,
          wrapped: e.wrapped,
          iv: e.iv,
          createdAt: ctx.timestamp,
        });
      }
    }
    console.log(`member revoked in ${incidentId}`);
  },
);

export const append_event = spacetimedb.reducer(
  {
    incidentId: t.string(),
    kind: t.string(), // channel kind
    epoch: t.u32(),
    clientEventId: t.string(),
    authorCounter: t.u64(),
    iv: t.byteArray(),
    ciphertext: t.byteArray(),
    signature: t.byteArray(),
  },
  (ctx, { incidentId, kind, epoch, clientEventId, authorCounter, iv, ciphertext, signature }) => {
    const me = activeMember(ctx, incidentId);
    if (!isChannel(kind) || !canWrite(me.role as Role, kind)) throw notAuthorized();
    if (!isUuidV4(clientEventId)) throw invalid();
    if (!bytesLen(iv, IV_LEN) || !bytesLen(signature, SIG_LEN)) throw invalid();
    if (!(ciphertext instanceof Uint8Array) || ciphertext.length < MIN_CIPHERTEXT || ciphertext.length > MAX_CIPHERTEXT) {
      throw invalid();
    }
    const inc = ctx.db.incident.id.find(incidentId);
    if (!inc || inc.closed) throw invalid();
    const ch = channelsOf(ctx, incidentId).find((c) => c.kind === kind);
    if (!ch) throw invalid();
    if (epoch !== ch.currentEpoch) throw invalid();
    if (authorCounter <= me.lastCounter) throw invalid();
    if (ctx.db.event.clientEventId.find(clientEventId)) throw invalid();

    const author = me.identity.toHexString();
    // A stolen Spacetime session is not enough to post: the device key must have signed it.
    if (
      !sigOk(
        me.signPub,
        eventSigInput({ incidentId, channel: kind, epoch, author, clientEventId, authorCounter, iv, ciphertext }),
        signature,
      )
    ) {
      throw invalid();
    }
    const seq = ch.headSeq + 1n;
    const hash = sha256(
      chainInput({
        incidentId,
        channel: kind,
        epoch,
        author,
        clientEventId,
        authorCounter,
        iv,
        ciphertext,
        signature,
        prevHash: ch.headHash,
        seq,
        serverTsMicros: micros(ctx.timestamp),
      }),
    );
    ctx.db.event.insert({
      id: 0n,
      channelId: ch.id,
      incidentId,
      kind,
      seq,
      epoch,
      author: me.identity,
      clientEventId,
      authorCounter,
      iv,
      ciphertext,
      signature,
      serverTs: ctx.timestamp,
      prevHash: ch.headHash,
      hash,
    });
    ctx.db.channel.id.update({ ...ch, headSeq: seq, headHash: hash });
    ctx.db.member.id.update({ ...me, lastCounter: authorCounter });
  },
);

// ---------------------------------------------------------------------------
// Views (public, filtered by ctx.sender). Clients subscribe only to these.
// ---------------------------------------------------------------------------

/** The caller's own member rows (any state), so a revoked client can show the lock screen. */
export const my_status = spacetimedb.view({ name: 'my_status', public: true }, t.array(member.rowType), (ctx) => {
  return [...ctx.db.member.identity.filter(ctx.sender)];
});

export const my_incidents = spacetimedb.view({ name: 'my_incidents', public: true }, t.array(incident.rowType), (ctx) => {
  const out = [];
  for (const m of ctx.db.member.identity.filter(ctx.sender)) {
    if (m.state !== 'pending' && m.state !== 'active') continue;
    const inc = ctx.db.incident.id.find(m.incidentId);
    if (inc) out.push(inc);
  }
  return out;
});

export const my_members = spacetimedb.view({ name: 'my_members', public: true }, t.array(member.rowType), (ctx) => {
  const out = [];
  const me = ctx.sender.toHexString();
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state === 'active') {
      for (const m of ctx.db.member.incidentId.filter(mine.incidentId)) out.push(m);
    } else if (mine.state === 'pending') {
      // A pending joiner sees only the commander and themselves.
      const inc = ctx.db.incident.id.find(mine.incidentId);
      for (const m of ctx.db.member.incidentId.filter(mine.incidentId)) {
        if (m.identity.toHexString() === me || (inc && m.identity.toHexString() === inc.commander.toHexString())) out.push(m);
      }
    }
  }
  return out;
});

export const my_channels = spacetimedb.view({ name: 'my_channels', public: true }, t.array(channel.rowType), (ctx) => {
  const out = [];
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state !== 'active' || !isRole(mine.role)) continue;
    for (const ch of ctx.db.channel.incidentId.filter(mine.incidentId)) {
      if (isChannel(ch.kind) && canRead(mine.role, ch.kind)) out.push(ch);
    }
  }
  return out;
});

export const my_envelopes = spacetimedb.view({ name: 'my_envelopes', public: true }, t.array(key_envelope.rowType), (ctx) => {
  const out = [];
  // Only while active in the incident, and only channels the role can read.
  const active = new Map<string, Role>();
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state === 'active' && isRole(mine.role)) active.set(mine.incidentId, mine.role);
  }
  for (const env of ctx.db.key_envelope.recipient.filter(ctx.sender)) {
    const role = active.get(env.incidentId);
    if (role && isChannel(env.kind) && canRead(role, env.kind)) out.push(env);
  }
  return out;
});

export const my_events = spacetimedb.view({ name: 'my_events', public: true }, t.array(event.rowType), (ctx) => {
  const out = [];
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state !== 'active' || !isRole(mine.role)) continue;
    for (const ch of ctx.db.channel.incidentId.filter(mine.incidentId)) {
      if (!isChannel(ch.kind) || !canRead(mine.role, ch.kind)) continue;
      for (const e of ctx.db.event.channelId.filter(ch.id)) out.push(e);
    }
  }
  return out;
});

export const my_invites = spacetimedb.view({ name: 'my_invites', public: true }, t.array(invite.rowType), (ctx) => {
  const out = [];
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state !== 'active' || mine.role !== 'commander') continue;
    const inc = ctx.db.incident.id.find(mine.incidentId);
    if (!inc || inc.commander.toHexString() !== ctx.sender.toHexString()) continue;
    for (const i of ctx.db.invite.incidentId.filter(mine.incidentId)) out.push(i);
  }
  return out;
});

export const my_join_attempts = spacetimedb.view(
  { name: 'my_join_attempts', public: true },
  t.array(join_attempt.rowType),
  (ctx) => [...ctx.db.join_attempt.identity.filter(ctx.sender)],
);
