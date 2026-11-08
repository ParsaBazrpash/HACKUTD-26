// Client-side verification of every event (docs/PLAN.md 4.9).
//
// The server is untrusted. For each channel we process events in seq order and
// record a verdict per event. Nothing is silently dropped: a failing event is
// kept, marked, and turns the integrity report red.

import {
  admitStatement,
  bytesEqual,
  bytesToHex,
  checkpointStatement,
  eventSigInput,
  revokeStatement,
} from '@/spacetimedb/src/shared/encoding';
import { CHANNELS, type ChannelKind, canWrite, type MemberStateName, type Role } from '@/spacetimedb/src/shared/policy';
import { isKindAllowed, parsePayloadBytes } from '@/lib/protocol/events';
import type {
  ChannelIntegrity,
  FailureReason,
  IntegrityReport,
  MemberRef,
  VerifiedEvent,
  Verdict,
  WarningReason,
} from '@/lib/client/types';
import { computeEventHash, genesisHash } from './chain';
import { openSealedEvent } from './event';
import { importSignPub } from './keys';
import { verify as verifySig } from './sign';

export const CLOCK_DRIFT_MS = 5 * 60 * 1000;

export interface RosterMember {
  memberId: bigint;
  identityHex: string;
  role: Role;
  state: MemberStateName;
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  admitSig: Uint8Array;
  revokeSig: Uint8Array;
  revokedAtMicros?: bigint;
}

export interface RawEvent {
  channel: ChannelKind;
  seq: bigint;
  epoch: number;
  author: string; // identity hex
  clientEventId: string;
  authorCounter: bigint;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  signature: Uint8Array;
  serverTsMicros: bigint;
  prevHash: Uint8Array;
  hash: Uint8Array;
}

export interface HeadPin {
  seq: bigint;
  hash: Uint8Array;
}

/** A commander-signed attestation of a channel head (PLAN 4.10). */
export interface RawCheckpoint {
  channel: ChannelKind;
  seq: bigint;
  hash: Uint8Array;
  signature: Uint8Array;
}

export interface VerifyInput {
  incidentId: string;
  /** Commander keys pinned from the invite fingerprint (or created locally by the commander). */
  pinnedCommander: { signPub: Uint8Array; ecdhPub: Uint8Array };
  members: RosterMember[];
  channels: Partial<Record<ChannelKind, { events: RawEvent[]; serverHead?: HeadPin }>>;
  getChannelKey: (channel: ChannelKind, epoch: number) => CryptoKey | undefined;
  pinnedHeads: Partial<Record<ChannelKind, HeadPin>>;
  /** Checkpoints as the server presents them; every one is verified here. */
  checkpoints?: RawCheckpoint[];
}

/** One certified key an identity has held. A re-enrollment adds another. Old events keep verifying under the old key. */
interface HeldKey {
  signPub: Uint8Array;
  role: Role;
  certified: boolean;
  /** Set when this row is revoked and the revocation signature verifies. */
  revokedAtMicros?: bigint;
}

export interface CertifiedMember {
  member: RosterMember;
  ref: MemberRef;
  /** admitSig verifies under the pinned commander key for the row this entry displays. */
  certified: boolean;
  /** Revocation time of the displayed row, when that row is revoked and revokeSig verifies. */
  revokedAtMicros?: bigint;
  /** Every roster row for this identity, including an older revoked enrollment. */
  keys: HeldKey[];
}

export interface VerifyOutput {
  /** All events, ordered by (serverTs, channel order, seq). */
  events: VerifiedEvent[];
  report: IntegrityReport;
  roster: Map<string, CertifiedMember>;
  /** Heads that are safe to pin (only advances, only for fully verified prefixes). */
  newHeads: Partial<Record<ChannelKind, HeadPin>>;
}

const micros = (m: bigint): Date => new Date(Number(m / 1000n));

/** Verifies the roster against the pinned commander key. */
export async function verifyRoster(
  incidentId: string,
  pinned: VerifyInput['pinnedCommander'],
  members: RosterMember[],
): Promise<{ roster: Map<string, CertifiedMember>; failures: { identity: string; reason: string }[] }> {
  const roster = new Map<string, CertifiedMember>();
  const failures: { identity: string; reason: string }[] = [];
  let commanderKey: CryptoKey | null = null;
  try {
    commanderKey = await importSignPub(pinned.signPub);
  } catch {
    failures.push({ identity: '', reason: 'pinned commander key invalid' });
  }
  for (const m of members) {
    let certified = false;
    if (commanderKey && m.admitSig.length === 64) {
      if (m.role === 'commander') {
        // The commander row must carry exactly the pinned keys.
        if (!bytesEqual(m.signPub, pinned.signPub) || !bytesEqual(m.ecdhPub, pinned.ecdhPub)) {
          failures.push({ identity: m.identityHex, reason: 'commander keys do not match the pinned keys' });
        } else {
          certified = await verifySig(
            commanderKey,
            admitStatement(incidentId, m.identityHex, m.role, m.displayName, m.signPub, m.ecdhPub),
            m.admitSig,
          );
        }
      } else {
        certified = await verifySig(
          commanderKey,
          admitStatement(incidentId, m.identityHex, m.role, m.displayName, m.signPub, m.ecdhPub),
          m.admitSig,
        );
      }
    }
    // A pending member who was revoked before admission never had a certificate.
    const neverAdmitted = m.state === 'revoked' && m.admitSig.length === 0;
    if ((m.state === 'active' || m.state === 'revoked') && !certified && !neverAdmitted) {
      failures.push({ identity: m.identityHex, reason: 'missing or invalid admission certificate' });
    }
    let revokedAtMicros: bigint | undefined;
    if (m.state === 'revoked') {
      const ok =
        commanderKey !== null &&
        m.revokeSig.length === 64 &&
        (await verifySig(commanderKey, revokeStatement(incidentId, m.identityHex), m.revokeSig));
      if (!ok) failures.push({ identity: m.identityHex, reason: 'invalid revocation signature' });
      else if (m.revokedAtMicros === undefined) failures.push({ identity: m.identityHex, reason: 'revocation has no time' });
      else revokedAtMicros = m.revokedAtMicros;
    }
    const held: HeldKey = {
      signPub: m.signPub,
      role: m.role,
      certified,
      ...(revokedAtMicros !== undefined ? { revokedAtMicros } : {}),
    };
    const prev = roster.get(m.identityHex);
    const keys = prev ? [...prev.keys, held] : [held];
    const rank = (state: string) => (state === 'active' ? 3 : state === 'pending' ? 2 : state === 'revoked' ? 1 : 0);
    const showThis =
      !prev ||
      rank(m.state) > rank(prev.member.state) ||
      (rank(m.state) === rank(prev.member.state) && m.memberId >= prev.member.memberId);
    if (!showThis && prev) {
      roster.set(m.identityHex, { ...prev, keys });
    } else {
      roster.set(m.identityHex, {
        member: m,
        ref: { identity: m.identityHex, displayName: m.displayName, role: m.role },
        certified,
        keys,
        ...(revokedAtMicros !== undefined ? { revokedAtMicros } : {}),
      });
    }
  }
  return { roster, failures };
}

interface Work {
  raw: RawEvent;
  channelIdx: number;
  failures: Set<FailureReason>;
  warnings: Set<WarningReason>;
  details: Map<FailureReason, string>;
  payloadParsed?: VerifiedEvent['payload'];
  sentAt: Date | null;
}

const fail = (w: Work, r: FailureReason, detail?: string) => {
  w.failures.add(r);
  if (detail && !w.details.has(r)) w.details.set(r, detail);
};

export async function verifyIncident(input: VerifyInput): Promise<VerifyOutput> {
  const { incidentId } = input;
  const { roster, failures: rosterFailures } = await verifyRoster(incidentId, input.pinnedCommander, input.members);
  let commanderKey: CryptoKey | null = null;
  try {
    commanderKey = await importSignPub(input.pinnedCommander.signPub);
  } catch {
    commanderKey = null; // already reported by verifyRoster
  }
  const keyCache = new Map<string, CryptoKey | null>();
  const pubKey = async (signPub: Uint8Array): Promise<CryptoKey | null> => {
    const hex = bytesToHex(signPub);
    if (keyCache.has(hex)) return keyCache.get(hex) ?? null;
    let k: CryptoKey | null = null;
    try {
      k = await importSignPub(signPub);
    } catch {
      k = null;
    }
    keyCache.set(hex, k);
    return k;
  };

  const works: Work[] = [];
  const byChannel = new Map<ChannelKind, Work[]>();

  for (const [ci, channel] of CHANNELS.entries()) {
    const ch = input.channels[channel];
    if (!ch) continue;
    const sorted = [...ch.events].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
    const list: Work[] = [];
    let prev: RawEvent | null = null;
    let maxEpoch = -1;
    for (const raw of sorted) {
      const w: Work = { raw, channelIdx: ci, failures: new Set(), warnings: new Set(), details: new Map(), sentAt: null };
      // 1 and 2: sequence and hash chain
      const expectedSeq = prev ? prev.seq + 1n : 1n;
      if (prev && raw.seq === prev.seq) {
        fail(w, 'chain_broken', 'duplicate seq');
      } else if (raw.seq !== expectedSeq) {
        fail(w, 'gap', prev ? `expected seq ${expectedSeq}` : 'first delivered event is not seq 1');
      } else {
        const expectedPrev = prev ? prev.hash : genesisHash(incidentId, channel);
        if (!bytesEqual(raw.prevHash, expectedPrev)) fail(w, 'chain_broken', 'prevHash does not match previous event');
      }
      const recomputed = computeEventHash({
        incidentId,
        channel,
        epoch: raw.epoch,
        author: raw.author,
        clientEventId: raw.clientEventId,
        authorCounter: raw.authorCounter,
        iv: raw.iv,
        ciphertext: raw.ciphertext,
        signature: raw.signature,
        prevHash: raw.prevHash,
        seq: raw.seq,
        serverTsMicros: raw.serverTsMicros,
      });
      if (!bytesEqual(recomputed, raw.hash)) fail(w, 'chain_broken', 'stored hash does not match recomputed hash');

      // epochs never go backwards
      if (raw.epoch < maxEpoch) fail(w, 'stale_epoch');
      maxEpoch = Math.max(maxEpoch, raw.epoch);

      // 3 and 4: some certified key for this identity must sign the event, still be allowed to write, and not be revoked yet.
      // A later enrollment does not erase the key that signed earlier events.
      const held = (roster.get(raw.author)?.keys ?? []).filter((k) => k.certified);
      // The role of the key that signed this event: a later enrollment may carry another role without changing the past.
      let signerRole: Role | undefined;
      if (held.length === 0) {
        fail(w, 'unknown_author');
      } else {
        const sigInput = eventSigInput({
          incidentId,
          channel,
          epoch: raw.epoch,
          author: raw.author,
          clientEventId: raw.clientEventId,
          authorCounter: raw.authorCounter,
          iv: raw.iv,
          ciphertext: raw.ciphertext,
        });
        let matched = false;
        let authorized = false;
        let sawRevoked = false;
        let sawRole = false;
        for (const k of held) {
          const revoked = k.revokedAtMicros !== undefined && raw.serverTsMicros >= k.revokedAtMicros;
          const roleOk = canWrite(k.role, channel);
          const key = await pubKey(k.signPub);
          const sigOk = key !== null && (await verifySig(key, sigInput, raw.signature));
          if (sigOk) matched = true;
          if (sigOk && (signerRole === undefined || (!revoked && roleOk))) signerRole = k.role;
          if (revoked) sawRevoked = true;
          if (!roleOk) sawRole = true;
          if (sigOk && !revoked && roleOk) authorized = true;
        }
        if (!authorized) {
          const allRevoked = held.every((k) => k.revokedAtMicros !== undefined && raw.serverTsMicros >= k.revokedAtMicros);
          if (sawRevoked && (allRevoked || matched)) fail(w, 'revoked_author');
          if (!matched) fail(w, 'bad_signature');
          else if (sawRole) fail(w, 'not_permitted', 'role cannot write this channel');
        }
      }

      // 5 and 6: decrypt, parse, kind and role
      const chanKey = input.getChannelKey(channel, raw.epoch);
      if (!chanKey) {
        w.warnings.add('waiting_for_keys');
      } else {
        const pt = await openSealedEvent(
          {
            incidentId,
            channel,
            epoch: raw.epoch,
            author: raw.author,
            clientEventId: raw.clientEventId,
            authorCounter: raw.authorCounter,
          },
          raw.iv,
          raw.ciphertext,
          chanKey,
        );
        if (!pt) {
          fail(w, 'cannot_decrypt');
        } else {
          const parsed = parsePayloadBytes(pt);
          if (!parsed.ok) {
            fail(w, parsed.reason);
          } else {
            w.payloadParsed = parsed.payload;
            const sent = new Date(parsed.payload.sentAt);
            w.sentAt = Number.isNaN(sent.getTime()) ? null : sent;
            const cm = roster.get(raw.author);
            const kindRole = signerRole ?? cm?.member.role;
            if (cm && cm.certified && kindRole && !isKindAllowed(parsed.payload.kind, channel, kindRole)) {
              fail(w, 'not_permitted', `${parsed.payload.kind} not allowed for ${kindRole} in #${channel}`);
            }
            if (w.sentAt && Math.abs(w.sentAt.getTime() - Number(raw.serverTsMicros / 1000n)) > CLOCK_DRIFT_MS) {
              w.warnings.add('clock_drift');
            }
          }
        }
      }
      list.push(w);
      works.push(w);
      prev = raw;
    }
    byChannel.set(channel, list);
  }

  // 7: replay protection over the whole incident, in server order.
  const ordered = [...works].sort((a, b) => {
    if (a.raw.serverTsMicros !== b.raw.serverTsMicros) return a.raw.serverTsMicros < b.raw.serverTsMicros ? -1 : 1;
    if (a.channelIdx !== b.channelIdx) return a.channelIdx - b.channelIdx;
    return a.raw.seq < b.raw.seq ? -1 : a.raw.seq > b.raw.seq ? 1 : 0;
  });
  const seenIds = new Set<string>();
  const lastCounter = new Map<string, bigint>();
  for (const w of ordered) {
    if (seenIds.has(w.raw.clientEventId)) fail(w, 'replay', 'duplicate event id');
    else seenIds.add(w.raw.clientEventId);
    const last = lastCounter.get(w.raw.author);
    if (last !== undefined && w.raw.authorCounter <= last) fail(w, 'replay', 'author counter did not increase');
    else lastCounter.set(w.raw.author, w.raw.authorCounter);
  }

  // 8: pinned heads and the server's claimed head
  const channelReports: Partial<Record<ChannelKind, ChannelIntegrity>> = {};
  const newHeads: Partial<Record<ChannelKind, HeadPin>> = {};
  for (const [channel, list] of byChannel) {
    const channelFailures: ChannelIntegrity['failures'] = [];
    for (const w of list)
      for (const reason of w.failures) channelFailures.push({ seq: w.raw.seq, reason, detail: w.details.get(reason) });

    const last = list.length ? list[list.length - 1].raw : null;
    const pin = input.pinnedHeads[channel];
    let pinnedOk = true;
    if (pin) {
      const at = list.find((w) => w.raw.seq === pin.seq);
      if (!at) {
        pinnedOk = false;
        channelFailures.push({ seq: pin.seq, reason: 'history_rewritten', detail: 'pinned event is missing (rollback)' });
      } else if (!bytesEqual(at.raw.hash, pin.hash)) {
        pinnedOk = false;
        fail(at, 'history_rewritten', 'event hash differs from the pinned hash');
        channelFailures.push({ seq: pin.seq, reason: 'history_rewritten', detail: 'event hash differs from the pinned hash' });
      }
    }
    const serverHead = input.channels[channel]?.serverHead;
    if (serverHead) {
      const lastSeq = last ? last.seq : 0n;
      const lastHash = last ? last.hash : genesisHash(incidentId, channel);
      if (serverHead.seq > lastSeq) {
        channelFailures.push({ seq: serverHead.seq, reason: 'gap', detail: 'server reports events that were not delivered' });
      } else if (serverHead.seq === lastSeq && !bytesEqual(serverHead.hash, lastHash)) {
        channelFailures.push({ seq: serverHead.seq, reason: 'chain_broken', detail: 'channel head hash mismatch' });
      }
    }

    // Checkpoints: the commander signed this exact hash at this seq. A different hash,
    // a missing event (truncation) or a bad signature all mean the history was altered.
    let latestCheckpoint: ChannelIntegrity['latestCheckpoint'];
    const cps = (input.checkpoints ?? []).filter((c) => c.channel === channel).sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
    for (const cp of cps) {
      const sigOkCp =
        commanderKey !== null &&
        cp.signature.length === 64 &&
        (await verifySig(commanderKey, checkpointStatement(incidentId, channel, cp.seq, cp.hash), cp.signature));
      let good = sigOkCp;
      if (!sigOkCp) {
        channelFailures.push({ seq: cp.seq, reason: 'history_rewritten', detail: 'checkpoint signature does not verify under the commander key' });
      } else {
        const at = list.find((w) => w.raw.seq === cp.seq);
        if (!at) {
          good = false;
          channelFailures.push({ seq: cp.seq, reason: 'history_rewritten', detail: 'events before a signed checkpoint are missing (truncation)' });
        } else if (!bytesEqual(at.raw.hash, cp.hash)) {
          good = false;
          fail(at, 'history_rewritten', 'event hash differs from the commander-signed checkpoint');
          channelFailures.push({ seq: cp.seq, reason: 'history_rewritten', detail: 'event hash differs from the commander-signed checkpoint' });
        }
      }
      latestCheckpoint = { seq: cp.seq, hashHex: bytesToHex(cp.hash), verified: good };
    }

    // Safe new pin: end of the longest prefix with no failures at all.
    let safe: RawEvent | null = null;
    if (pinnedOk) {
      for (const w of list) {
        if (w.failures.size > 0) break;
        safe = w.raw;
      }
      if (safe && (!pin || safe.seq > pin.seq)) newHeads[channel] = { seq: safe.seq, hash: safe.hash };
    }

    channelReports[channel] = {
      ok: channelFailures.length === 0,
      eventsChecked: list.length,
      failures: channelFailures,
      head: last ? { seq: last.seq, hashHex: bytesToHex(last.hash) } : null,
      pinnedOk,
      waitingForKeys: list.some((w) => w.warnings.has('waiting_for_keys')),
      ...(latestCheckpoint ? { latestCheckpoint } : {}),
    };
  }

  const events: VerifiedEvent[] = ordered.map((w) => {
    const cm = roster.get(w.raw.author);
    const failures = [...w.failures];
    const verdict: Verdict = { ok: failures.length === 0, failures, warnings: [...w.warnings] };
    return {
      channel: CHANNELS[w.channelIdx],
      seq: w.raw.seq,
      eventId: w.raw.clientEventId,
      author: cm && cm.certified ? cm.ref : null,
      serverTs: micros(w.raw.serverTsMicros),
      sentAt: w.sentAt,
      payload: w.payloadParsed ?? null,
      verdict,
    };
  });

  const report: IntegrityReport = {
    ok: rosterFailures.length === 0 && Object.values(channelReports).every((c) => c!.ok),
    checkedAt: new Date(),
    channels: channelReports,
    rosterFailures,
  };
  return { events, report, roster, newHeads };
}
