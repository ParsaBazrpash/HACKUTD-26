// RealIncidentClient (docs/PLAN.md 6.4).
//
// Pipeline: backend rows (ciphertext and structure only) -> unwrap channel keys
// -> verifyIncident (the server is untrusted) -> foldEvents -> immutable
// snapshot for the UI. Every plaintext operation happens here, in the browser.
//
// Rules this file enforces for the rest of the product:
// - Only the pinned commander key can certify members. The server's roster is
//   data, never authority.
// - Channel keys are only ever wrapped for members whose admission certificate
//   verified under the pinned commander key.
// - A pending member is never admitted unless the invite secret proves the
//   link ("Link verified").
// - A revoked device wipes its keys and shows nothing.
// - With the passkey lock on, new device keys are stored only wrapped under the
//   passkey vault key, and a locked vault means no keys and nothing shown.
// - Errors shown to the UI never include key material or plaintext.

import {
  admitStatement,
  bytesEqual,
  bytesToHex,
  checkpointStatement,
  revokeStatement,
} from '@/spacetimedb/src/shared/encoding';
import {
  INVITE_TTL_DEFAULT_MIN,
  INVITE_TTL_MAX_MIN,
  isUuidV4,
  isValidDisplayName,
  normalizeDisplayName,
} from '@/spacetimedb/src/shared/limits';
import {
  CHANNELS,
  type ChannelKind,
  isChannel,
  isRole,
  type MemberStateName,
  readableChannels,
  type Role,
} from '@/spacetimedb/src/shared/policy';
import {
  isKindAllowed,
  PAYLOAD_VERSION,
  type Payload,
  type PayloadKind,
  serializePayload,
  TitleBodySchema,
} from '@/lib/protocol/events';
import { createSealedEvent } from '@/lib/crypto/event';
import {
  type DeviceKeys,
  fingerprintBytes,
  formatFingerprint,
  generateDeviceKeys,
  safetyCode,
} from '@/lib/crypto/keys';
import {
  buildInviteUrl,
  computeJoinTag,
  newInvite,
  parseInviteFragment,
  verifyJoinTag,
} from '@/lib/crypto/invite';
import { generateChannelKeyBytes, importChannelKey } from '@/lib/crypto/seal';
import {
  computeEnrollJoinTag,
  enrollLinkHash,
  orgSafetyCode,
  sealContact,
  signEnrollment,
  signPageRequest,
  signRevocation,
  verifyEnrollJoinTag,
  verifyRevocation,
  verifyEnrollment,
} from '@/lib/crypto/org';
import { sign } from '@/lib/crypto/sign';
import { defaultKeyStore, IncidentStore, type OrgPin, OrgStore, orgIdsOnDevice, type PinnedCommander } from '@/lib/crypto/store';
import {
  generateLockedDeviceKeys,
  generateLockedOrgKeys,
  isLockedDeviceKeys,
  openLockedDeviceKeys,
  openLockedOrgKeys,
  type VaultKey,
} from '@/lib/crypto/vault';
import { type HeadPin, type RawEvent, type RosterMember, verifyIncident } from '@/lib/crypto/verify';
import { b64urlDecode, b64urlEncode } from '@/lib/crypto/b64url';
import { randomBytes, sha256 } from '@/lib/crypto/hash';
import { importEcdhPub, importSignPub, isRawPublicKey } from '@/lib/crypto/keys';
import {
  buildEnrollUrl,
  isE164,
  isValidEnrollTtlHours,
  isValidOrgName,
  MAX_PAGE_BODY_BYTES,
  MAX_PAGE_TARGETS,
  normalizeOrgName,
  parseEnrollFragment,
  type PageRequestWire,
} from '@/lib/protocol/org';
import { MAX_ORG_REASON, SEALED_CONTACT_LEN } from '@/spacetimedb/src/shared/org';
import { isInvitableRole } from '@/spacetimedb/src/shared/policy';
import { unwrapChannelKey, wrapChannelKey } from '@/lib/crypto/wrap';
import { createStore, get as idbGet, set as idbSet, type UseStore } from 'idb-keyval';
import type { IncidentBackend, MemberRow, OrgBackend, OrgMemberRow } from './backend';
import { foldEvents } from './fold';
import { type DeviceVaultPort, getDeviceVault } from './passkey-lock';
import { SpacetimeBackend } from './spacetime-backend';
import {
  type ChatBody,
  type DeadlineBody,
  type DiscoveryBody,
  type EvidenceBody,
  type IncidentClient,
  type IncidentState,
  type IntegrityReport,
  type MemberView,
  type OrgView,
  type PageView,
  type ProfileBody,
  type RosterMember as OrgRosterMember,
  type ScopeBody,
  type StatusBody,
  type TaskBody,
  type TimelineBody,
  EMPTY_PROFILE,
} from './types';

/** Known, user-presentable failure. Anything else becomes a generic message. */
/** Events between automatic commander checkpoints (PLAN 4.10). */
const CHECKPOINT_EVERY = 10n;

/** Shown while this incident's keys are passkey-locked. */
export const DEVICE_LOCKED_MESSAGE = 'Your keys for this incident are locked. Unlock them with your passkey.';

export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}

export interface RealClientOptions {
  /** Origin used to build invite links, e.g. https://zerohour.example. */
  origin: string;
  /** Test hook: where to persist per-incident state. Defaults to IndexedDB. */
  storeFor?: (incidentId: string) => IncidentStore;
  now?: () => number;
  /** How long to wait for the server to reflect a write. Default 5000. */
  waitMs?: number;
  /**
   * Remembers which incident this browser last opened, so a reload or a new tab
   * on any page comes back to the same room. It holds an incident id only,
   * never keys. Omit it for no resume.
   */
  lastIncident?: {
    get: () => Promise<string | null>;
    set: (incidentId: string) => Promise<void>;
  };
  /** Passkey lock for device keys at rest. Omit for plain non-extractable keys only. */
  vault?: DeviceVaultPort;
  /** Where org keys, pins and the cached roster live. Defaults to the browser's key store. */
  keyStore?: UseStore;
  /** The pager's public ECDH key (raw, 65 bytes). Phone numbers are sealed to it. Without it, createOrg and enroll refuse. */
  pagerPub?: Uint8Array;
  /** Sends the signed page body to /api/page. Defaults to a same-origin fetch. */
  postPage?: (body: string) => Promise<{ ok: boolean; status?: number; error?: string; dialed?: number }>;
}

/** Shown while org keys are passkey-locked. */
export const ORG_LOCKED_MESSAGE = 'Your organization keys are locked. Unlock them with your passkey.';

/** One verified (or refused) roster row, as of the last refresh. */
interface RosterEntry {
  row: OrgMemberRow;
  /** The enrollment certificate verifies under the pinned admin key. */
  certified: boolean;
  /** Keys differ from the cached ones, or an active row has no valid certificate. Such a person cannot be added. */
  keyChanged: boolean;
  /** An admin-signed revocation for this person was verified, now or earlier. It is permanent on this device. */
  revoked: boolean;
}

interface OrgSnapshot {
  orgId: string;
  name: string;
  adminHex: string;
  adminSignPub: Uint8Array;
  adminEcdhPub: Uint8Array;
  myHex: string;
  myRole: 'admin' | 'member';
  pin: OrgPin;
  members: Map<string, RosterEntry>;
}

/** Marker the module stores in member.inviteCodeHash for people admitted through the roster. */
const ROSTER_MARKER_PREFIX = 'roster:';

/** The roster row a member was added under, from the marker the module stores, or undefined for an invite join. */
function rosterIdOf(inviteCodeHash: string): bigint | undefined {
  if (!inviteCodeHash.startsWith(ROSTER_MARKER_PREFIX)) return undefined;
  const raw = inviteCodeHash.slice(ROSTER_MARKER_PREFIX.length);
  return /^[0-9]{1,20}$/.test(raw) ? BigInt(raw) : undefined;
}

function membershipRank(state: string): number {
  if (state === 'active') return 3;
  if (state === 'pending') return 2;
  if (state === 'revoked') return 1;
  return 0;
}

/** Prefer a live membership over an older revoked row for the same person. */
function preferOwnRow<T extends { state: string; memberId: bigint }>(rows: T[]): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (
      !best ||
      membershipRank(row.state) > membershipRank(best.state) ||
      (membershipRank(row.state) === membershipRank(best.state) && row.memberId > best.memberId)
    ) {
      best = row;
    }
  }
  return best;
}

/**
 * The reason inside every org revocation signature. The module stores only the
 * signature, not the reason, so a verifier can rebuild the signed statement
 * only if the reason is fixed. The admin's free-text reason is only checked for length and is not sent.
 */
export const ORG_REVOKE_SIGNED_REASON = 'revoked by admin';

const roleLabel = (r: string): string => r.charAt(0).toUpperCase() + r.slice(1);

const micros = (m: bigint): Date => new Date(Number(m / 1000n));
const keyOf = (kind: string, epoch: number) => `${kind}/${epoch}`;

function emptyState(connection: IncidentState['connection'], at: Date, error?: string): IncidentState {
  return {
    connection,
    me: null,
    incident: null,
    status: null,
    members: [],
    channels: [],
    timeline: [],
    scope: [],
    tasks: [],
    profile: EMPTY_PROFILE,
    discovery: null,
    materiality: null,
    deadlineUpdates: {},
    evidence: [],
    integrity: { ok: true, checkedAt: at, channels: {}, rosterFailures: [] },
    org: null,
    roster: [],
    pages: [],
    ...(error ? { error } : {}),
  };
}

export class RealIncidentClient implements IncidentClient {
  private state: IncidentState;
  private readonly listeners = new Set<() => void>();
  private incidentId: string | null = null;
  private store: IncidentStore | null = null;
  private device: DeviceKeys | null = null;
  private readonly keys = new Map<string, CryptoKey>();
  private readonly failedEnvelopes = new Set<string>();
  private certified = new Map<string, boolean>();
  private wiped = false;
  private running: Promise<void> | null = null;
  private dirty = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeVault: () => void;
  private vaultKey: VaultKey | null;
  private readonly orgKeyCache = new Map<string, { vk: VaultKey; keys: DeviceKeys }>();
  /** Verified orgs I am an active member of, from the last refresh. */
  private orgSnaps = new Map<string, OrgSnapshot>();
  /** Identities that authored a verified event in the open incident, for PageView.joined. */
  private verifiedAuthors = new Set<string>();
  private orgWiped = new Set<string>();
  private readonly now: () => number;
  private readonly waitMs: number;

  constructor(
    private readonly backend: IncidentBackend,
    private readonly opts: RealClientOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.waitMs = opts.waitMs ?? 5000;
    this.state = emptyState(backend.connection(), new Date(this.now()));
    this.unsubscribe = backend.subscribe(() => void this.refresh());
    this.vaultKey = opts.vault?.key() ?? null;
    this.unsubscribeVault = opts.vault?.subscribe(() => this.onVaultChange()) ?? (() => undefined);
    if (opts.lastIncident) void this.resumeLast(opts.lastIncident);
  }

  /** Lock drops every key held in memory; unlock lets the next refresh unwrap them again. */
  private onVaultChange(): void {
    const next = this.opts.vault?.key() ?? null;
    if (next === this.vaultKey) return;
    this.vaultKey = next;
    this.device = null;
    this.keys.clear();
    this.orgKeyCache.clear();
    void this.refresh();
  }

  /** Reopens the last incident of this browser unless the page already chose one. */
  private async resumeLast(last: NonNullable<RealClientOptions['lastIncident']>): Promise<void> {
    try {
      const id = await last.get();
      if (!id || !isUuidV4(id)) return;
      await this.exclusive(async () => {
        if (this.incidentId) return;
        await this.activate(id, this.openStore(id));
      });
    } catch {
      // Resume is a convenience. A failure leaves the client with no open incident.
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.unsubscribeVault();
    this.listeners.clear();
  }

  // --- IncidentClient: state ---------------------------------------------------

  getState = (): IncidentState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Resolves when no refresh is pending or running. */
  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private setState(next: IncidentState): void {
    this.state = next;
    for (const l of [...this.listeners]) l();
  }

  // --- helpers ----------------------------------------------------------------

  private openStore(incidentId: string): IncidentStore {
    return this.opts.storeFor ? this.opts.storeFor(incidentId) : new IncidentStore(incidentId);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private waitFor(pred: () => boolean, ms = this.waitMs): Promise<boolean> {
    if (pred()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const state: { timer?: ReturnType<typeof setTimeout> } = {};
      const unsub = this.backend.subscribe(() => {
        if (pred()) {
          clearTimeout(state.timer);
          unsub();
          resolve(true);
        }
      });
      state.timer = setTimeout(() => {
        unsub();
        resolve(pred());
      }, ms);
    });
  }

  private async waitReady(): Promise<string> {
    await this.waitFor(() => this.backend.connection() === 'ready' && this.backend.identityHex() !== null, 15000);
    const me = this.backend.identityHex();
    if (this.backend.connection() !== 'ready' || !me) throw new ClientError('Not connected to the server');
    return me;
  }

  private cleanName(raw: string): string {
    const n = normalizeDisplayName(raw);
    if (!isValidDisplayName(n)) throw new ClientError('Enter a display name of 1 to 40 characters');
    return n;
  }

  private async activate(incidentId: string, store: IncidentStore): Promise<void> {
    this.incidentId = incidentId;
    this.store = store;
    this.device = null;
    this.keys.clear();
    this.failedEnvelopes.clear();
    this.certified = new Map();
    this.wiped = false;
    void this.opts.lastIncident?.set(incidentId).catch(() => undefined);
    await this.refresh();
  }

  /**
   * Fresh device keys for a new incident membership. With the passkey lock on
   * they are stored only wrapped under the vault key, so the vault must be
   * unlocked; this check runs before anything is sent to the server.
   */
  private async newDeviceKeys(store: IncidentStore): Promise<DeviceKeys> {
    const vault = this.opts.vault;
    if (vault && (await vault.isEnabled())) {
      const vk = vault.key();
      if (!vk) throw new ClientError('Unlock with your passkey first. This device locks new keys with a passkey.');
      const { record, keys } = await generateLockedDeviceKeys(vk, store.incidentId);
      await store.setLockedDeviceKeys(record);
      return keys;
    }
    const keys = await generateDeviceKeys();
    await store.setDeviceKeys(keys);
    return keys;
  }

  private payload(kind: PayloadKind, body: unknown): Payload {
    return { v: PAYLOAD_VERSION, kind, sentAt: new Date(this.now()).toISOString(), body } as Payload;
  }

  // --- refresh pipeline -------------------------------------------------------

  private refresh(): Promise<void> {
    this.dirty = true;
    if (!this.running) {
      this.running = (async () => {
        try {
          while (this.dirty) {
            this.dirty = false;
            let next: IncidentState;
            try {
              next = await this.compute();
            } catch (e) {
              const msg = e instanceof ClientError ? e.message : 'Could not process incident data';
              next = emptyState('error', new Date(this.now()), msg);
            }
            this.setState(next);
            this.maybeAutoCheckpoint(next);
          }
        } finally {
          this.running = null;
        }
      })();
    }
    return this.running;
  }

  /** The commander's client attests to a verified channel head every CHECKPOINT_EVERY events. */
  private autoCheckpointing = false;
  private maybeAutoCheckpoint(s: IncidentState): void {
    if (this.autoCheckpointing || s.connection !== 'ready' || s.me?.role !== 'commander' || s.me.state !== 'active') return;
    const due = Object.values(s.integrity.channels).some(
      (c) => c && c.ok && c.pinnedOk && c.head && c.head.seq - (c.latestCheckpoint?.seq ?? 0n) >= CHECKPOINT_EVERY,
    );
    if (!due) return;
    this.autoCheckpointing = true;
    void this.exclusive(() => this.postCheckpoints())
      .catch(() => undefined)
      .finally(() => {
        this.autoCheckpointing = false;
      });
  }

  /** Signs and posts a checkpoint for every readable channel whose verified head is past its last checkpoint. */
  private async postCheckpoints(): Promise<number> {
    const c = await this.commanderCtx();
    let posted = 0;
    for (const [kind, ch] of Object.entries(this.state.integrity.channels)) {
      if (!ch || !isChannel(kind) || !ch.ok || !ch.pinnedOk || !ch.head) continue;
      if (ch.head.seq <= (ch.latestCheckpoint?.seq ?? 0n)) continue;
      const ev = c.rows.events.find((e) => e.incidentId === c.id && e.channel === kind && e.seq === ch.head!.seq);
      if (!ev) continue;
      const signature = await sign(c.device.signPriv, checkpointStatement(c.id, kind, ev.seq, ev.hash));
      await this.backend.postCheckpoint({ incidentId: c.id, kind, seq: ev.seq, signature });
      posted++;
    }
    return posted;
  }

  private async loadDevice(mine: MemberRow, store: IncidentStore): Promise<DeviceKeys> {
    if (!this.device) {
      const rec = await store.getDeviceRecord();
      if (isLockedDeviceKeys(rec)) {
        const vk = this.opts.vault?.key();
        if (!vk) {
          this.keys.clear();
          throw new ClientError(DEVICE_LOCKED_MESSAGE);
        }
        const opened = await openLockedDeviceKeys(vk, rec, store.incidentId);
        if (!opened) throw new ClientError('This passkey does not unlock the keys for this incident');
        // The vault may have locked while unwrapping: never keep keys past a lock.
        if (this.opts.vault?.key() !== vk) throw new ClientError(DEVICE_LOCKED_MESSAGE);
        this.device = opened;
      } else if (rec) {
        this.device = rec;
      } else {
        // No keys of its own for this incident: it may be one I was added to from the roster, which uses my org keys.
        this.device = await this.orgKeysMatching(mine.signPub, mine.ecdhPub);
      }
    }
    const d = this.device;
    if (!d) throw new ClientError('This device does not hold the keys for this incident');
    if (!bytesEqual(d.signPub, mine.signPub) || !bytesEqual(d.ecdhPub, mine.ecdhPub)) {
      throw new ClientError('This device does not hold the keys for this incident');
    }
    return d;
  }

  private memberView(
    m: MemberRow,
    incidentId: string,
    certified: boolean,
    extra: { meHex: string; iAmCommander: boolean; linkVerified?: boolean },
  ): MemberView {
    const role = (isRole(m.role) ? m.role : 'executive') as Role;
    const state = (m.state === 'active' || m.state === 'revoked' ? m.state : 'pending') as MemberStateName;
    const showCode = m.identityHex === extra.meHex || (extra.iAmCommander && state === 'pending');
    return {
      identity: m.identityHex,
      displayName: m.displayName,
      role,
      memberId: m.memberId,
      state,
      fingerprint: formatFingerprint(fingerprintBytes(m.signPub, m.ecdhPub)),
      verified: certified,
      ...(extra.linkVerified !== undefined ? { linkVerified: extra.linkVerified } : {}),
      ...(rosterIdOf(m.inviteCodeHash) !== undefined ? { rosterId: rosterIdOf(m.inviteCodeHash)! } : {}),
      ...(showCode ? { safetyCode: safetyCode(incidentId, m.identityHex, m.signPub, m.ecdhPub) } : {}),
      joinedAt: micros(m.joinedAtMicros),
      ...(m.admittedAtMicros !== undefined ? { admittedAt: micros(m.admittedAtMicros) } : {}),
      ...(m.revokedAtMicros !== undefined ? { revokedAt: micros(m.revokedAtMicros) } : {}),
    };
  }

  private async compute(): Promise<IncidentState> {
    // The org part runs first: a roster-added member pins the commander from the verified, cached roster.
    const orgPart = await this.computeOrg();
    const base = await this.computeIncident();
    return { ...base, org: orgPart.org, roster: orgPart.roster, pages: this.pagesFor(base) };
  }

  private async computeIncident(): Promise<IncidentState> {
    const at = new Date(this.now());
    const connection = this.backend.connection();
    const id = this.incidentId;
    const store = this.store;
    if (!id || !store) return emptyState(connection, at);

    const rows = this.backend.rows();
    const mine = preferOwnRow(rows.status.filter((r) => r.incidentId === id));
    if (!mine) {
      return emptyState(
        connection,
        at,
        connection === 'ready' ? 'You are not a member of this incident' : undefined,
      );
    }
    const meHex = mine.identityHex;

    // Revoked: wipe everything local and show only the lock state.
    if (mine.state === 'revoked') {
      if (!this.wiped) {
        this.wiped = true;
        this.keys.clear();
        this.device = null;
        await store.wipe();
      }
      const base = emptyState(connection, at);
      return { ...base, me: this.memberView(mine, id, false, { meHex, iAmCommander: false }) };
    }

    const device = await this.loadDevice(mine, store);

    // Pin the commander. A joiner pins only if the server's incident row matches
    // the fingerprint from the invite link.
    const inc = rows.incidents.find((i) => i.id === id);
    let pinned: PinnedCommander | undefined = await store.getCommander();
    if (!pinned) {
      if (!inc) return { ...emptyState(connection, at), me: this.memberView(mine, id, false, { meHex, iAmCommander: false }) };
      const fp = fingerprintBytes(inc.commanderSignPub, inc.commanderEcdhPub);
      if (mine.inviteCodeHash.startsWith(ROSTER_MARKER_PREFIX)) {
        // Added from the roster: the commander must be a roster member whose certified keys are exactly these.
        const known = [...this.orgSnaps.values()].some((snap) =>
          [...snap.members.values()].some(
            (m) =>
              m.certified &&
              !m.keyChanged &&
              m.row.state === 'active' &&
              m.row.identityHex === inc.commanderHex &&
              bytesEqual(m.row.signPub, inc.commanderSignPub) &&
              bytesEqual(m.row.ecdhPub, inc.commanderEcdhPub),
          ),
        );
        if (!known) throw new ClientError('The incident commander does not match your organization roster');
      } else {
        const expected = await store.getExpectedFingerprint();
        if (!expected || !bytesEqual(fp, expected)) {
          throw new ClientError('This is not the incident you were invited to');
        }
      }
      pinned = { signPub: inc.commanderSignPub, ecdhPub: inc.commanderEcdhPub, fingerprint: fp };
      await store.setCommander(pinned);
    } else if (
      inc &&
      (!bytesEqual(inc.commanderSignPub, pinned.signPub) || !bytesEqual(inc.commanderEcdhPub, pinned.ecdhPub))
    ) {
      throw new ClientError('The server presented a different commander than the one you pinned');
    }

    const role = mine.role as Role;
    const readable: readonly ChannelKind[] = mine.state === 'active' && isRole(role) ? readableChannels(role) : [];
    const extraFailures: IntegrityReport['rosterFailures'] = [];

    // Unwrap any channel keys we do not hold yet (active members only).
    // An older enrollment can leave an envelope this key cannot open. That is a failure only when no envelope for that epoch opens.
    if (mine.state === 'active') {
      const missed = new Map<string, string>();
      for (const env of rows.envelopes) {
        if (env.incidentId !== id || env.recipientHex !== meHex || !isChannel(env.kind)) continue;
        const k = keyOf(env.kind, env.epoch);
        if (this.keys.has(k)) continue;
        const stored = await store.getChannelKey(env.kind, env.epoch);
        if (stored) {
          this.keys.set(k, stored);
          missed.delete(k);
          continue;
        }
        const tag = `${k}/${bytesToHex(env.wrapped)}`;
        if (this.failedEnvelopes.has(tag)) {
          missed.set(k, `key envelope ${k} did not authenticate`);
          continue;
        }
        const raw = await unwrapChannelKey(
          device.ecdhPriv,
          pinned.ecdhPub,
          { incidentId: id, kind: env.kind, epoch: env.epoch, recipientIdentityHex: meHex },
          { wrapped: env.wrapped, iv: env.iv },
        );
        if (!raw) {
          this.failedEnvelopes.add(tag);
          missed.set(k, `key envelope ${k} did not authenticate`);
          continue;
        }
        const ck = await importChannelKey(raw);
        raw.fill(0);
        await store.setChannelKey(env.kind, env.epoch, ck);
        this.keys.set(k, ck);
        missed.delete(k);
      }
      for (const reason of missed.values()) extraFailures.push({ identity: '', reason });
    }

    // Verify.
    const memberRows = rows.members.filter((m) => m.incidentId === id);
    const roster: RosterMember[] = [];
    for (const m of memberRows) {
      if (!isRole(m.role)) {
        extraFailures.push({ identity: m.identityHex, reason: 'unknown role' });
        continue;
      }
      roster.push({
        memberId: m.memberId,
        identityHex: m.identityHex,
        role: m.role,
        state: (m.state === 'active' || m.state === 'revoked' ? m.state : 'pending') as MemberStateName,
        displayName: m.displayName,
        signPub: m.signPub,
        ecdhPub: m.ecdhPub,
        admitSig: m.admitSig,
        revokeSig: m.revokeSig,
        revokedAtMicros: m.revokedAtMicros,
      });
    }
    const channels: Partial<Record<ChannelKind, { events: RawEvent[]; serverHead?: HeadPin }>> = {};
    const pinnedHeads: Partial<Record<ChannelKind, HeadPin>> = {};
    for (const kind of readable) {
      const ch = rows.channels.find((c) => c.incidentId === id && c.kind === kind);
      channels[kind] = {
        events: rows.events.filter((e) => e.incidentId === id && e.channel === kind),
        ...(ch ? { serverHead: { seq: ch.headSeq, hash: ch.headHash } } : {}),
      };
      const head = await store.getHead(kind);
      if (head) pinnedHeads[kind] = head;
    }
    const out = await verifyIncident({
      incidentId: id,
      pinnedCommander: { signPub: pinned.signPub, ecdhPub: pinned.ecdhPub },
      members: roster,
      channels,
      getChannelKey: (c, e) => this.keys.get(keyOf(c, e)),
      pinnedHeads,
      checkpoints: rows.checkpoints.flatMap((c) =>
        c.incidentId === id && isChannel(c.kind) && readable.includes(c.kind)
          ? [{ channel: c.kind, seq: c.seq, hash: c.hash, signature: c.signature }]
          : [],
      ),
    });
    for (const [kind, head] of Object.entries(out.newHeads)) {
      if (head && isChannel(kind)) await store.advanceHead(kind, head);
    }
    const report = out.report;
    if (extraFailures.length) {
      report.rosterFailures.push(...extraFailures);
      report.ok = false;
    }
    this.certified = new Map([...out.roster].map(([h, cm]) => [h, cm.certified]));
    this.verifiedAuthors = new Set(out.events.flatMap((e) => (e.verdict.ok && e.author ? [e.author.identity] : [])));

    // Members.
    const iAmCommander = mine.role === 'commander' && mine.state === 'active';
    const views: MemberView[] = [];
    for (const m of memberRows) {
      let linkVerified: boolean | undefined;
      if (iAmCommander && m.state === 'pending') {
        const inv = await store.getInvite(m.inviteCodeHash);
        linkVerified = inv
          ? await verifyJoinTag(
              inv.secret,
              { incidentId: id, identityHex: m.identityHex, displayName: m.displayName, signPub: m.signPub, ecdhPub: m.ecdhPub },
              m.joinTag,
            )
          : false;
      }
      views.push(this.memberView(m, id, out.roster.get(m.identityHex)?.certified ?? false, { meHex, iAmCommander, linkVerified }));
    }
    views.sort((a, b) =>
      a.role === 'commander' ? -1 : b.role === 'commander' ? 1 : Number(a.joinedAt) - Number(b.joinedAt),
    );
    const me = views.find((v) => v.memberId === mine.memberId) ?? views.find((v) => v.identity === meHex) ?? null;
    const commander = views.find((v) => v.role === 'commander' && inc && v.identity === inc.commanderHex) ?? null;

    const folded = foldEvents(out.events, views, readable);
    const { title, ...foldedRest } = folded;
    return {
      ...foldedRest,
      connection,
      me,
      incident: inc && commander ? { id, title: title ?? '', createdAt: micros(inc.createdAtMicros), commander } : null,
      members: views,
      integrity: report,
      org: null,
      roster: [],
      pages: [],
    };
  }

  // --- action context ---------------------------------------------------------

  private async ctx() {
    const id = this.incidentId;
    const store = this.store;
    if (!id || !store) throw new ClientError('No incident is open');
    const rows = this.backend.rows();
    const mine = preferOwnRow(rows.status.filter((r) => r.incidentId === id));
    if (!mine || mine.state !== 'active' || !isRole(mine.role)) {
      throw new ClientError('You are not an active member of this incident');
    }
    const device = await this.loadDevice(mine, store);
    const pinned = await store.getCommander();
    if (!pinned) throw new ClientError('The commander is not pinned yet');
    return { id, store, rows, mine, role: mine.role as Role, device, pinned, myHex: mine.identityHex };
  }

  private async commanderCtx() {
    const c = await this.ctx();
    if (c.role !== 'commander') throw new ClientError('Only the commander can do this');
    await this.refresh();
    return { ...c, rows: this.backend.rows() };
  }

  /** The commander re-derives raw channel key bytes from its own envelope. */
  private async rawChannelKey(c: Awaited<ReturnType<RealIncidentClient['ctx']>>, kind: ChannelKind, epoch: number): Promise<Uint8Array> {
    const env = c.rows.envelopes.find(
      (e) => e.incidentId === c.id && e.kind === kind && e.epoch === epoch && e.recipientHex === c.myHex,
    );
    const raw = env
      ? await unwrapChannelKey(
          c.device.ecdhPriv,
          c.pinned.ecdhPub,
          { incidentId: c.id, kind, epoch, recipientIdentityHex: c.myHex },
          { wrapped: env.wrapped, iv: env.iv },
        )
      : null;
    if (!raw) throw new ClientError(`Missing channel key ${kind}/${epoch}`);
    return raw;
  }

  // --- lifecycle --------------------------------------------------------------

  async createIncident(i: { title: string; displayName: string }): Promise<{ incidentId: string }> {
    const name = this.cleanName(i.displayName);
    const title = TitleBodySchema.safeParse({ title: i.title.trim() });
    if (!title.success) throw new ClientError('Enter an incident title of 1 to 120 characters');
    const myHex = await this.waitReady();
    const incidentId = crypto.randomUUID();
    const store = this.openStore(incidentId);
    // An active org member starts the incident with their org keys, so roster members can verify the commander from the roster.
    await this.refresh();
    const orgSnap = [...this.orgSnaps.values()][0];
    if (!orgSnap) await this.refuseIfOrgKeysHeld();
    const keys = orgSnap ? await this.orgKeys(orgSnap.orgId) : await this.newDeviceKeys(store);
    await store.setCommander({
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
      fingerprint: fingerprintBytes(keys.signPub, keys.ecdhPub),
    });
    const envelopes: { kind: string; wrapped: Uint8Array; iv: Uint8Array }[] = [];
    for (const kind of CHANNELS) {
      const raw = generateChannelKeyBytes();
      const w = await wrapChannelKey(
        keys.ecdhPriv,
        keys.ecdhPub,
        { incidentId, kind, epoch: 0, recipientIdentityHex: myHex },
        raw,
      );
      envelopes.push({ kind, wrapped: w.wrapped, iv: w.iv });
      await store.setChannelKey(kind, 0, await importChannelKey(raw));
      raw.fill(0);
    }
    const admitSig = await sign(
      keys.signPriv,
      admitStatement(incidentId, myHex, 'commander', name, keys.signPub, keys.ecdhPub),
    );
    try {
      await this.backend.createIncident({
        incidentId,
        signPub: keys.signPub,
        ecdhPub: keys.ecdhPub,
        displayName: name,
        admitSig,
        envelopes,
      });
    } catch {
      await store.wipe();
      throw new ClientError('Could not create the incident');
    }
    await this.activate(incidentId, store);
    const ok = await this.waitFor(() =>
      this.backend.rows().status.some((r) => r.incidentId === incidentId && r.state === 'active'),
    );
    if (!ok) throw new ClientError('The server did not confirm the new incident');
    await this.refresh();
    await this.append('record', this.payload('incident.title', { title: title.data.title }));
    return { incidentId };
  }

  async openIncident(incidentId: string): Promise<void> {
    if (!isUuidV4(incidentId)) throw new ClientError('Invalid incident id');
    await this.activate(incidentId, this.openStore(incidentId));
  }

  async createInvite(i: {
    role: 'counsel' | 'technical' | 'executive';
    ttlMinutes?: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    const ttl = i.ttlMinutes ?? INVITE_TTL_DEFAULT_MIN;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > INVITE_TTL_MAX_MIN) throw new ClientError('Invalid invite lifetime');
    return this.exclusive(async () => {
      const c = await this.commanderCtx();
      const inv = newInvite(c.id);
      const codeHashHex = bytesToHex(inv.codeHash);
      const expiresAtMs = this.now() + ttl * 60_000;
      await c.store.setInvite(codeHashHex, { secret: inv.secret, role: i.role, expiresAtMs });
      try {
        await this.backend.createInvite({ incidentId: c.id, codeHash: inv.codeHash, role: i.role, ttlMinutes: ttl });
      } catch {
        await c.store.delInvite(codeHashHex);
        throw new ClientError('Could not create the invite');
      }
      const url = buildInviteUrl(this.opts.origin, {
        incidentId: c.id,
        code: inv.code,
        secret: inv.secret,
        commanderFingerprint: fingerprintBytes(c.device.signPub, c.device.ecdhPub),
        role: i.role,
      });
      return { url, expiresAt: new Date(expiresAtMs) };
    });
  }

  async redeemInvite(i: { fragment: string; displayName: string }): Promise<void> {
    const inv = parseInviteFragment(i.fragment);
    if (!inv) throw new ClientError('This invite link is not valid');
    const name = this.cleanName(i.displayName);
    const myHex = await this.waitReady();
    const store = this.openStore(inv.incidentId);
    const before = this.backend.rows();
    // Already redeemed on this device: just open it. Never replace live keys.
    // A revoked membership is not live. Its keys stay revoked, so a new invite starts over with fresh keys.
    if (
      (await store.getDeviceRecord()) &&
      before.status.some((r) => r.incidentId === inv.incidentId && (r.state === 'pending' || r.state === 'active'))
    ) {
      await this.activate(inv.incidentId, store);
      return;
    }
    if (before.status.some((r) => r.incidentId === inv.incidentId && r.state === 'revoked')) await store.wipe();
    const keys = await this.newDeviceKeys(store);
    await store.setExpectedFingerprint(inv.commanderFingerprint);
    const joinTag = await computeJoinTag(inv.secret, {
      incidentId: inv.incidentId,
      identityHex: myHex,
      displayName: name,
      signPub: keys.signPub,
      ecdhPub: keys.ecdhPub,
    });
    try {
      await this.backend.redeemInvite({
        incidentId: inv.incidentId,
        code: inv.code,
        displayName: name,
        signPub: keys.signPub,
        ecdhPub: keys.ecdhPub,
        joinTag,
      });
    } catch {
      await store.wipe();
      throw new ClientError('This invite link could not be used');
    }
    // The module records failures and returns normally, so look for the result.
    // An older revoked row does not count: wait for a new row that carries the keys just made.
    const joined = await this.waitFor(() =>
      this.backend
        .rows()
        .status.some((r) => r.incidentId === inv.incidentId && r.state !== 'revoked' && bytesEqual(r.signPub, keys.signPub)),
    );
    if (!joined) {
      await store.wipe();
      throw new ClientError(
        'This invite link could not be used. It may be expired or already used, the name may be taken, or there were too many failed tries (wait 10 minutes).',
      );
    }
    await this.activate(inv.incidentId, store);
  }

  async admitMember(memberId: bigint): Promise<void> {
    return this.exclusive(async () => {
      const c = await this.commanderCtx();
      const target = c.rows.members.find((m) => m.incidentId === c.id && m.memberId === memberId);
      if (!target || target.state !== 'pending' || !isRole(target.role)) throw new ClientError('That member cannot be admitted');
      // Only admit when the invite secret proves this is the person the link was made for.
      const inv = await c.store.getInvite(target.inviteCodeHash);
      const linkOk =
        inv !== undefined &&
        (await verifyJoinTag(
          inv.secret,
          { incidentId: c.id, identityHex: target.identityHex, displayName: target.displayName, signPub: target.signPub, ecdhPub: target.ecdhPub },
          target.joinTag,
        ));
      if (!linkOk) throw new ClientError('Unverified: do not admit. The join request does not match the invite link.');
      const envelopes: { kind: string; epoch: number; wrapped: Uint8Array; iv: Uint8Array }[] = [];
      for (const kind of readableChannels(target.role)) {
        const ch = c.rows.channels.find((x) => x.incidentId === c.id && x.kind === kind);
        if (!ch) throw new ClientError('Channel state is missing');
        for (let e = 0; e <= ch.currentEpoch; e++) {
          const raw = await this.rawChannelKey(c, kind, e);
          const w = await wrapChannelKey(
            c.device.ecdhPriv,
            target.ecdhPub,
            { incidentId: c.id, kind, epoch: e, recipientIdentityHex: target.identityHex },
            raw,
          );
          raw.fill(0);
          envelopes.push({ kind, epoch: e, wrapped: w.wrapped, iv: w.iv });
        }
      }
      const admitSig = await sign(
        c.device.signPriv,
        admitStatement(c.id, target.identityHex, target.role, target.displayName, target.signPub, target.ecdhPub),
      );
      try {
        await this.backend.admitMember({ incidentId: c.id, memberId, admitSig, envelopes });
      } catch {
        throw new ClientError('Could not admit the member');
      }
      await this.append(
        'record',
        this.payload('roster.admit', {
          memberIdentity: target.identityHex,
          role: target.role,
          displayName: target.displayName,
        }),
        true,
      );
    });
  }

  async revokeMember(memberId: bigint, reason: string): Promise<void> {
    return this.exclusive(() => this.revokeMemberInChain(memberId, reason));
  }

  /** Caller already holds the exclusive lock. */
  private async revokeMemberInChain(memberId: bigint, reason: string): Promise<void> {
    const c = await this.commanderCtx();
      const target = c.rows.members.find((m) => m.incidentId === c.id && m.memberId === memberId);
      if (!target || !isRole(target.role) || target.role === 'commander' || target.state === 'revoked') {
        throw new ClientError('That member cannot be revoked');
      }
      const rotations: {
        kind: string;
        newEpoch: number;
        raw: Uint8Array;
        envelopes: { recipientHex: string; wrapped: Uint8Array; iv: Uint8Array }[];
      }[] = [];
      if (target.state === 'active') {
        for (const kind of readableChannels(target.role)) {
          const ch = c.rows.channels.find((x) => x.incidentId === c.id && x.kind === kind);
          if (!ch) throw new ClientError('Channel state is missing');
          const newEpoch = ch.currentEpoch + 1;
          const raw = generateChannelKeyBytes();
          const envs: { recipientHex: string; wrapped: Uint8Array; iv: Uint8Array }[] = [];
          for (const m of c.rows.members) {
            if (m.incidentId !== c.id || m.state !== 'active' || m.memberId === target.memberId || !isRole(m.role)) continue;
            if (!readableChannels(m.role).includes(kind)) continue;
            // Never hand a key to someone whose certificate does not verify.
            if (!this.certified.get(m.identityHex)) {
              throw new ClientError('Cannot rotate keys: a member has no valid admission certificate');
            }
            const w = await wrapChannelKey(
              c.device.ecdhPriv,
              m.ecdhPub,
              { incidentId: c.id, kind, epoch: newEpoch, recipientIdentityHex: m.identityHex },
              raw,
            );
            envs.push({ recipientHex: m.identityHex, wrapped: w.wrapped, iv: w.iv });
          }
          rotations.push({ kind, newEpoch, raw, envelopes: envs });
        }
      }
      const revokeSig = await sign(c.device.signPriv, revokeStatement(c.id, target.identityHex));
      try {
        await this.backend.revokeMember({
          incidentId: c.id,
          memberId,
          revokeSig,
          rotations: rotations.map(({ kind, newEpoch, envelopes }) => ({ kind, newEpoch, envelopes })),
        });
      } catch {
        for (const r of rotations) r.raw.fill(0);
        throw new ClientError('Could not revoke the member');
      }
      // New epoch keys are stored only after the server accepted the rotation.
      for (const r of rotations) {
        const ck = await importChannelKey(r.raw);
        r.raw.fill(0);
        await c.store.setChannelKey(r.kind as ChannelKind, r.newEpoch, ck);
        this.keys.set(keyOf(r.kind, r.newEpoch), ck);
      }
      await this.waitFor(() =>
        rotations.every((r) =>
          this.backend.rows().channels.some((ch) => ch.incidentId === c.id && ch.kind === r.kind && ch.currentEpoch >= r.newEpoch),
        ),
      );
      await this.append(
        'record',
        this.payload('roster.revoke', { memberIdentity: target.identityHex, reason: reason.slice(0, 500) }),
        true,
      );
  }

  // --- appending events -------------------------------------------------------

  /** `inChain` is true when the caller already holds the exclusive lock. */
  private append(channel: ChannelKind, payload: Payload, inChain = false): Promise<void> {
    const run = async () => {
      const eventId = crypto.randomUUID();
      for (let attempt = 0; ; attempt++) {
        const c = await this.ctx();
        if (!isKindAllowed(payload.kind, channel, c.role)) throw new ClientError('Your role cannot post this');
        const ch = c.rows.channels.find((x) => x.incidentId === c.id && x.kind === channel);
        if (!ch) throw new ClientError('Channel is not available');
        let key = this.keys.get(keyOf(channel, ch.currentEpoch));
        if (!key) {
          await this.refresh();
          key = this.keys.get(keyOf(channel, ch.currentEpoch));
        }
        if (!key) throw new ClientError('Waiting for channel keys');
        const stored = await c.store.getCounter();
        const counter = (stored > c.mine.lastCounter ? stored : c.mine.lastCounter) + 1n;
        const sealed = await createSealedEvent(
          { incidentId: c.id, channel, epoch: ch.currentEpoch, author: c.myHex, clientEventId: eventId, authorCounter: counter },
          serializePayload(payload),
          key,
          c.device.signPriv,
        );
        try {
          await this.backend.appendEvent({
            incidentId: c.id,
            kind: channel,
            epoch: ch.currentEpoch,
            clientEventId: eventId,
            authorCounter: counter,
            iv: sealed.iv,
            ciphertext: sealed.ciphertext,
            signature: sealed.signature,
          });
          await c.store.advanceCounter(counter);
          return;
        } catch {
          await this.refresh();
          // The first try may have landed even though the call failed: do not post twice.
          if (this.backend.rows().events.some((e) => e.clientEventId === eventId)) {
            await c.store.advanceCounter(counter);
            return;
          }
          if (attempt >= 1) throw new ClientError('Could not send. Check your connection and try again.');
        }
      }
    };
    return inChain ? run() : this.exclusive(run);
  }

  setStatus(b: StatusBody): Promise<void> {
    return this.append('record', this.payload('status.set', b));
  }
  addTimelineEntry(b: Omit<TimelineBody, 'entryId'>): Promise<void> {
    return this.append('record', this.payload('timeline.add', { ...b, entryId: crypto.randomUUID() }));
  }
  upsertScopeItem(b: ScopeBody): Promise<void> {
    return this.append('record', this.payload('scope.set', b));
  }
  upsertTask(b: TaskBody): Promise<void> {
    return this.append('record', this.payload('task.set', b));
  }
  setProfile(b: ProfileBody): Promise<void> {
    return this.append('record', this.payload('profile.set', b));
  }
  recordDiscovery(b: DiscoveryBody): Promise<void> {
    return this.append('record', this.payload('legal.discovery', b));
  }
  recordMateriality(b: DiscoveryBody): Promise<void> {
    return this.append('record', this.payload('legal.materiality', b));
  }
  updateDeadline(b: DeadlineBody): Promise<void> {
    return this.append('record', this.payload('deadline.update', b));
  }
  addEvidence(b: Omit<EvidenceBody, 'evidenceId'>): Promise<void> {
    return this.append('record', this.payload('evidence.add', { ...b, evidenceId: crypto.randomUUID() }));
  }
  postMessage(channel: 'command' | 'privileged' | 'technical', b: Omit<ChatBody, 'messageId'>): Promise<void> {
    return this.append(channel, this.payload('chat.post', { ...b, messageId: crypto.randomUUID() }));
  }

  // --- integrity --------------------------------------------------------------

  async verifyAll(): Promise<IntegrityReport> {
    await this.refresh();
    return this.state.integrity;
  }

  async signCheckpoint(): Promise<void> {
    await this.exclusive(async () => {
      try {
        await this.postCheckpoints();
      } catch (e) {
        if (e instanceof ClientError) throw e;
        throw new ClientError('Could not sign a checkpoint');
      }
    });
  }

  // --- org roster and paging ------------------------------------------------------

  private orgBackend(): OrgBackend {
    if (!this.backend.org) throw new ClientError('Organizations are not available on this connection');
    return this.backend.org;
  }

  private get keyStore(): UseStore {
    return this.opts.keyStore ?? defaultKeyStore();
  }

  private orgStore(orgId: string): OrgStore {
    return new OrgStore(orgId, this.keyStore);
  }

  /** Org keys exist only behind a passkey: the lock must be on and unlocked before anything is generated or sent. */
  private async requireVault(): Promise<VaultKey> {
    const vault = this.opts.vault;
    if (!vault || !(await vault.isEnabled())) {
      const supported = vault?.supported ? await vault.supported() : true;
      throw new ClientError(
        supported
          ? 'Set up the passkey lock first. Organization keys exist only behind a passkey.'
          : 'This browser cannot make a passkey with PRF support, so it cannot hold organization keys. Use a recent Chrome, Safari or Edge with a platform passkey.',
      );
    }
    const vk = vault.key();
    if (!vk) throw new ClientError('Unlock with your passkey first. Organization keys exist only behind a passkey.');
    return vk;
  }

  private pagerPub(): Uint8Array {
    const p = this.opts.pagerPub;
    if (!p || !isRawPublicKey(p)) throw new ClientError('Paging is not set up on this deployment');
    return p;
  }

  private cleanPhone(raw: string): string {
    const phone = typeof raw === 'string' ? raw.trim() : '';
    if (!isE164(phone)) throw new ClientError('Enter the phone number in international format, like +15551234567');
    return phone;
  }

  /** Opens the org device keys. With the vault locked nothing is returned, so nothing can sign. */
  private async orgKeys(orgId: string): Promise<DeviceKeys> {
    const vk = this.opts.vault?.key() ?? null;
    if (!vk) {
      this.orgKeyCache.clear();
      throw new ClientError(ORG_LOCKED_MESSAGE);
    }
    const hit = this.orgKeyCache.get(orgId);
    if (hit && hit.vk === vk) return hit.keys;
    const rec = await this.orgStore(orgId).getLockedKeys();
    if (!rec) throw new ClientError('This device does not hold keys for that organization');
    const keys = await openLockedOrgKeys(vk, rec, orgId);
    if (!keys) throw new ClientError('This passkey does not unlock the keys for that organization');
    if (this.opts.vault?.key() !== vk) throw new ClientError(ORG_LOCKED_MESSAGE);
    this.orgKeyCache.set(orgId, { vk, keys });
    return keys;
  }

  /** The org keys whose public halves are these, or null when this device holds none. */
  private async orgKeysMatching(signPub: Uint8Array, ecdhPub: Uint8Array): Promise<DeviceKeys | null> {
    for (const orgId of await orgIdsOnDevice(this.keyStore)) {
      const rec = await this.orgStore(orgId).getLockedKeys();
      if (rec && bytesEqual(rec.signPub, signPub) && bytesEqual(rec.ecdhPub, ecdhPub)) return this.orgKeys(orgId);
    }
    return null;
  }

  /**
   * A device that holds org keys must not quietly start an incident with fresh ones, because the roster
   * would be unusable in it. Only a device whose enrollments are all still pending may carry on without.
   */
  private async refuseIfOrgKeysHeld(): Promise<void> {
    const ids = await orgIdsOnDevice(this.keyStore);
    if (ids.length === 0) return;
    const own = this.backend.org?.rows().own ?? [];
    if (ids.every((id) => own.some((r) => r.orgId === id && r.state === 'pending'))) return;
    throw new ClientError('Your organization membership could not be verified right now. Wait a moment and try again.');
  }

  private revocationFields(orgId: string, r: OrgMemberRow) {
    return { orgId, orgMemberId: r.orgMemberId, identityHex: r.identityHex, reason: ORG_REVOKE_SIGNED_REASON };
  }

  private enrollmentFields(orgId: string, r: OrgMemberRow) {
    return {
      orgId,
      identityHex: r.identityHex,
      displayName: r.displayName,
      signPub: r.signPub,
      ecdhPub: r.ecdhPub,
      sealedContact: r.sealedContact,
    };
  }

  /**
   * Verifies the org rows against the pinned admin key and the cached keys,
   * and fills the cache with newly certified people. Public data only: it
   * works while the vault is locked.
   */
  private async computeOrg(): Promise<{ org: OrgView | null; roster: OrgRosterMember[] }> {
    // Built completely before it replaces the old map, so a concurrent action never sees a half-filled one.
    const snaps = new Map<string, OrgSnapshot>();
    const ob = this.backend.org;
    const myHex = this.backend.identityHex();
    if (!ob || !myHex) {
      this.orgSnaps = snaps;
      return { org: null, roster: [] };
    }
    try {
      const rows = ob.rows();
      let org: OrgView | null = null;
      let roster: OrgRosterMember[] = [];
      const view = (orgId: string, r: OrgMemberRow, keyChanged: boolean, revoked = false): OrgRosterMember => ({
        orgMemberId: r.orgMemberId,
        identity: r.identityHex,
        displayName: r.displayName,
        // A revocation this device verified sticks, whatever the server shows later.
        state: revoked || r.state === 'revoked' ? 'revoked' : r.state === 'active' ? 'active' : 'pending',
        fingerprint: formatFingerprint(fingerprintBytes(r.signPub, r.ecdhPub)),
        safetyCode: orgSafetyCode(orgId, r.identityHex, r.signPub, r.ecdhPub),
        enrolledAt: micros(r.enrolledAtMicros),
        approvedAt: r.approvedAtMicros !== undefined ? micros(r.approvedAtMicros) : null,
        keyChanged,
      });

      for (const o of rows.orgs) {
        const store = this.orgStore(o.id);
        let pin = await store.getPin();
        if (!pin) continue;
        const fp = fingerprintBytes(o.adminSignPub, o.adminEcdhPub);
        if (!bytesEqual(fp, pin.adminFingerprint)) continue; // not the admin this device pinned: show nothing
        if (!pin.adminSignPub || !pin.adminEcdhPub) {
          pin = { ...pin, adminSignPub: o.adminSignPub, adminEcdhPub: o.adminEcdhPub };
          await store.setPin(pin);
        }
        const cache = await store.getRoster();
        const revokedBefore = await store.getRevoked();
        const newlyRevoked: string[] = [];
        const fresh: Record<string, { identityHex: string; signPub: Uint8Array; ecdhPub: Uint8Array; sealedContactHash: Uint8Array }> = {};
        const members = new Map<string, RosterEntry>();
        for (const r of rows.roster) {
          if (r.orgId !== o.id) continue;
          const id = r.orgMemberId.toString();
          const certified =
            r.enrollSig.length === 64 && (await verifyEnrollment(pin.adminSignPub!, this.enrollmentFields(o.id, r), r.enrollSig));
          let keyChanged = false;
          const cached = cache[id];
          const hash = sha256(r.sealedContact);
          if (cached) {
            keyChanged =
              cached.identityHex !== r.identityHex ||
              !bytesEqual(cached.signPub, r.signPub) ||
              !bytesEqual(cached.ecdhPub, r.ecdhPub) ||
              !bytesEqual(cached.sealedContactHash, hash);
          } else if (certified) {
            fresh[id] = { identityHex: r.identityHex, signPub: r.signPub, ecdhPub: r.ecdhPub, sealedContactHash: hash };
          }
          // An active row without a valid certificate is treated like a changed key: that person cannot be added.
          if (r.state === 'active' && !certified) keyChanged = true;
          // A revocation counts only with the admin's signature; once seen it is remembered for good.
          const signedRevoked =
            r.state === 'revoked' &&
            (await verifyRevocation(pin.adminSignPub!, this.revocationFields(o.id, r), r.revokeSig));
          if (signedRevoked && !revokedBefore.has(id)) newlyRevoked.push(id);
          members.set(id, { row: r, certified, keyChanged, revoked: signedRevoked || revokedBefore.has(id) });
        }
        await store.addToRoster(fresh);
        await store.addRevoked(newlyRevoked);
        // A newer active enrollment wins. A row this device has already accepted as revoked never becomes live again.
        const mine = [...members.values()].find((m) => m.row.identityHex === myHex && m.row.state === 'active' && !m.revoked);
        if (!mine) continue;
        snaps.set(o.id, {
          orgId: o.id,
          name: o.name,
          adminHex: o.adminHex,
          adminSignPub: pin.adminSignPub!,
          adminEcdhPub: pin.adminEcdhPub!,
          myHex,
          myRole: o.adminHex === myHex ? 'admin' : 'member',
          pin,
          members,
        });
        if (!org) {
          org = {
            orgId: o.id,
            name: o.name,
            myRole: o.adminHex === myHex ? 'admin' : 'member',
            adminFingerprint: formatFingerprint(fp),
          };
          roster = [...members.values()]
            .sort((a, b) => (a.row.orgMemberId < b.row.orgMemberId ? -1 : 1))
            .map((m) => view(o.id, m.row, m.keyChanged, m.revoked));
        }
      }

      // Not active anywhere yet (or any more): show my own row so the screen can say where I stand.
      // A new pending enrollment is shown ahead of an older revoked row, and only a revoked row with no live enrollment wipes keys.
      if (!org) {
        const pinned: OrgMemberRow[] = [];
        for (const r of rows.own) {
          if (await this.orgStore(r.orgId).getPin()) pinned.push(r);
        }
        const live = pinned.find((r) => r.state === 'pending' || r.state === 'active');
        const shown = live ?? pinned.find((r) => r.state === 'revoked');
        if (shown) {
          roster = [view(shown.orgId, shown, false)];
          const adminPub = (await this.orgStore(shown.orgId).getPin())?.adminSignPub;
          if (!live && shown.state === 'revoked' && adminPub && !this.orgWiped.has(shown.orgId)) {
            if (shown.revokeSig.length === 64 && (await verifyRevocation(adminPub, this.revocationFields(shown.orgId, shown), shown.revokeSig))) {
              this.orgWiped.add(shown.orgId);
              this.orgKeyCache.delete(shown.orgId);
              await this.orgStore(shown.orgId).wipe();
            }
          }
        }
      }
      this.orgSnaps = snaps;
      return { org, roster };
    } catch {
      return { org: null, roster: [] };
    }
  }

  private pagesFor(base: IncidentState): PageView[] {
    const ob = this.backend.org;
    const id = this.incidentId;
    if (!ob || !id) return [];
    const snap = [...this.orgSnaps.values()][0];
    if (!snap) return [];
    const out: PageView[] = [];
    for (const p of ob.rows().pages) {
      if (p.incidentId !== id) continue;
      const entry = snap.members.get(p.orgMemberId.toString());
      if (!entry) continue;
      const m = base.members.find((x) => x.identity === entry.row.identityHex);
      out.push({
        pageId: p.pageId,
        orgMemberId: p.orgMemberId,
        displayName: entry.row.displayName,
        role: m?.role ?? 'executive',
        status: (['requested', 'calling', 'ringing', 'acknowledged', 'no_answer', 'busy', 'failed'].includes(p.status)
          ? p.status
          : 'failed') as PageView['status'],
        carrierReported: p.carrierReported,
        joined: this.verifiedAuthors.has(entry.row.identityHex),
        updatedAt: micros(p.updatedAtMicros),
      });
    }
    return out.sort((a, b) => Number(a.orgMemberId - b.orgMemberId));
  }

  /** Fresh check of one roster row against the pinned admin key and the cache. Throws before anything is signed. */
  private async checkedRosterRow(snap: OrgSnapshot, orgMemberId: bigint): Promise<OrgMemberRow> {
    const row = this.orgBackend()
      .rows()
      .roster.find((r) => r.orgId === snap.orgId && r.orgMemberId === orgMemberId);
    if ((await this.orgStore(snap.orgId).getRevoked()).has(orgMemberId.toString())) {
      throw new ClientError(`${row?.displayName ?? 'That person'} was revoked by the admin and cannot be added.`);
    }
    if (!row || row.state !== 'active') throw new ClientError('That person is not an active member of the roster');
    if (row.enrollSig.length !== 64 || !(await verifyEnrollment(snap.adminSignPub, this.enrollmentFields(snap.orgId, row), row.enrollSig))) {
      throw new ClientError(`The roster entry for ${row.displayName} has no valid admin certificate. Do not add them.`);
    }
    const cached = (await this.orgStore(snap.orgId).getRoster())[orgMemberId.toString()];
    if (
      cached &&
      (cached.identityHex !== row.identityHex ||
        !bytesEqual(cached.signPub, row.signPub) ||
        !bytesEqual(cached.ecdhPub, row.ecdhPub) ||
        !bytesEqual(cached.sealedContactHash, sha256(row.sealedContact)))
    ) {
      throw new ClientError(`${row.displayName}'s keys changed since you pinned them. They must be re-approved before you can add them.`);
    }
    return row;
  }

  private async orgAdminCtx() {
    await this.refresh();
    const snap = [...this.orgSnaps.values()].find((s) => s.myRole === 'admin');
    if (!snap) throw new ClientError('Only the organization admin can do this');
    const keys = await this.orgKeys(snap.orgId);
    if (!bytesEqual(keys.signPub, snap.adminSignPub)) throw new ClientError('This device does not hold the admin keys');
    return { snap, keys, store: this.orgStore(snap.orgId) };
  }

  async createOrg(i: { name: string; displayName: string; phone: string }): Promise<{ orgId: string }> {
    const orgName = normalizeOrgName(i.name);
    if (!isValidOrgName(orgName)) throw new ClientError('Enter an organization name of 1 to 80 characters');
    const name = this.cleanName(i.displayName);
    const phone = this.cleanPhone(i.phone);
    const pagerPub = this.pagerPub();
    const vk = await this.requireVault();
    const myHex = await this.waitReady();
    const ob = this.orgBackend();
    return this.exclusive(async () => {
      const orgId = crypto.randomUUID();
      const store = this.orgStore(orgId);
      const { record, keys } = await generateLockedOrgKeys(vk, orgId);
      await store.setLockedKeys(record);
      await store.setPin({
        adminFingerprint: fingerprintBytes(keys.signPub, keys.ecdhPub),
        adminSignPub: keys.signPub,
        adminEcdhPub: keys.ecdhPub,
        role: 'admin',
      });
      try {
        const sealedContact = await sealContact(pagerPub, orgId, myHex, phone);
        const enrollSig = await signEnrollment(keys.signPriv, {
          orgId,
          identityHex: myHex,
          displayName: name,
          signPub: keys.signPub,
          ecdhPub: keys.ecdhPub,
          sealedContact,
        });
        await ob.createOrg({ orgId, name: orgName, displayName: name, signPub: keys.signPub, ecdhPub: keys.ecdhPub, sealedContact, enrollSig });
      } catch {
        await store.wipe();
        throw new ClientError('Could not create the organization');
      }
      const seen = await this.waitFor(() => ob.rows().orgs.some((o) => o.id === orgId));
      if (!seen) {
        await store.wipe();
        throw new ClientError('The server did not confirm the new organization');
      }
      await this.refresh();
      return { orgId };
    });
  }

  async createEnrollLink(i: { ttlHours: number }): Promise<{ url: string; qr: string | null }> {
    if (!isValidEnrollTtlHours(i.ttlHours)) throw new ClientError('Choose a link lifetime of 1 to 24 hours');
    const ob = this.orgBackend();
    return this.exclusive(async () => {
      await this.refresh();
      const snap = [...this.orgSnaps.values()].find((s) => s.myRole === 'admin');
      if (!snap) throw new ClientError('Only the organization admin can do this');
      const store = this.orgStore(snap.orgId);
      const code = randomBytes(16);
      const secret = randomBytes(32);
      const codeHash = enrollLinkHash(snap.orgId, code);
      const hex = bytesToHex(codeHash);
      await store.setLink(hex, { secret, expiresAtMs: this.now() + i.ttlHours * 3_600_000 });
      try {
        await ob.createEnrollLink({ orgId: snap.orgId, codeHash, ttlHours: i.ttlHours });
      } catch {
        await store.delLink(hex);
        throw new ClientError('Could not create the enrollment link');
      }
      const url = buildEnrollUrl(this.opts.origin, {
        orgId: snap.orgId,
        code,
        secret,
        adminFingerprint: snap.pin.adminFingerprint,
      });
      let qr: string | null = null;
      try {
        const { toDataURL } = await import('qrcode');
        qr = await toDataURL(url, { margin: 1, width: 192, errorCorrectionLevel: 'M' });
      } catch {
        qr = null;
      }
      return { url, qr };
    });
  }

  async enroll(i: { fragment: string; displayName: string; phone: string }): Promise<{ safetyCode: string }> {
    const frag = parseEnrollFragment(i.fragment);
    if (!frag) throw new ClientError('This enrollment link is not valid');
    const name = this.cleanName(i.displayName);
    const phone = this.cleanPhone(i.phone);
    const pagerPub = this.pagerPub();
    const ob = this.orgBackend();
    const myHex = await this.waitReady();
    const store = this.orgStore(frag.orgId);
    // Already enrolled on this device: report where it stands. A revoked row does not count, so the same person can enroll again.
    const existing = await store.getLockedKeys();
    const live = ob.rows().own.find((r) => r.orgId === frag.orgId && (r.state === 'pending' || r.state === 'active'));
    if (existing && live && bytesEqual(existing.signPub, live.signPub) && bytesEqual(existing.ecdhPub, live.ecdhPub)) {
      return { safetyCode: orgSafetyCode(frag.orgId, myHex, existing.signPub, existing.ecdhPub) };
    }
    const vk = await this.requireVault();
    return this.exclusive(async () => {
      const { record, keys } = await generateLockedOrgKeys(vk, frag.orgId);
      await store.setLockedKeys(record);
      await store.setPin({ adminFingerprint: frag.adminFingerprint, role: 'member' });
      try {
        const sealedContact = await sealContact(pagerPub, frag.orgId, myHex, phone);
        const joinTag = await computeEnrollJoinTag(frag.secret, {
          orgId: frag.orgId,
          identityHex: myHex,
          displayName: name,
          signPub: keys.signPub,
          ecdhPub: keys.ecdhPub,
          sealedContact,
        });
        await ob.enrollMember({
          orgId: frag.orgId,
          code: frag.code,
          displayName: name,
          signPub: keys.signPub,
          ecdhPub: keys.ecdhPub,
          joinTag,
          sealedContact,
        });
      } catch {
        await store.wipe();
        throw new ClientError('This enrollment link could not be used');
      }
      // The module records failures and returns normally, so look for a new pending row. An older revoked row does not count.
      const joined = await this.waitFor(() =>
        ob.rows().own.some((r) => r.orgId === frag.orgId && r.state === 'pending' && bytesEqual(r.signPub, keys.signPub)),
      );
      if (!joined) {
        await store.wipe();
        throw new ClientError('This enrollment link could not be used. It may be expired or already used, the name may be taken, or there were too many failed tries (wait 10 minutes).');
      }
      await this.refresh();
      return { safetyCode: orgSafetyCode(frag.orgId, myHex, keys.signPub, keys.ecdhPub) };
    });
  }

  async approveMember(orgMemberId: bigint): Promise<void> {
    const ob = this.orgBackend();
    return this.exclusive(async () => {
      const { snap, keys, store } = await this.orgAdminCtx();
      const row = ob.rows().roster.find((r) => r.orgId === snap.orgId && r.orgMemberId === orgMemberId);
      if (!row || row.state !== 'pending') throw new ClientError('That person cannot be approved');
      try {
        await importSignPub(row.signPub);
        await importEcdhPub(row.ecdhPub);
      } catch {
        throw new ClientError('That enrollment carries an invalid key. Do not approve.');
      }
      if (row.sealedContact.length !== SEALED_CONTACT_LEN) throw new ClientError('That enrollment carries a malformed contact. Do not approve.');
      // Only approve when a link this admin made proves the request came from its holder.
      const fields = this.enrollmentFields(snap.orgId, row);
      let linkOk = false;
      let usedLink: string | null = null;
      for (const l of await store.getLinks()) {
        if (await verifyEnrollJoinTag(l.secret, fields, row.joinTag)) {
          linkOk = true;
          usedLink = l.codeHashHex;
        }
      }
      if (!linkOk) throw new ClientError('Unverified: do not approve. The enrollment request does not match any link you made.');
      const enrollSig = await signEnrollment(keys.signPriv, fields);
      try {
        await ob.approveMember({ orgId: snap.orgId, orgMemberId, enrollSig });
      } catch {
        throw new ClientError('Could not approve that person');
      }
      // One link enrolls one person, so its secret has done its job.
      if (usedLink) await store.delLink(usedLink);
      await this.waitFor(() => ob.rows().roster.some((r) => r.orgMemberId === orgMemberId && r.state === 'active'));
      await this.refresh();
    });
  }

  async revokeOrgMember(orgMemberId: bigint, reason: string): Promise<void> {
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length === 0 || Array.from(why).length > MAX_ORG_REASON) {
      throw new ClientError(`Give a reason of 1 to ${MAX_ORG_REASON} characters`);
    }
    const ob = this.orgBackend();
    return this.exclusive(async () => {
      const { snap, keys } = await this.orgAdminCtx();
      const row = ob.rows().roster.find((r) => r.orgId === snap.orgId && r.orgMemberId === orgMemberId);
      if (!row || row.state === 'revoked' || row.identityHex === snap.adminHex) throw new ClientError('That person cannot be revoked');
      // The module keeps only the signature, so the signed reason is fixed and the free-text reason is not sent.
      const signedReason = ORG_REVOKE_SIGNED_REASON;
      const revokeSig = await signRevocation(keys.signPriv, { orgId: snap.orgId, orgMemberId, identityHex: row.identityHex, reason: signedReason });
      try {
        await ob.revokeOrgMember({ orgId: snap.orgId, orgMemberId, reason: signedReason, revokeSig });
      } catch {
        throw new ClientError('Could not revoke that person');
      }
      await this.waitFor(() => ob.rows().roster.some((r) => r.orgMemberId === orgMemberId && r.state === 'revoked'));
      await this.refresh();
    });
  }

  /** The commander context plus the org snapshot whose keys the commander uses in this incident. */
  private async rosterCtx() {
    const c = await this.commanderCtx();
    const snap = [...this.orgSnaps.values()].find((s) => {
      const m = s.members.get([...s.members.values()].find((e) => e.row.identityHex === c.myHex)?.row.orgMemberId.toString() ?? '');
      return !!m && bytesEqual(m.row.signPub, c.device.signPub) && bytesEqual(m.row.ecdhPub, c.device.ecdhPub);
    });
    if (!snap) {
      throw new ClientError('This incident was not started with your organization keys, so the roster cannot be used here');
    }
    return { c, snap };
  }

  async addFromRoster(picks: { orgMemberId: bigint; role: 'counsel' | 'technical' | 'executive' }[]): Promise<void> {
    if (picks.length < 1 || picks.length > 20) throw new ClientError('Pick 1 to 20 people');
    if (new Set(picks.map((p) => p.orgMemberId)).size !== picks.length) throw new ClientError('Each person can be picked once');
    for (const p of picks) if (!isInvitableRole(p.role)) throw new ClientError('Pick counsel, technical or executive');
    const ob = this.orgBackend();
    return this.exclusive(async () => {
      const { c, snap } = await this.rosterCtx();
      // 1. Verify everyone before anything is signed or sent.
      const targets: { row: OrgMemberRow; role: Role }[] = [];
      const replacements: bigint[] = [];
      for (const p of picks) {
        const row = await this.checkedRosterRow(snap, p.orgMemberId);
        if (row.identityHex === c.myHex) throw new ClientError(`${row.displayName} is already in this incident`);
        const live = c.rows.members.find((m) => m.incidentId === c.id && m.identityHex === row.identityHex && m.state !== 'revoked');
        if (live) {
          const markerId = live.inviteCodeHash.startsWith(ROSTER_MARKER_PREFIX) ? live.inviteCodeHash.slice(ROSTER_MARKER_PREFIX.length) : '';
          const prior = snap.members.get(markerId);
          // Only a new enrollment may replace an incident membership that points at a revoked roster row.
          if (!prior?.revoked || prior.row.identityHex !== row.identityHex || prior.row.orgMemberId === row.orgMemberId) {
            throw new ClientError(`${row.displayName} is already in this incident`);
          }
          replacements.push(live.memberId);
        }
        targets.push({ row, role: p.role });
      }
      for (const memberId of replacements) {
        await this.revokeMemberInChain(memberId, 'Replaced by a new enrollment');
      }
      const current = { ...c, rows: this.backend.rows() };
      // 2. Link the incident to the org once.
      const linked =
        (await c.store.getOrgLink()) === snap.orgId ||
        c.rows.members.some((m) => m.incidentId === c.id && m.inviteCodeHash.startsWith(ROSTER_MARKER_PREFIX));
      if (!linked) {
        try {
          await ob.linkIncidentOrg({ incidentId: c.id, orgId: snap.orgId });
        } catch {
          throw new ClientError('Could not link this incident to your organization');
        }
      }
      await c.store.setOrgLink(snap.orgId);
      // 3. Admission certificate and every readable channel key, per person.
      const wire = [];
      for (const { row, role } of targets) {
        const envelopes: { kind: string; epoch: number; wrapped: Uint8Array; iv: Uint8Array }[] = [];
        for (const kind of readableChannels(role)) {
          const ch = current.rows.channels.find((x) => x.incidentId === c.id && x.kind === kind);
          if (!ch) throw new ClientError('Channel state is missing');
          for (let e = 0; e <= ch.currentEpoch; e++) {
            const raw = await this.rawChannelKey(current, kind, e);
            const w = await wrapChannelKey(
              c.device.ecdhPriv,
              row.ecdhPub,
              { incidentId: c.id, kind, epoch: e, recipientIdentityHex: row.identityHex },
              raw,
            );
            raw.fill(0);
            envelopes.push({ kind, epoch: e, wrapped: w.wrapped, iv: w.iv });
          }
        }
        const admitSig = await sign(
          c.device.signPriv,
          admitStatement(c.id, row.identityHex, role, row.displayName, row.signPub, row.ecdhPub),
        );
        wire.push({ orgMemberId: row.orgMemberId, role, admitSig, envelopes });
      }
      try {
        await ob.addFromRoster({ incidentId: c.id, picks: wire });
      } catch {
        throw new ClientError('Could not add people from the roster');
      }
      for (const { row, role } of targets) {
        await this.append(
          'record',
          this.payload('roster.admit', { memberIdentity: row.identityHex, role, displayName: row.displayName }),
          true,
        );
      }
    });
  }

  async page(orgMemberIds: bigint[]): Promise<{ pageId: string }> {
    if (orgMemberIds.length < 1 || orgMemberIds.length > MAX_PAGE_TARGETS) throw new ClientError(`Page 1 to ${MAX_PAGE_TARGETS} people`);
    if (new Set(orgMemberIds).size !== orgMemberIds.length) throw new ClientError('Each person can be paged once');
    const ob = this.orgBackend();
    const post = this.opts.postPage ?? defaultPostPage;
    return this.exclusive(async () => {
      const { c, snap } = await this.rosterCtx();
      const keys = await this.orgKeys(snap.orgId);
      const commanderRow = await this.checkedRosterRow(
        snap,
        [...snap.members.values()].find((m) => m.row.identityHex === c.myHex)!.row.orgMemberId,
      );
      const targets: { row: OrgMemberRow; role: string }[] = [];
      for (const id of orgMemberIds) {
        const row = await this.checkedRosterRow(snap, id);
        const m = c.rows.members.find(
          (x) => x.incidentId === c.id && x.identityHex === row.identityHex && x.state === 'active' && x.inviteCodeHash === `${ROSTER_MARKER_PREFIX}${id}`,
        );
        if (!m) throw new ClientError(`${row.displayName} has not been added from the roster yet`);
        targets.push({ row, role: m.role });
      }
      const pageId = crypto.randomUUID();
      try {
        await ob.requestPage({ incidentId: c.id, pageId, orgMemberIds });
      } catch {
        throw new ClientError('Could not request the page. If you paged the same person a moment ago, wait a minute and try again.');
      }
      const sentAt = this.now();
      const commanderSig = await signPageRequest(keys.signPriv, {
        orgId: snap.orgId,
        incidentId: c.id,
        pageId,
        sentAtMs: sentAt,
        targets: targets.map((t) => ({ orgMemberId: t.row.orgMemberId, identityHex: t.row.identityHex })),
      });
      const record = (r: OrgMemberRow) => ({
        identity: r.identityHex,
        displayName: r.displayName,
        signPub: b64urlEncode(r.signPub),
        ecdhPub: b64urlEncode(r.ecdhPub),
        sealedContact: b64urlEncode(r.sealedContact),
        enrollSig: b64urlEncode(r.enrollSig),
      });
      const body: PageRequestWire = {
        orgId: snap.orgId,
        incidentId: c.id,
        pageId,
        sentAt,
        adminSignPub: b64urlEncode(snap.adminSignPub),
        commander: record(commanderRow),
        targets: targets.map((t) => ({ ...record(t.row), orgMemberId: t.row.orgMemberId.toString() })),
        commanderSig: b64urlEncode(commanderSig),
      };
      const raw = JSON.stringify(body);
      if (new TextEncoder().encode(raw).length > MAX_PAGE_BODY_BYTES) throw new ClientError('That page request is too large');
      let res: { ok: boolean; status?: number; error?: string; dialed?: number };
      try {
        res = await post(raw);
      } catch {
        throw new ClientError('The paging service could not be reached. Try again in a minute.');
      }
      if (!res.ok) throw new ClientError(pagerRefusalMessage(res.error, res.status));
      if (res.dialed === 0) {
        throw new ClientError('The paging service accepted the request but the phone carrier call could not be placed. Check the Twilio settings in Vercel.');
      }
      const names = targets.map((t) => `${t.row.displayName} (${roleLabel(t.role)})`).join(', ');
      await this.append(
        'record',
        this.payload('timeline.add', {
          entryId: crypto.randomUUID(),
          occurredAt: new Date(this.now()).toISOString(),
          phase: this.state.status?.phase ?? 'detection_analysis',
          csf: 'RS.CO',
          text: `Paged ${names}`,
        }),
        true,
      );
      return { pageId };
    });
  }

  announcePresence(): Promise<void> {
    return this.append('command', this.payload('chat.post', { messageId: crypto.randomUUID(), text: "I'm here", mentions: [] }));
  }
}

async function defaultPostPage(body: string): Promise<{ ok: boolean; status: number; error?: string; dialed?: number }> {
  const res = await fetch('/api/page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, cache: 'no-store' });
  let error: string | undefined;
  let dialed: number | undefined;
  try {
    const j = (await res.json()) as { error?: unknown; dialed?: unknown };
    if (typeof j.error === 'string') error = j.error;
    if (typeof j.dialed === 'number') dialed = j.dialed;
  } catch {
    // Non-JSON body (for example a platform error page): fall back to the status code.
  }
  return { ok: res.ok, status: res.status, error, dialed };
}

/** Turns the pager's refusal code into a message that says what to check. Codes carry no secrets. */
export function pagerRefusalMessage(code: string | undefined, status?: number): string {
  const tail = ` (pager: ${code ?? `HTTP ${status ?? 'unknown'}`})`;
  switch (code) {
    case 'unavailable':
      return `The paging service is not fully configured or cannot reach the database. Check the Vercel pager settings.${tail}`;
    case 'untrusted_admin':
      return `The paging service does not trust this org's admin key. Set ORG_ADMIN_SIGN_PUB in Vercel to this org's key and redeploy.${tail}`;
    case 'stale':
      return `This device's clock is off by more than two minutes. Fix the clock and try again.${tail}`;
    case 'replay':
      return `That page was already sent. Try again.${tail}`;
    case 'bad_certificate':
    case 'bad_signature':
    case 'state_mismatch':
      return `The paging service could not verify this page against the org roster. Re-enroll or re-approve the person and try again.${tail}`;
    case 'malformed_contact':
      return `The paging service could not open the saved phone number. The pager key may have changed since enrollment: re-enroll and try again.${tail}`;
    case 'not_allowed':
      return `That phone number is not on the pager's allowed list (PAGER_ALLOWED_NUMBERS).${tail}`;
    case 'bad_body':
      return `The paging service rejected the request as malformed.${tail}`;
    default:
      return `The paging service refused the request. Try again in a minute.${tail}`;
  }
}

function parsePagerPub(v: string | undefined): Uint8Array | undefined {
  try {
    if (!v) return undefined;
    const raw = b64urlDecode(v);
    return isRawPublicKey(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Browser entry point: connects to Maincloud (public host and database name
 * from NEXT_PUBLIC_* env vars) and returns the real client.
 */
let sessionDb: UseStore | undefined;
const sessionStore = (): UseStore => (sessionDb ??= createStore('haven-session', 'kv'));

export function createRealIncidentClient(): IncidentClient {
  const host = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'wss://maincloud.spacetimedb.com';
  const dbName = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'zerohour-hackutd26';
  return new RealIncidentClient(new SpacetimeBackend(host, dbName), {
    origin: window.location.origin,
    vault: getDeviceVault(),
    pagerPub: parsePagerPub(process.env.NEXT_PUBLIC_PAGER_PUB),
    lastIncident: {
      get: async () => (await idbGet<string>('last-incident', sessionStore())) ?? null,
      set: (id) => idbSet('last-incident', id, sessionStore()),
    },
  });
}
