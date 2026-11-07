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
// - Errors shown to the UI never include key material or plaintext.

import {
  admitStatement,
  bytesEqual,
  bytesToHex,
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
import { sign } from '@/lib/crypto/sign';
import { IncidentStore, type PinnedCommander } from '@/lib/crypto/store';
import { type HeadPin, type RawEvent, type RosterMember, verifyIncident } from '@/lib/crypto/verify';
import { unwrapChannelKey, wrapChannelKey } from '@/lib/crypto/wrap';
import type { IncidentBackend, MemberRow } from './backend';
import { foldEvents } from './fold';
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
  type ProfileBody,
  type ScopeBody,
  type StatusBody,
  type TaskBody,
  type TimelineBody,
  EMPTY_PROFILE,
} from './types';

/** Known, user-presentable failure. Anything else becomes a generic message. */
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
}

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
  }

  dispose(): void {
    this.unsubscribe();
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
    await this.refresh();
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
          }
        } finally {
          this.running = null;
        }
      })();
    }
    return this.running;
  }

  private async loadDevice(mine: MemberRow, store: IncidentStore): Promise<DeviceKeys> {
    this.device ??= (await store.getDeviceKeys()) ?? null;
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
      ...(showCode ? { safetyCode: safetyCode(incidentId, m.identityHex, m.signPub, m.ecdhPub) } : {}),
      joinedAt: micros(m.joinedAtMicros),
      ...(m.admittedAtMicros !== undefined ? { admittedAt: micros(m.admittedAtMicros) } : {}),
      ...(m.revokedAtMicros !== undefined ? { revokedAt: micros(m.revokedAtMicros) } : {}),
    };
  }

  private async compute(): Promise<IncidentState> {
    const at = new Date(this.now());
    const connection = this.backend.connection();
    const id = this.incidentId;
    const store = this.store;
    if (!id || !store) return emptyState(connection, at);

    const rows = this.backend.rows();
    const mine = rows.status.find((r) => r.incidentId === id);
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
      const expected = await store.getExpectedFingerprint();
      const fp = fingerprintBytes(inc.commanderSignPub, inc.commanderEcdhPub);
      if (!expected || !bytesEqual(fp, expected)) {
        throw new ClientError('This is not the incident you were invited to');
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
    if (mine.state === 'active') {
      for (const env of rows.envelopes) {
        if (env.incidentId !== id || env.recipientHex !== meHex || !isChannel(env.kind)) continue;
        const k = keyOf(env.kind, env.epoch);
        if (this.keys.has(k)) continue;
        const stored = await store.getChannelKey(env.kind, env.epoch);
        if (stored) {
          this.keys.set(k, stored);
          continue;
        }
        const tag = `${k}/${bytesToHex(env.wrapped)}`;
        if (this.failedEnvelopes.has(tag)) {
          extraFailures.push({ identity: pinned ? bytesToHex(pinned.fingerprint).slice(0, 16) : '', reason: `key envelope ${k} did not authenticate` });
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
          extraFailures.push({ identity: '', reason: `key envelope ${k} did not authenticate` });
          continue;
        }
        const ck = await importChannelKey(raw);
        raw.fill(0);
        await store.setChannelKey(env.kind, env.epoch, ck);
        this.keys.set(k, ck);
      }
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
    const me = views.find((v) => v.identity === meHex) ?? null;
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
    };
  }

  // --- action context ---------------------------------------------------------

  private async ctx() {
    const id = this.incidentId;
    const store = this.store;
    if (!id || !store) throw new ClientError('No incident is open');
    const rows = this.backend.rows();
    const mine = rows.status.find((r) => r.incidentId === id);
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
    const keys = await generateDeviceKeys();
    await store.setDeviceKeys(keys);
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
    if ((await store.getDeviceKeys()) && before.status.some((r) => r.incidentId === inv.incidentId)) {
      await this.activate(inv.incidentId, store);
      return;
    }
    const keys = await generateDeviceKeys();
    await store.setDeviceKeys(keys);
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
    const joined = await this.waitFor(() => this.backend.rows().status.some((r) => r.incidentId === inv.incidentId));
    if (!joined) {
      await store.wipe();
      throw new ClientError('This invite link could not be used. It may be expired or already used, or the name may be taken.');
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
    return this.exclusive(async () => {
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
    });
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
    throw new ClientError('Checkpoints are not enabled yet');
  }
}

/**
 * Browser entry point: connects to Maincloud (public host and database name
 * from NEXT_PUBLIC_* env vars) and returns the real client.
 */
export function createRealIncidentClient(): IncidentClient {
  const host = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST || 'wss://maincloud.spacetimedb.com';
  const dbName = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'zerohour-hackutd26';
  return new RealIncidentClient(new SpacetimeBackend(host, dbName), { origin: window.location.origin });
}
