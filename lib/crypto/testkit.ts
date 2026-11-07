// Test-only helpers: builds a small incident with real keys, certified members
// and a correctly chained event log, so tests can then tamper with it.
// Not imported by app code.

import { admitStatement, bytesToHex, revokeStatement } from '@/spacetimedb/src/shared/encoding';
import { CHANNELS, type ChannelKind, type Role, readableChannels } from '@/spacetimedb/src/shared/policy';
import { type Payload, serializePayload } from '@/lib/protocol/events';
import { computeEventHash, genesisHash } from './chain';
import { createSealedEvent } from './event';
import { type DeviceKeys, generateDeviceKeys } from './keys';
import { randomBytes } from './hash';
import { generateChannelKeyBytes, importChannelKey } from './seal';
import { sign } from './sign';
import type { RawEvent, RosterMember, VerifyInput } from './verify';

export interface TestMember {
  keys: DeviceKeys;
  identityHex: string;
  role: Role;
  displayName: string;
  row: RosterMember;
}

export class TestIncident {
  incidentId = crypto.randomUUID();
  members = new Map<string, TestMember>();
  channelKeys = new Map<string, CryptoKey>(); // `${kind}/${epoch}`
  rawKeys = new Map<string, Uint8Array>();
  events: Record<ChannelKind, RawEvent[]> = { record: [], command: [], privileged: [], technical: [] };
  counters = new Map<string, bigint>();
  clock = 1_800_000_000_000_000n; // micros
  commander!: TestMember;

  static async create(): Promise<TestIncident> {
    const t = new TestIncident();
    t.commander = await t.addMember('commander', 'Casey Commander');
    for (const kind of CHANNELS) {
      const raw = generateChannelKeyBytes();
      t.rawKeys.set(`${kind}/0`, raw);
      t.channelKeys.set(`${kind}/0`, await importChannelKey(raw));
    }
    return t;
  }

  async addMember(role: Role, displayName: string, state: 'active' | 'pending' = 'active'): Promise<TestMember> {
    const keys = await generateDeviceKeys();
    const identityHex = bytesToHex(randomBytes(32));
    let admitSig: Uint8Array = new Uint8Array(0);
    if (state === 'active') {
      const signer = role === 'commander' ? keys : this.commander.keys;
      admitSig = await sign(
        signer.signPriv,
        admitStatement(this.incidentId, identityHex, role, displayName, keys.signPub, keys.ecdhPub),
      );
    }
    const row: RosterMember = {
      memberId: BigInt(this.members.size + 1),
      identityHex,
      role,
      state,
      displayName,
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      admitSig,
      revokeSig: new Uint8Array(0),
    };
    const m: TestMember = { keys, identityHex, role, displayName, row };
    this.members.set(identityHex, m);
    return m;
  }

  async revoke(m: TestMember, atMicros: bigint): Promise<void> {
    m.row.state = 'revoked';
    m.row.revokedAtMicros = atMicros;
    m.row.revokeSig = await sign(this.commander.keys.signPriv, revokeStatement(this.incidentId, m.identityHex));
  }

  /** Appends a correctly formed event, as the module would. */
  async append(
    author: TestMember,
    channel: ChannelKind,
    payload: Payload,
    o: { epoch?: number; counter?: bigint; eventId?: string; serverTsMicros?: bigint } = {},
  ): Promise<RawEvent> {
    const epoch = o.epoch ?? 0;
    const counter = o.counter ?? (this.counters.get(author.identityHex) ?? 0n) + 1n;
    this.counters.set(author.identityHex, counter);
    const eventId = o.eventId ?? crypto.randomUUID();
    const list = this.events[channel];
    const prev = list[list.length - 1];
    const core = {
      incidentId: this.incidentId,
      channel,
      epoch,
      author: author.identityHex,
      clientEventId: eventId,
      authorCounter: counter,
    };
    const sealed = await createSealedEvent(
      core,
      serializePayload(payload),
      this.channelKeys.get(`${channel}/${epoch}`)!,
      author.keys.signPriv,
    );
    this.clock += 1_000_000n;
    const ev: RawEvent = {
      channel,
      seq: BigInt(list.length + 1),
      epoch,
      author: author.identityHex,
      clientEventId: eventId,
      authorCounter: counter,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      signature: sealed.signature,
      serverTsMicros: o.serverTsMicros ?? this.clock,
      prevHash: prev ? prev.hash : genesisHash(this.incidentId, channel),
      hash: new Uint8Array(32),
    };
    ev.hash = this.rehash(ev);
    list.push(ev);
    return ev;
  }

  /** Recomputes an event's chain hash from its (possibly modified) fields. */
  rehash(ev: RawEvent): Uint8Array {
    return computeEventHash({
      incidentId: this.incidentId,
      channel: ev.channel,
      epoch: ev.epoch,
      author: ev.author,
      clientEventId: ev.clientEventId,
      authorCounter: ev.authorCounter,
      iv: ev.iv,
      ciphertext: ev.ciphertext,
      signature: ev.signature,
      prevHash: ev.prevHash,
      seq: ev.seq,
      serverTsMicros: ev.serverTsMicros,
    });
  }

  /** Deep-ish copy so a test can tamper without affecting the original log. */
  cloneEvents(): Record<ChannelKind, RawEvent[]> {
    const out = { record: [], command: [], privileged: [], technical: [] } as Record<ChannelKind, RawEvent[]>;
    for (const c of CHANNELS)
      out[c] = this.events[c].map((e) => ({
        ...e,
        iv: e.iv.slice(),
        ciphertext: e.ciphertext.slice(),
        signature: e.signature.slice(),
        prevHash: e.prevHash.slice(),
        hash: e.hash.slice(),
      }));
    return out;
  }

  /** Verify input for a viewer with `role` (sees only readable channels and keys). */
  input(
    role: Role = 'commander',
    events: Record<ChannelKind, RawEvent[]> = this.events,
    pinnedHeads: VerifyInput['pinnedHeads'] = {},
  ): VerifyInput {
    const readable = new Set(readableChannels(role));
    const channels: VerifyInput['channels'] = {};
    for (const c of readable) channels[c] = { events: events[c] };
    return {
      incidentId: this.incidentId,
      pinnedCommander: { signPub: this.commander.keys.signPub, ecdhPub: this.commander.keys.ecdhPub },
      members: [...this.members.values()].map((m) => m.row),
      channels,
      getChannelKey: (c, e) => (readable.has(c) ? this.channelKeys.get(`${c}/${e}`) : undefined),
      pinnedHeads,
    };
  }
}

export const sentAtFor = (micros: bigint): string => new Date(Number(micros / 1000n)).toISOString();

/** A valid chat payload whose sentAt is near `micros`. */
export function chat(text: string, micros = 1_800_000_001_000_000n): Payload {
  return {
    v: 1,
    kind: 'chat.post',
    sentAt: sentAtFor(micros),
    body: { messageId: crypto.randomUUID(), text, mentions: [] },
  };
}

export function timeline(text: string, micros = 1_800_000_001_000_000n): Payload {
  return {
    v: 1,
    kind: 'timeline.add',
    sentAt: sentAtFor(micros),
    body: {
      entryId: crypto.randomUUID(),
      occurredAt: sentAtFor(micros),
      phase: 'detection_analysis',
      csf: 'DE.AE',
      text,
    },
  };
}
