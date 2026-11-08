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
import { ScheduleAt } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx, ViewCtx } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import { sha256 } from '@noble/hashes/sha2.js';
import { p256 } from '@noble/curves/nist.js';
import {
  admitStatement,
  chainInput,
  checkpointStatement,
  eventSigInput,
  genesisInput,
  bytesToHex,
  inviteInput,
  revokeStatement,
} from './shared/encoding';
import {
  APPEND_BURST,
  APPEND_REFILL_PER_SEC,
  HASH_LEN,
  INVITE_CODE_LEN,
  INVITE_TTL_MAX_MIN,
  isIdentityHex,
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
  enrollLinkInput,
  enrollStatement,
  isValidEnrollTtlHours,
  isValidOrgName,
  MAX_ORG_REASON,
  MAX_PAGE_TARGETS,
  normalizeOrgName,
  ORG_LEAVE_REASON,
  orgRevokeStatement,
  SEALED_CONTACT_LEN,
} from './shared/org';
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

/**
 * Spacetime identity (lowercase hex) of the Vercel pager, the only caller allowed to
 * run `pager_update` and to read the `pager_*` views.
 * Created with `curl -X POST https://maincloud.spacetimedb.com/v1/identity`; the token stays in Vercel.
 * Writing it down here is safe: the identity is public, only the token can act as it.
 */
const PAGER_IDENTITY_HEX = 'c200c58fe42c5f75976752a3b7f4a08dd480ad3c6f74bf891404b81f1ba27db2';

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

// Commander-signed attestation of a channel head (PLAN 4.10). The server only
// stores it after verifying the signature; clients verify it again.
const checkpoint = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.string().index('btree'),
    kind: t.string(),
    seq: t.u64(),
    hash: t.byteArray(),
    signature: t.byteArray(),
    createdAt: t.timestamp(),
  },
);

// Token bucket per identity for accepted appends (milli-tokens, so refill is integer math).
const rate_bucket = table(
  {},
  {
    identity: t.identity().primaryKey(),
    milliTokens: t.u64(),
    updatedAtMicros: t.u64(),
  },
);

// Housekeeping schedule. One row, repeating; sweep_invites refuses any caller but the scheduler.
const invite_sweep = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

// --- Org roster and paging (private, like everything else) --------------------

const org = table(
  {},
  {
    id: t.string().primaryKey(), // uuid v4 from the browser
    name: t.string(),
    admin: t.identity().index('btree'),
    adminSignPub: t.byteArray(),
    adminEcdhPub: t.byteArray(),
    createdAt: t.timestamp(),
  },
);

const enroll_link = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    // Lowercase hex of SHA-256(enrollLinkInput(orgId, code)). The code itself is never stored.
    codeHash: t.string().unique(),
    orgId: t.string().index('btree'),
    expiresAt: t.timestamp(),
    used: t.bool(),
    usedBy: t.identity(), // the creator identity until used
  },
);

const org_member = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    orgId: t.string().index('btree'),
    identity: t.identity().index('btree'),
    displayName: t.string(),
    signPub: t.byteArray(),
    ecdhPub: t.byteArray(),
    joinTag: t.byteArray(),
    sealedContact: t.byteArray(), // ciphertext sealed to the pager key
    state: t.string(), // 'pending' | 'active' | 'revoked'
    enrollSig: t.byteArray(),
    revokeSig: t.byteArray(),
    enrolledAt: t.timestamp(),
    approvedAt: t.option(t.timestamp()),
    revokedAt: t.option(t.timestamp()),
  },
);

const incident_org = table(
  {},
  {
    incidentId: t.string().primaryKey(),
    orgId: t.string().index('btree'),
  },
);

const page = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    pageId: t.string().index('btree'),
    incidentId: t.string().index('btree'),
    orgMemberId: t.u64().index('btree'),
    status: t.string(),
    carrierReported: t.bool(),
    requestedBy: t.identity(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

// One-shot schedule rows: page_timeout runs 120 seconds after request_page.
const page_sweep = table(
  {},
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    pageId: t.string(),
  },
);

// Live presence: how many connections an identity has open and when it last connected or left.
// The server already sees every connection, so this stores nothing it did not already learn.
// Only people who share an incident read it (my_presence). Mutable housekeeping, not a record.
const presence = table(
  {},
  {
    identity: t.identity().primaryKey(),
    connections: t.u32(),
    lastSeen: t.timestamp(),
  },
);

const spacetimedb = schema({ incident, member, invite, channel, key_envelope, event, join_attempt, checkpoint, rate_bucket, invite_sweep, org, enroll_link, org_member, incident_org, page, page_sweep, presence });
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

function bytesEqualArr(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const bytesLen = (b: Uint8Array, n: number) => b instanceof Uint8Array && b.length === n;
const validPub = (b: Uint8Array) => bytesLen(b, PUBKEY_LEN) && b[0] === 0x04;

function genesisOf(incidentId: string, kind: string): Uint8Array {
  return sha256(genesisInput(incidentId, kind));
}

function membersOf(ctx: Ctx | VCtx, incidentId: string) {
  return [...ctx.db.member.incidentId.filter(incidentId)];
}

/** The caller's member row in an incident, any state, or undefined. A live row wins over an older revoked one. */
function myMemberRow(ctx: Ctx | VCtx, incidentId: string) {
  const me = ctx.sender.toHexString();
  let found: ReturnType<typeof membersOf>[number] | undefined;
  for (const m of ctx.db.member.incidentId.filter(incidentId)) {
    if (m.identity.toHexString() !== me) continue;
    if (!found || stateRank(m.state) > stateRank(found.state) || (stateRank(m.state) === stateRank(found.state) && m.id > found.id)) found = m;
  }
  return found;
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

function nameTaken(ctx: Ctx, incidentId: string, name: string, reclaimIdentity?: string): boolean {
  const key = displayNameKey(name);
  return membersOf(ctx, incidentId).some((m) => {
    if (displayNameKey(m.displayName) !== key) return false;
    // The same person may take their name back after that incident membership was revoked.
    if (reclaimIdentity && m.state === 'revoked' && m.identity.toHexString() === reclaimIdentity) return false;
    return true;
  });
}

/** active, then pending, then revoked. Ties keep the newer row. */
function stateRank(state: string): number {
  if (state === 'active') return 3;
  if (state === 'pending') return 2;
  if (state === 'revoked') return 1;
  return 0;
}

const micros = (ts: { microsSinceUnixEpoch: bigint }) => ts.microsSinceUnixEpoch;

const SWEEP_EVERY_MIN = 5n;
/** Used and expired invites are kept this long (for the commander's view) before they are swept. */
const INVITE_KEEP_MICROS = 60n * MICROS_PER_MIN;

/** Makes sure the repeating housekeeping job exists (databases published before it existed have none). */
function ensureSweepScheduled(ctx: Ctx) {
  for (const _ of ctx.db.invite_sweep.iter()) return;
  ctx.db.invite_sweep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(SWEEP_EVERY_MIN * MICROS_PER_MIN) });
}

/**
 * Per-identity token bucket on accepted appends: burst APPEND_BURST, refill
 * APPEND_REFILL_PER_SEC. Bounds how fast a member (or a stolen session) can grow
 * the ledger. Throws when empty. A throwing reducer rolls back, so only accepted
 * appends are counted; rejected ones never store anything.
 */
function takeAppendToken(ctx: Ctx) {
  const now = micros(ctx.timestamp);
  const cap = BigInt(APPEND_BURST) * 1000n;
  const row = ctx.db.rate_bucket.identity.find(ctx.sender);
  let milli = cap;
  if (row) {
    const elapsed = now > row.updatedAtMicros ? now - row.updatedAtMicros : 0n;
    milli = row.milliTokens + (elapsed * BigInt(APPEND_REFILL_PER_SEC)) / 1000n;
    if (milli > cap) milli = cap;
  }
  if (milli < 1000n) throw new SenderError('slow down');
  const next = { identity: ctx.sender, milliTokens: milli - 1000n, updatedAtMicros: now };
  if (row) ctx.db.rate_bucket.identity.update(next);
  else ctx.db.rate_bucket.insert(next);
}

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
    ensureSweepScheduled(ctx);

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
      // Only failures count: a success needs a valid one-time code, so it cannot be a guess, and counting it would lock out a person who is legitimately coming back.
      if (!a.ok && micros(a.at) >= windowStart) recent++;
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
    // A live membership (pending or active) blocks. A revoked row stays in the log and does not stop a new request.
    if (members.some((m) => m.identity.toHexString() === me && m.state !== 'revoked')) return failed();
    // A revoked key stays revoked: the same person comes back only under fresh keys.
    if (members.some((m) => bytesEqualArr(m.signPub, signPub) || bytesEqualArr(m.ecdhPub, ecdhPub))) return failed();
    if (members.length >= MAX_MEMBERS) return failed();
    if (nameTaken(ctx, incidentId, name, me)) return failed();
    if (!isInvitableRole(inv.role)) return failed();

    // A returning person keeps counting from where the earlier enrollment stopped, so author counters keep rising across both.
    let priorCounter = 0n;
    for (const m of members) if (m.identity.toHexString() === me && m.lastCounter > priorCounter) priorCounter = m.lastCounter;
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
      lastCounter: priorCounter,
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

/** Envelopes must cover exactly every epoch 0..currentEpoch of every channel the role can read. Throws otherwise. */
function checkAdmitEnvelopes(
  ctx: Ctx,
  incidentId: string,
  role: Role,
  envelopes: { kind: string; epoch: number; wrapped: Uint8Array; iv: Uint8Array }[],
) {
  const expected = new Set<string>();
  for (const ch of channelsOf(ctx, incidentId)) {
    if (!isChannel(ch.kind) || !canRead(role, ch.kind)) continue;
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
}

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

    checkAdmitEnvelopes(ctx, incidentId, target.role as Role, envelopes);

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
    if (!sigOk(inc.commanderSignPub, revokeStatement(incidentId, target.identity.toHexString(), target.signPub, target.ecdhPub), revokeSig)) throw invalid();
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
    takeAppendToken(ctx);

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

export const post_checkpoint = spacetimedb.reducer(
  { incidentId: t.string(), kind: t.string(), seq: t.u64(), signature: t.byteArray() },
  (ctx, { incidentId, kind, seq, signature }) => {
    const { incident: inc } = activeCommander(ctx, incidentId);
    if (!isChannel(kind) || !bytesLen(signature, SIG_LEN)) throw invalid();
    const ch = channelsOf(ctx, incidentId).find((c) => c.kind === kind);
    if (!ch || seq < 1n || seq > ch.headSeq) throw invalid();
    let ev;
    for (const e of ctx.db.event.channelId.filter(ch.id)) {
      if (e.seq === seq) ev = e;
    }
    if (!ev) throw invalid();
    // Checkpoints only move forward, so the log of them is bounded by the number of events.
    for (const c of ctx.db.checkpoint.incidentId.filter(incidentId)) {
      if (c.kind === kind && c.seq >= seq) throw invalid();
    }
    // The signature covers the hash the module holds, so a commander who sees a different
    // chain than the module cannot be made to attest to the module's version.
    if (!sigOk(inc.commanderSignPub, checkpointStatement(incidentId, kind, seq, ev.hash), signature)) throw invalid();
    ctx.db.checkpoint.insert({ id: 0n, incidentId, kind, seq, hash: ev.hash, signature, createdAt: ctx.timestamp });
  },
);

/** Scheduled housekeeping. Only the scheduler may run it; a client call is refused. */
export const sweep_invites = spacetimedb.reducer(
  { onSchedule: invite_sweep },
  { arg: invite_sweep.rowType },
  (ctx) => {
    if (!ctx.senderAuth.isInternal) throw notAuthorized();
    const now = micros(ctx.timestamp);
    // Invites that can no longer be redeemed and are past the keep window: remove the code hash.
    for (const i of [...ctx.db.invite.iter()]) {
      const dead = i.used ? micros(i.usedAt) : micros(i.expiresAt);
      if (dead + INVITE_KEEP_MICROS < now) ctx.db.invite.id.delete(i.id);
    }
    // Join attempts only matter inside the rate window.
    for (const a of [...ctx.db.join_attempt.iter()]) {
      if (micros(a.at) + INVITE_KEEP_MICROS < now) ctx.db.join_attempt.id.delete(a.id);
    }
  },
);


// ---------------------------------------------------------------------------
// Org roster and paging
// ---------------------------------------------------------------------------

const MAX_ORGS_PER_IDENTITY = 3;
const MAX_ORG_MEMBERS = 200;
const MAX_OPEN_ENROLL_LINKS = 20;
const MAX_ROSTER_PICKS = 20;
const PAGE_TARGET_COOLDOWN_MICROS = 60n * 1_000_000n;
const PAGE_INCIDENT_WINDOW_MICROS = 60n * MICROS_PER_MIN;
const MAX_PAGES_PER_INCIDENT_HOUR = 20;
const PAGE_TIMEOUT_MICROS = 120n * 1_000_000n;
const ORG_ATTEMPT_PREFIX = 'org:';

const PAGE_RANK: Record<string, number> = {
  requested: 0,
  calling: 1,
  ringing: 2,
  acknowledged: 3,
  no_answer: 3,
  busy: 3,
  failed: 3,
};
const isPageStatus = (v: unknown): v is string => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAGE_RANK, v);
const isTerminalPage = (v: string) => PAGE_RANK[v] === 3;

/** Marker stored in member.inviteCodeHash for members admitted through the roster. */
const rosterMarker = (orgMemberId: bigint) => `roster:${orgMemberId}`;


function orgMembersOf(ctx: Ctx | VCtx, orgId: string) {
  return [...ctx.db.org_member.orgId.filter(orgId)];
}

/** The caller's org_member row in an org (any state), or undefined. A live row wins over an older revoked one. */
function myOrgRow(ctx: Ctx | VCtx, orgId: string) {
  const me = ctx.sender.toHexString();
  let found: ReturnType<typeof orgMembersOf>[number] | undefined;
  for (const m of ctx.db.org_member.orgId.filter(orgId)) {
    if (m.identity.toHexString() !== me) continue;
    if (!found || stateRank(m.state) > stateRank(found.state) || (stateRank(m.state) === stateRank(found.state) && m.id > found.id)) found = m;
  }
  return found;
}

/** The caller as the org's admin with an active roster row, or throws 'not authorized'. */
function orgAdmin(ctx: Ctx, orgId: string) {
  if (!isUuidV4(orgId)) throw invalid();
  const o = ctx.db.org.id.find(orgId);
  if (!o || o.admin.toHexString() !== ctx.sender.toHexString()) throw notAuthorized();
  const m = myOrgRow(ctx, orgId);
  if (!m || m.state !== 'active') throw notAuthorized();
  return o;
}

function orgNameTaken(ctx: Ctx, orgId: string, name: string): boolean {
  const key = displayNameKey(name);
  // A revoked row keeps its history, but the name can be used again.
  return orgMembersOf(ctx, orgId).some((m) => m.state !== 'revoked' && displayNameKey(m.displayName) === key);
}

const sealedOk = (b: Uint8Array) => bytesLen(b, SEALED_CONTACT_LEN);

function validOrgName(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 400) throw invalid();
  const n = normalizeOrgName(raw);
  if (n !== raw || !isValidOrgName(n)) throw invalid();
  return n;
}

const enrollStatementFor = (orgId: string, m: { identity: { toHexString(): string }; displayName: string; signPub: Uint8Array; ecdhPub: Uint8Array; sealedContact: Uint8Array }) =>
  enrollStatement(orgId, m.identity.toHexString(), m.displayName, m.signPub, m.ecdhPub, sha256(m.sealedContact));

export const create_org = spacetimedb.reducer(
  {
    orgId: t.string(),
    name: t.string(),
    displayName: t.string(),
    signPub: t.byteArray(),
    ecdhPub: t.byteArray(),
    sealedContact: t.byteArray(),
    enrollSig: t.byteArray(),
  },
  (ctx, { orgId, name, displayName, signPub, ecdhPub, sealedContact, enrollSig }) => {
    if (!isUuidV4(orgId)) throw invalid();
    if (!validPub(signPub) || !validPub(ecdhPub) || !sealedOk(sealedContact) || !bytesLen(enrollSig, SIG_LEN)) throw invalid();
    const orgName = validOrgName(name);
    const person = validName(displayName);
    if (ctx.db.org.id.find(orgId)) throw invalid();
    let owned = 0;
    for (const _o of ctx.db.org.admin.filter(ctx.sender)) {
      void _o;
      owned++;
    }
    if (owned >= MAX_ORGS_PER_IDENTITY) throw invalid();
    // The admin self-certifies: the certificate must verify under the key it presents.
    const stmt = enrollStatement(orgId, ctx.sender.toHexString(), person, signPub, ecdhPub, sha256(sealedContact));
    if (!sigOk(signPub, stmt, enrollSig)) throw invalid();

    ctx.db.org.insert({ id: orgId, name: orgName, admin: ctx.sender, adminSignPub: signPub, adminEcdhPub: ecdhPub, createdAt: ctx.timestamp });
    ctx.db.org_member.insert({
      id: 0n,
      orgId,
      identity: ctx.sender,
      displayName: person,
      signPub,
      ecdhPub,
      joinTag: new Uint8Array(HASH_LEN),
      sealedContact,
      state: 'active',
      enrollSig,
      revokeSig: new Uint8Array(0),
      enrolledAt: ctx.timestamp,
      approvedAt: ctx.timestamp,
      revokedAt: undefined,
    });
    console.log(`org created ${orgId}`);
  },
);

export const create_enroll_link = spacetimedb.reducer(
  { orgId: t.string(), codeHash: t.byteArray(), ttlHours: t.u32() },
  (ctx, { orgId, codeHash, ttlHours }) => {
    orgAdmin(ctx, orgId);
    if (!isValidEnrollTtlHours(ttlHours)) throw invalid();
    if (!bytesLen(codeHash, HASH_LEN)) throw invalid();
    const hex = bytesToHex(codeHash);
    if (ctx.db.enroll_link.codeHash.find(hex)) throw invalid();
    const now = micros(ctx.timestamp);
    let open = 0;
    for (const l of ctx.db.enroll_link.orgId.filter(orgId)) {
      if (!l.used && micros(l.expiresAt) > now) open++;
    }
    if (open >= MAX_OPEN_ENROLL_LINKS) throw invalid();
    ctx.db.enroll_link.insert({
      id: 0n,
      codeHash: hex,
      orgId,
      expiresAt: new Timestamp(now + BigInt(ttlHours) * 60n * MICROS_PER_MIN),
      used: false,
      usedBy: ctx.sender,
    });
  },
);

export const enroll_member = spacetimedb.reducer(
  {
    orgId: t.string(),
    code: t.byteArray(),
    displayName: t.string(),
    signPub: t.byteArray(),
    ecdhPub: t.byteArray(),
    joinTag: t.byteArray(),
    sealedContact: t.byteArray(),
  },
  (ctx, { orgId, code, displayName, signPub, ecdhPub, joinTag, sealedContact }) => {
    // Malformed requests are not brute-force attempts: reject them outright.
    if (!isUuidV4(orgId)) throw invalid();
    if (
      !bytesLen(code, INVITE_CODE_LEN) ||
      !validPub(signPub) ||
      !validPub(ecdhPub) ||
      !bytesLen(joinTag, HASH_LEN) ||
      !sealedOk(sealedContact)
    ) {
      throw invalid();
    }
    const name = validName(displayName);

    // Same per-identity limit as redeem_invite (the attempt log is shared, keyed "org:<id>").
    const now = micros(ctx.timestamp);
    const windowStart = now - BigInt(REDEEM_WINDOW_MIN) * MICROS_PER_MIN;
    let recent = 0;
    for (const a of ctx.db.join_attempt.identity.filter(ctx.sender)) {
      // Only failures count: a success needs a valid one-time code, so it cannot be a guess, and counting it would lock out a person who is legitimately coming back.
      if (!a.ok && micros(a.at) >= windowStart) recent++;
    }
    if (recent >= REDEEM_ATTEMPTS) return;

    // Every failure below records an attempt and RETURNS (a throw would roll the record back).
    const attemptKey = ORG_ATTEMPT_PREFIX + orgId;
    const failed = () => {
      ctx.db.join_attempt.insert({ id: 0n, identity: ctx.sender, incidentId: attemptKey, at: ctx.timestamp, ok: false });
    };

    const hex = bytesToHex(sha256(enrollLinkInput(orgId, code)));
    const link = ctx.db.enroll_link.codeHash.find(hex);
    const o = ctx.db.org.id.find(orgId);
    if (!link || !o || link.orgId !== orgId || link.used || micros(link.expiresAt) <= now) return failed();
    const members = orgMembersOf(ctx, orgId);
    const me = ctx.sender.toHexString();
    // A revoked row does not block a new enrollment. The old row stays revoked.
    if (members.some((m) => m.identity.toHexString() === me && m.state !== 'revoked')) return failed();
    // A revoked key stays revoked: the same person comes back only under fresh keys.
    if (members.some((m) => bytesEqualArr(m.signPub, signPub) || bytesEqualArr(m.ecdhPub, ecdhPub))) return failed();
    if (members.length >= MAX_ORG_MEMBERS) return failed();
    if (orgNameTaken(ctx, orgId, name)) return failed();

    ctx.db.enroll_link.id.update({ ...link, used: true, usedBy: ctx.sender });
    ctx.db.org_member.insert({
      id: 0n,
      orgId,
      identity: ctx.sender,
      displayName: name,
      signPub,
      ecdhPub,
      joinTag,
      sealedContact,
      state: 'pending',
      enrollSig: new Uint8Array(0),
      revokeSig: new Uint8Array(0),
      enrolledAt: ctx.timestamp,
      approvedAt: undefined,
      revokedAt: undefined,
    });
    ctx.db.join_attempt.insert({ id: 0n, identity: ctx.sender, incidentId: attemptKey, at: ctx.timestamp, ok: true });
  },
);

export const approve_member = spacetimedb.reducer(
  { orgId: t.string(), orgMemberId: t.u64(), enrollSig: t.byteArray() },
  (ctx, { orgId, orgMemberId, enrollSig }) => {
    const o = orgAdmin(ctx, orgId);
    if (!bytesLen(enrollSig, SIG_LEN)) throw invalid();
    const target = ctx.db.org_member.id.find(orgMemberId);
    if (!target || target.orgId !== orgId || target.state !== 'pending') throw invalid();
    // The certificate must be the admin's signature over exactly this row.
    if (!sigOk(o.adminSignPub, enrollStatementFor(orgId, target), enrollSig)) throw invalid();
    ctx.db.org_member.id.update({ ...target, state: 'active', enrollSig, approvedAt: ctx.timestamp });
  },
);

export const revoke_org_member = spacetimedb.reducer(
  { orgId: t.string(), orgMemberId: t.u64(), reason: t.string(), revokeSig: t.byteArray() },
  (ctx, { orgId, orgMemberId, reason, revokeSig }) => {
    const o = orgAdmin(ctx, orgId);
    if (!bytesLen(revokeSig, SIG_LEN)) throw invalid();
    if (typeof reason !== 'string' || reason.length > MAX_ORG_REASON * 4 || Array.from(reason).length > MAX_ORG_REASON) throw invalid();
    const target = ctx.db.org_member.id.find(orgMemberId);
    if (!target || target.orgId !== orgId) throw invalid();
    if (target.identity.toHexString() === o.admin.toHexString()) throw invalid(); // the admin cannot revoke themselves
    if (target.state !== 'pending' && target.state !== 'active') throw invalid();
    if (!sigOk(o.adminSignPub, orgRevokeStatement(orgId, orgMemberId, target.identity.toHexString(), reason), revokeSig)) throw invalid();
    ctx.db.org_member.id.update({ ...target, state: 'revoked', revokeSig, revokedAt: ctx.timestamp });
    console.log(`org member revoked in ${orgId}`);
  },
);

/** The caller drops their own roster row. The signature is theirs, over the fixed leave reason. */
export const leave_org = spacetimedb.reducer(
  { orgId: t.string(), orgMemberId: t.u64(), revokeSig: t.byteArray() },
  (ctx, { orgId, orgMemberId, revokeSig }) => {
    if (!isUuidV4(orgId) || !bytesLen(revokeSig, SIG_LEN)) throw invalid();
    const target = ctx.db.org_member.id.find(orgMemberId);
    if (!target || target.orgId !== orgId) throw invalid();
    if (target.identity.toHexString() !== ctx.sender.toHexString()) throw notAuthorized();
    if (target.state !== 'pending' && target.state !== 'active') throw invalid();
    if (!sigOk(target.signPub, orgRevokeStatement(orgId, orgMemberId, target.identity.toHexString(), ORG_LEAVE_REASON), revokeSig)) {
      throw invalid();
    }
    ctx.db.org_member.id.update({ ...target, state: 'revoked', revokeSig, revokedAt: ctx.timestamp });
    console.log(`org member left ${orgId}`);
  },
);

export const link_incident_org = spacetimedb.reducer(
  { incidentId: t.string(), orgId: t.string() },
  (ctx, { incidentId, orgId }) => {
    const { incident: inc } = activeCommander(ctx, incidentId);
    if (inc.closed || !isUuidV4(orgId)) throw invalid();
    if (!ctx.db.org.id.find(orgId)) throw invalid();
    if (ctx.db.incident_org.incidentId.find(incidentId)) throw invalid();
    const mine = myOrgRow(ctx, orgId);
    if (!mine || mine.state !== 'active') throw notAuthorized();
    ctx.db.incident_org.insert({ incidentId, orgId });
  },
);

const RosterPick = t.object('RosterPick', {
  orgMemberId: t.u64(),
  role: t.string(),
  admitSig: t.byteArray(),
  envelopes: t.array(EnvelopeAdmit),
});

export const add_from_roster = spacetimedb.reducer(
  { incidentId: t.string(), picks: t.array(RosterPick) },
  (ctx, { incidentId, picks }) => {
    const { incident: inc } = activeCommander(ctx, incidentId);
    if (inc.closed) throw invalid();
    if (picks.length < 1 || picks.length > MAX_ROSTER_PICKS) throw invalid();
    const link = ctx.db.incident_org.incidentId.find(incidentId);
    if (!link) throw invalid();
    const mine = myOrgRow(ctx, link.orgId);
    if (!mine || mine.state !== 'active') throw notAuthorized();

    const pickedIds = new Set<bigint>();
    for (const pick of picks) {
      if (pickedIds.has(pick.orgMemberId)) throw invalid();
      pickedIds.add(pick.orgMemberId);
      if (!isInvitableRole(pick.role) || !bytesLen(pick.admitSig, SIG_LEN)) throw invalid();
      const target = ctx.db.org_member.id.find(pick.orgMemberId);
      if (!target || target.orgId !== link.orgId || target.state !== 'active') throw invalid();
      const members = membersOf(ctx, incidentId);
      const tHex = target.identity.toHexString();
      const prior = members.filter((m) => m.identity.toHexString() === tHex);
      // A live incident membership still blocks. A revoked one stays in the log and a new row may be admitted.
      if (prior.some((m) => m.state !== 'revoked')) throw invalid();
      // A revoked key stays revoked: no row of this incident, in any state, may already carry these keys.
      if (members.some((m) => bytesEqualArr(m.signPub, target.signPub) || bytesEqualArr(m.ecdhPub, target.ecdhPub))) throw invalid();
      if (members.length >= MAX_MEMBERS) throw invalid();
      if (nameTaken(ctx, incidentId, target.displayName, tHex)) throw invalid();
      let priorCounter = 0n;
      for (const m of prior) if (m.lastCounter > priorCounter) priorCounter = m.lastCounter;
      // Same certificate as admit_member, built from the roster keys.
      if (!sigOk(inc.commanderSignPub, admitStatement(incidentId, tHex, pick.role, target.displayName, target.signPub, target.ecdhPub), pick.admitSig)) {
        throw invalid();
      }
      checkAdmitEnvelopes(ctx, incidentId, pick.role as Role, pick.envelopes);

      ctx.db.member.insert({
        id: 0n,
        incidentId,
        identity: target.identity,
        role: pick.role,
        state: 'active',
        displayName: target.displayName,
        signPub: target.signPub,
        ecdhPub: target.ecdhPub,
        joinTag: new Uint8Array(HASH_LEN),
        inviteCodeHash: rosterMarker(target.id),
        admitSig: pick.admitSig,
        revokeSig: new Uint8Array(0),
        lastCounter: priorCounter,
        joinedAt: ctx.timestamp,
        admittedAt: ctx.timestamp,
        revokedAt: undefined,
      });
      for (const e of pick.envelopes) {
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
    }
  },
);

export const request_page = spacetimedb.reducer(
  { incidentId: t.string(), pageId: t.string(), orgMemberIds: t.array(t.u64()) },
  (ctx, { incidentId, pageId, orgMemberIds }) => {
    const { incident: inc } = activeCommander(ctx, incidentId);
    if (inc.closed || !isUuidV4(pageId)) throw invalid();
    if (orgMemberIds.length < 1 || orgMemberIds.length > MAX_PAGE_TARGETS) throw invalid();
    if (new Set(orgMemberIds).size !== orgMemberIds.length) throw invalid();
    for (const _p of ctx.db.page.pageId.filter(pageId)) {
      void _p;
      throw invalid(); // page ids are single use; a retry uses a new id
    }
    const link = ctx.db.incident_org.incidentId.find(incidentId);
    if (!link) throw invalid();
    const mine = myOrgRow(ctx, link.orgId);
    if (!mine || mine.state !== 'active') throw notAuthorized();

    const now = micros(ctx.timestamp);
    // Per-incident budget: at most 20 page rows per rolling hour.
    let hourly = 0;
    for (const p of ctx.db.page.incidentId.filter(incidentId)) {
      if (micros(p.createdAt) + PAGE_INCIDENT_WINDOW_MICROS > now) hourly++;
    }
    if (hourly + orgMemberIds.length > MAX_PAGES_PER_INCIDENT_HOUR) throw new SenderError('slow down');

    const incidentMembers = membersOf(ctx, incidentId);
    for (const id of orgMemberIds) {
      const target = ctx.db.org_member.id.find(id);
      if (!target || target.orgId !== link.orgId || target.state !== 'active') throw invalid();
      const tHex = target.identity.toHexString();
      if (tHex === ctx.sender.toHexString()) throw invalid();
      // Must be an active incident member who was added from this roster row. An older revoked row for the same person does not count.
      const m = incidentMembers
        .filter((x) => x.identity.toHexString() === tHex)
        .sort((a, b) => stateRank(b.state) - stateRank(a.state) || (a.id > b.id ? -1 : 1))[0];
      if (!m || m.state !== 'active' || m.inviteCodeHash !== rosterMarker(target.id)) throw invalid();
      // One page per target per 60 seconds.
      for (const p of ctx.db.page.orgMemberId.filter(id)) {
        if (micros(p.createdAt) + PAGE_TARGET_COOLDOWN_MICROS > now) throw new SenderError('slow down');
      }
    }

    for (const id of orgMemberIds) {
      ctx.db.page.insert({
        id: 0n,
        pageId,
        incidentId,
        orgMemberId: id,
        status: 'requested',
        carrierReported: false,
        requestedBy: ctx.sender,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
    }
    ctx.db.page_sweep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(now + PAGE_TIMEOUT_MICROS), pageId });
  },
);

/**
 * Applies one pager status report. The pager identity is a parameter so the logic is easy to read; the reducer below passes the constant.
 */
function applyPagerUpdate(ctx: Ctx, pagerHex: string, pageId: string, orgMemberId: bigint, status: string) {
  if (!isIdentityHex(pagerHex) || ctx.sender.toHexString() !== pagerHex) throw notAuthorized();
  if (!isUuidV4(pageId) || !isPageStatus(status)) throw invalid();
  let row;
  for (const p of ctx.db.page.pageId.filter(pageId)) {
    if (p.orgMemberId === orgMemberId) row = p;
  }
  if (!row) throw invalid();
  // Forward only: requested, calling, ringing, then one terminal state. Terminal rows never change.
  if (isTerminalPage(row.status) || PAGE_RANK[status] <= PAGE_RANK[row.status]) throw invalid();
  ctx.db.page.id.update({
    ...row,
    status,
    carrierReported: status === 'acknowledged' ? true : row.carrierReported,
    updatedAt: ctx.timestamp,
  });
}

export const pager_update = spacetimedb.reducer(
  { pageId: t.string(), orgMemberId: t.u64(), status: t.string() },
  (ctx, { pageId, orgMemberId, status }) => applyPagerUpdate(ctx, PAGER_IDENTITY_HEX, pageId, orgMemberId, status),
);

/** Scheduled: 120 seconds after a page request, unfinished rows become no_answer. Only the scheduler may run it. */
export const page_timeout = spacetimedb.reducer({ onSchedule: page_sweep }, { arg: page_sweep.rowType }, (ctx, { arg }) => {
  if (!ctx.senderAuth.isInternal) throw notAuthorized();
  for (const p of [...ctx.db.page.pageId.filter(arg.pageId)]) {
    if (!isTerminalPage(p.status)) ctx.db.page.id.update({ ...p, status: 'no_answer', updatedAt: ctx.timestamp });
  }
});

// ---------------------------------------------------------------------------
// Presence (lifecycle reducers). They must never throw: a throwing connect hook
// refuses the connection.
// ---------------------------------------------------------------------------

/** Cap so a buggy client that never disconnects cleanly cannot wrap the counter. */
const MAX_PRESENCE_CONNECTIONS = 1000;

/** True when this identity holds any incident or org row, so its presence is worth keeping. */
function hasAnyMembership(ctx: Ctx, who: Ctx['sender']): boolean {
  for (const _m of ctx.db.member.identity.filter(who)) return true;
  for (const _o of ctx.db.org_member.identity.filter(who)) return true;
  return false;
}

export const presence_connect = spacetimedb.clientConnected((ctx) => {
  const row = ctx.db.presence.identity.find(ctx.sender);
  if (row) {
    const connections = Math.min(row.connections + 1, MAX_PRESENCE_CONNECTIONS);
    ctx.db.presence.identity.update({ ...row, connections, lastSeen: ctx.timestamp });
  } else {
    ctx.db.presence.insert({ identity: ctx.sender, connections: 1, lastSeen: ctx.timestamp });
  }
});

export const presence_disconnect = spacetimedb.clientDisconnected((ctx) => {
  const row = ctx.db.presence.identity.find(ctx.sender);
  if (!row) return;
  const connections = row.connections > 0 ? row.connections - 1 : 0;
  // Throwaway identities that never joined anything leave no trace once their last tab closes.
  if (connections === 0 && !hasAnyMembership(ctx, ctx.sender)) {
    ctx.db.presence.identity.delete(ctx.sender);
    return;
  }
  ctx.db.presence.identity.update({ ...row, connections, lastSeen: ctx.timestamp });
});

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

/**
 * Presence of the live people I can already see in my_members (same rule: active members see the
 * incident's pending and active members, a pending joiner sees only the commander and themselves).
 * Nobody else's presence leaks, and revoked people drop out.
 */
export const my_presence = spacetimedb.view({ name: 'my_presence', public: true }, t.array(presence.rowType), (ctx) => {
  const visible = new Map<string, Ctx['sender']>();
  const me = ctx.sender.toHexString();
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state === 'active') {
      // Revoked rows are skipped: nobody needs a removed person's presence (a live row of theirs still counts).
      for (const m of ctx.db.member.incidentId.filter(mine.incidentId)) {
        if (m.state !== 'revoked') visible.set(m.identity.toHexString(), m.identity);
      }
    } else if (mine.state === 'pending') {
      visible.set(me, ctx.sender);
      const inc = ctx.db.incident.id.find(mine.incidentId);
      if (inc) visible.set(inc.commander.toHexString(), inc.commander);
    }
  }
  const out = [];
  for (const who of visible.values()) {
    const row = ctx.db.presence.identity.find(who);
    if (row) out.push(row);
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

export const my_checkpoints = spacetimedb.view({ name: 'my_checkpoints', public: true }, t.array(checkpoint.rowType), (ctx) => {
  const out = [];
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state !== 'active' || !isRole(mine.role)) continue;
    for (const c of ctx.db.checkpoint.incidentId.filter(mine.incidentId)) {
      if (isChannel(c.kind) && canRead(mine.role, c.kind)) out.push(c);
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

// --- Org views ------------------------------------------------------------------

/** Orgs where the caller is an active member. */
export const my_org = spacetimedb.view({ name: 'my_org', public: true }, t.array(org.rowType), (ctx) => {
  const out = [];
  for (const m of ctx.db.org_member.identity.filter(ctx.sender)) {
    if (m.state !== 'active') continue;
    const o = ctx.db.org.id.find(m.orgId);
    if (o) out.push(o);
  }
  return out;
});

/** The caller's own roster rows (any state), so a pending or revoked phone can show where it stands. */
export const my_org_status = spacetimedb.view({ name: 'my_org_status', public: true }, t.array(org_member.rowType), (ctx) => {
  return [...ctx.db.org_member.identity.filter(ctx.sender)];
});

/**
 * Roster rows of orgs where the caller is active. The admin sees every row (to approve
 * pending ones); other members see active rows. sealedContact is ciphertext, so it may be included.
 */
export const my_roster = spacetimedb.view({ name: 'my_roster', public: true }, t.array(org_member.rowType), (ctx) => {
  const out = [];
  for (const mine of ctx.db.org_member.identity.filter(ctx.sender)) {
    if (mine.state !== 'active') continue;
    const o = ctx.db.org.id.find(mine.orgId);
    const isAdmin = !!o && o.admin.toHexString() === ctx.sender.toHexString();
    for (const m of ctx.db.org_member.orgId.filter(mine.orgId)) {
      if (isAdmin || m.state === 'active') out.push(m);
    }
  }
  return out;
});

/** Pages of incidents where the caller is an active member. */
export const my_pages = spacetimedb.view({ name: 'my_pages', public: true }, t.array(page.rowType), (ctx) => {
  const out = [];
  for (const mine of ctx.db.member.identity.filter(ctx.sender)) {
    if (mine.state !== 'active') continue;
    for (const p of ctx.db.page.incidentId.filter(mine.incidentId)) out.push(p);
  }
  return out;
});

// --- Pager-only views: rows only when the caller is PAGER_IDENTITY_HEX, otherwise empty. ---

const PagerOrgMember = t.object('PagerMemberRec', {
  orgId: t.string(),
  orgMemberId: t.u64(),
  identity: t.string(), // lowercase hex
  displayName: t.string(),
  signPub: t.byteArray(),
  ecdhPub: t.byteArray(),
  sealedContact: t.byteArray(),
  state: t.string(), // 'pending' | 'active' | 'revoked'
});

const PagerPage = t.object('PagerPageRec', {
  pageId: t.string(),
  incidentId: t.string(),
  orgMemberId: t.u64(),
  status: t.string(),
  requestedBy: t.string(), // lowercase hex identity of the commander who called request_page
});

function pagerOrgMemberRows(ctx: VCtx, pagerHex: string) {
  if (!isIdentityHex(pagerHex) || ctx.sender.toHexString() !== pagerHex) return [];
  return [...ctx.db.org_member.iter()].map((m) => ({
    orgId: m.orgId,
    orgMemberId: m.id,
    identity: m.identity.toHexString(),
    displayName: m.displayName,
    signPub: m.signPub,
    ecdhPub: m.ecdhPub,
    sealedContact: m.sealedContact,
    state: m.state,
  }));
}

function pagerPageRows(ctx: VCtx, pagerHex: string) {
  if (!isIdentityHex(pagerHex) || ctx.sender.toHexString() !== pagerHex) return [];
  return [...ctx.db.page.iter()].map((p) => ({
    pageId: p.pageId,
    incidentId: p.incidentId,
    orgMemberId: p.orgMemberId,
    status: p.status,
    requestedBy: p.requestedBy.toHexString(),
  }));
}

export const pager_org_member = spacetimedb.view({ name: 'pager_org_member', public: true }, t.array(PagerOrgMember), (ctx) =>
  pagerOrgMemberRows(ctx, PAGER_IDENTITY_HEX),
);

export const pager_page = spacetimedb.view({ name: 'pager_page', public: true }, t.array(PagerPage), (ctx) =>
  pagerPageRows(ctx, PAGER_IDENTITY_HEX),
);
