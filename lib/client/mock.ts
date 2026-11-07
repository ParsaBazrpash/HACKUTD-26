// In-memory IncidentClient for demo mode (docs/PLAN.md 6.3).
//
// The story is built by foldEvents, the same pure fold the real client uses.
// This file does not seal, sign, hash, or check admission certificates.
// Invite links are demo tokens kept in this browser so another tab can redeem
// them. They are not cryptographic invites, and a live invite fragment is rejected.
//
// getState() filters with the shared role policy. The heap still holds every
// channel because this process is the whole demo, not a security boundary.

import {
  browserDemoLedger,
  browserDemoSession,
  parseDemoLedger,
  parseDemoSession,
  serializeDemoLedger,
  serializeDemoSession,
  type DemoLedgerPort,
  type DemoSessionPort,
  type LedgerEvent,
  type LedgerMember,
  type LedgerWorld,
} from "@/lib/client/demo-ledger";
import { foldEvents } from "@/lib/client/fold";
import {
  EMPTY_PROFILE,
  type IncidentClient,
  type IncidentState,
  type IntegrityReport,
  type MemberView,
  type VerifiedEvent,
} from "@/lib/client/types";
import {
  isKindAllowed,
  PAYLOAD_VERSION,
  PayloadSchema,
  TitleBodySchema,
  type ChatBody,
  type DeadlineBody,
  type DiscoveryBody,
  type EvidenceBody,
  type Payload,
  type PayloadKind,
  type ProfileBody,
  type ScopeBody,
  type StatusBody,
  type TaskBody,
  type TimelineBody,
} from "@/lib/protocol/events";
import {
  displayNameKey,
  INVITE_TTL_DEFAULT_MIN,
  INVITE_TTL_MAX_MIN,
  isUuidV4,
  isValidDisplayName,
  MAX_INCIDENTS_PER_IDENTITY,
  MAX_MEMBERS,
  MAX_OPEN_INVITES,
  normalizeDisplayName,
} from "@/spacetimedb/src/shared/limits";
import {
  type ChannelKind,
  isInvitableRole,
  readableChannels,
  type Role,
} from "@/spacetimedb/src/shared/policy";
import {
  createClinicFixture,
  type ClinicMemberSeed,
} from "@/lib/scenario/clinic";

export type MockViewer = "commander" | "counsel" | "technical" | "executive" | "pending";

export interface MockClientOptions {
  now?: () => number;
  /** Origin used in demo invite links. Defaults to the browser origin, then localhost. */
  origin?: string;
  /** Who this tab is inside the seeded clinic. Defaults to the commander. */
  viewer?: MockViewer;
  /**
   * Shared demo record. Undefined uses localStorage in the browser.
   * Null keeps this client private to the process.
   */
  ledger?: DemoLedgerPort | null;
  /** Which member this tab is. Undefined uses sessionStorage in the browser. */
  session?: DemoSessionPort | null;
}

interface DemoInvite {
  token: string;
  role: "counsel" | "technical" | "executive";
  expiresAt: number;
  used: boolean;
}

interface RosterEntry extends ClinicMemberSeed {
  revokedAt?: Date;
}

interface World {
  id: string;
  createdAt: Date;
  members: RosterEntry[];
  events: VerifiedEvent[];
  invites: DemoInvite[];
  nextMemberId: bigint;
}

function memberStateRank(state: RosterEntry["state"]): number {
  if (state === "revoked") return 2;
  if (state === "active") return 1;
  return 0;
}

const PLACEHOLDER_HEAD = "0".repeat(64);

function demoIdentity(n: number): string {
  return n.toString(16).padStart(64, "0");
}

function demoFingerprint(n: number): string {
  return `de30 0000 de30 0000 de30 0000 de30 ${n.toString(16).padStart(4, "0")}`;
}

function demoSafety(n: number): string {
  const digits = n.toString().padStart(12, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 12)}`;
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return value;
}

function blank(connection: IncidentState["connection"], at: Date, error?: string): IncidentState {
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

function channelIntegrity(events: VerifiedEvent[]): IntegrityReport["channels"][ChannelKind] {
  const sorted = [...events].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  const failures: NonNullable<IntegrityReport["channels"][ChannelKind]>["failures"] = [];
  let expected = 1n;
  for (const event of sorted) {
    if (event.seq !== expected) {
      failures.push({ seq: event.seq, reason: "gap" });
      expected = event.seq;
    }
    expected = event.seq + 1n;
    if (!event.verdict.ok) {
      for (const reason of event.verdict.failures) failures.push({ seq: event.seq, reason });
    }
  }
  const last = sorted.at(-1);
  return {
    ok: failures.length === 0,
    eventsChecked: sorted.length,
    failures,
    head: last ? { seq: last.seq, hashHex: PLACEHOLDER_HEAD } : null,
    pinnedOk: true,
    waitingForKeys: sorted.some((event) => event.verdict.warnings.includes("waiting_for_keys")),
  };
}

function parseDemoFragment(
  fragment: string,
): { incidentId: string; token: string; role: Role } | "live" | null {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(raw);
  if (params.has("c") || params.has("s") || params.has("f")) return "live";
  if (params.get("demo") !== "1") return null;
  const incidentId = params.get("i");
  const token = params.get("t");
  const role = params.get("r");
  if (!incidentId || !token || !isInvitableRole(role)) return null;
  return { incidentId, token, role };
}

class MockIncidentClient implements IncidentClient {
  private state: IncidentState;
  private readonly listeners = new Set<() => void>();
  private readonly worlds = new Map<string, World>();
  private readonly now: () => number;
  private readonly options: MockClientOptions;
  private readonly ledger: DemoLedgerPort | null;
  private readonly session: DemoSessionPort | null;
  private ledgerBlocked = false;
  private applyingLedger = false;
  private viewer = "";
  private currentId: string | null = null;
  private nextIdentity = 6;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: MockClientOptions = {}) {
    this.options = options;
    this.ledger = options.ledger === undefined ? browserDemoLedger() : options.ledger;
    this.session = options.session === undefined ? browserDemoSession() : options.session;
    this.now = options.now ?? Date.now;
    const clinic = createClinicFixture();
    const world: World = {
      id: clinic.incidentId,
      createdAt: clinic.createdAt,
      members: clinic.members.map((member) => ({ ...member })),
      events: [...clinic.events],
      invites: [],
      nextMemberId: 6n,
    };
    this.worlds.set(world.id, world);
    this.viewer = this.viewerFor(world, options.viewer ?? "commander");
    this.currentId = world.id;
    this.pull();
    if (!options.viewer) this.restoreSession();
    this.state = freezeDeep(blank("connecting", new Date(this.now())));
    this.publish();
    this.ledger?.subscribe?.(() => this.onRemoteLedger());
  }

  getState = (): IncidentState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  createIncident(input: { title: string; displayName: string }): Promise<{ incidentId: string }> {
    return this.run(() => {
      if (this.worlds.size >= MAX_INCIDENTS_PER_IDENTITY) {
        throw new Error("This demo tab cannot open more incidents.");
      }
      const name = this.cleanName(input.displayName);
      const title = TitleBodySchema.safeParse({ title: input.title.trim() });
      if (!title.success) throw new Error("Enter an incident title of 1 to 120 characters.");
      const incidentId = crypto.randomUUID();
      const createdAt = new Date(this.now());
      const serial = this.nextIdentity++;
      const commander: RosterEntry = {
        memberId: 1n,
        identity: demoIdentity(serial),
        displayName: name,
        role: "commander",
        state: "active",
        fingerprint: demoFingerprint(serial),
        safetyCode: demoSafety(serial),
        joinedAt: createdAt,
        admittedAt: createdAt,
        demoLinkMatched: false,
      };
      const world: World = {
        id: incidentId,
        createdAt,
        members: [commander],
        events: [],
        invites: [],
        nextMemberId: 2n,
      };
      this.worlds.set(incidentId, world);
      this.viewer = commander.identity;
      this.currentId = incidentId;
      this.push(world, "record", commander, "incident.title", { title: title.data.title });
      this.publish();
      return { incidentId };
    });
  }

  openIncident(incidentId: string): Promise<void> {
    return this.run(() => {
      if (!isUuidV4(incidentId)) throw new Error("That incident id is not valid.");
      const world = this.worlds.get(incidentId);
      if (!world || !world.members.some((member) => member.identity === this.viewer)) {
        throw new Error("You are not a member of this incident.");
      }
      this.currentId = incidentId;
      this.publish();
    });
  }

  createInvite(input: {
    role: "counsel" | "technical" | "executive";
    ttlMinutes?: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return this.run(() => {
      const world = this.requireCommander();
      if (!isInvitableRole(input.role)) throw new Error("That role cannot be invited.");
      const ttl = input.ttlMinutes ?? INVITE_TTL_DEFAULT_MIN;
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > INVITE_TTL_MAX_MIN) {
        throw new Error("Invite lifetime must be between 1 and 60 minutes.");
      }
      const open = world.invites.filter((invite) => !invite.used && invite.expiresAt > this.now()).length;
      if (open >= MAX_OPEN_INVITES) throw new Error("Too many open invites.");
      const token = crypto.randomUUID();
      const expiresAtMs = this.now() + ttl * 60_000;
      world.invites.push({ token, role: input.role, expiresAt: expiresAtMs, used: false });
      const url = `${this.origin()}/join#demo=1&i=${encodeURIComponent(world.id)}&t=${encodeURIComponent(token)}&r=${input.role}`;
      return { url, expiresAt: new Date(expiresAtMs) };
    });
  }

  redeemInvite(input: { fragment: string; displayName: string }): Promise<void> {
    return this.run(() => {
      const parsed = parseDemoFragment(input.fragment);
      if (parsed === "live") throw new Error("Demo mode cannot redeem a live invite link.");
      if (!parsed) throw new Error("This demo invite link is not valid.");
      const world = this.worlds.get(parsed.incidentId);
      const invite = world?.invites.find((item) => item.token === parsed.token);
      if (!world || !invite) {
        throw new Error("This demo invite is not in this browser. Create a new link from the commander tab.");
      }
      if (invite.role !== parsed.role) throw new Error("This demo invite does not match the role on the link.");
      if (invite.used) throw new Error("This demo invite was already used.");
      if (invite.expiresAt <= this.now()) throw new Error("This demo invite has expired.");
      const name = this.cleanName(input.displayName);
      if (world.members.some((member) => displayNameKey(member.displayName) === displayNameKey(name))) {
        throw new Error("That display name is already in use.");
      }
      if (world.members.length >= MAX_MEMBERS) throw new Error("This incident cannot add another member.");
      const serial = this.nextIdentity++;
      const identity = demoIdentity(serial);
      world.members.push({
        memberId: world.nextMemberId++,
        identity,
        displayName: name,
        role: invite.role,
        state: "pending",
        fingerprint: demoFingerprint(serial),
        safetyCode: demoSafety(serial),
        joinedAt: new Date(this.now()),
        demoLinkMatched: true,
      });
      invite.used = true;
      this.viewer = identity;
      this.currentId = world.id;
      this.publish();
    });
  }

  admitMember(memberId: bigint): Promise<void> {
    return this.run(() => {
      const world = this.requireCommander();
      const me = this.me(world);
      const target = world.members.find((member) => member.memberId === memberId);
      if (!target || target.state !== "pending") throw new Error("That member cannot be admitted.");
      if (!target.demoLinkMatched) {
        throw new Error("Unverified: do not admit. The demo invite token did not match.");
      }
      target.state = "active";
      target.admittedAt = new Date(this.now());
      this.push(world, "record", me, "roster.admit", {
        memberIdentity: target.identity,
        role: target.role,
        displayName: target.displayName,
      });
      this.publish();
    });
  }

  revokeMember(memberId: bigint, reason: string): Promise<void> {
    return this.run(() => {
      const world = this.requireCommander();
      const me = this.me(world);
      if (reason.length > 500) throw new Error("Reason must be 500 characters or fewer.");
      const target = world.members.find((member) => member.memberId === memberId);
      if (!target || target.role === "commander" || target.identity === me.identity || target.state === "revoked") {
        throw new Error("That member cannot be revoked.");
      }
      target.state = "revoked";
      target.revokedAt = new Date(this.now());
      this.push(world, "record", me, "roster.revoke", {
        memberIdentity: target.identity,
        reason,
      });
      this.publish();
    });
  }

  setStatus(body: StatusBody): Promise<void> {
    return this.run(() => this.write("record", "status.set", body));
  }

  addTimelineEntry(body: Omit<TimelineBody, "entryId">): Promise<void> {
    return this.run(() => this.write("record", "timeline.add", { ...body, entryId: crypto.randomUUID() }));
  }

  upsertScopeItem(body: ScopeBody): Promise<void> {
    return this.run(() => this.write("record", "scope.set", body));
  }

  upsertTask(body: TaskBody): Promise<void> {
    return this.run(() => this.write("record", "task.set", body));
  }

  setProfile(body: ProfileBody): Promise<void> {
    return this.run(() => this.write("record", "profile.set", body));
  }

  recordDiscovery(body: DiscoveryBody): Promise<void> {
    return this.run(() => this.write("record", "legal.discovery", body));
  }

  recordMateriality(body: DiscoveryBody): Promise<void> {
    return this.run(() => this.write("record", "legal.materiality", body));
  }

  updateDeadline(body: DeadlineBody): Promise<void> {
    return this.run(() => this.write("record", "deadline.update", body));
  }

  addEvidence(body: Omit<EvidenceBody, "evidenceId">): Promise<void> {
    return this.run(() => this.write("record", "evidence.add", { ...body, evidenceId: crypto.randomUUID() }));
  }

  postMessage(
    channel: "command" | "privileged" | "technical",
    body: Omit<ChatBody, "messageId">,
  ): Promise<void> {
    return this.run(() => this.write(channel, "chat.post", { ...body, messageId: crypto.randomUUID() }));
  }

  verifyAll(): Promise<IntegrityReport> {
    return this.run(() => {
      this.publish();
      return this.state.integrity;
    });
  }

  signCheckpoint(): Promise<void> {
    return this.run(() => {
      throw new Error("Checkpoints are not available in demo mode.");
    });
  }

  private run<T>(fn: () => T): Promise<T> {
    const run = this.tail.then(
      () => this.transact(fn),
      () => this.transact(fn),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private transact<T>(fn: () => T): T {
    this.pull();
    const result = fn();
    this.saveLedger();
    this.saveSession();
    return result;
  }

  private onRemoteLedger(): void {
    if (this.applyingLedger) return;
    try {
      this.pull();
      this.publish();
    } catch {
      // A bad ledger must not take down the tab that already has the record.
    }
  }

  private pull(): void {
    if (!this.ledger) return;
    let raw: string | null;
    try {
      raw = this.ledger.read();
    } catch {
      this.ledgerBlocked = true;
      return;
    }
    if (!raw) {
      this.ledgerBlocked = false;
      return;
    }
    const file = parseDemoLedger(raw);
    if (!file) {
      this.ledgerBlocked = true;
      return;
    }
    this.ledgerBlocked = false;
    if (file.nextIdentity > this.nextIdentity) this.nextIdentity = file.nextIdentity;
    for (const world of file.worlds) this.mergeStoredWorld(world);
  }

  private saveLedger(): void {
    if (!this.ledger || this.ledgerBlocked) return;
    this.applyingLedger = true;
    try {
      this.ledger.write(
        serializeDemoLedger({
          v: 1,
          nextIdentity: this.nextIdentity,
          worlds: [...this.worlds.values()].map((world) => this.snapshotWorld(world)),
        }),
      );
    } catch {
      this.ledgerBlocked = true;
    } finally {
      this.applyingLedger = false;
    }
  }

  private saveSession(): void {
    if (!this.session || !this.currentId || !this.viewer) return;
    try {
      this.session.write(serializeDemoSession({ v: 1, identity: this.viewer, currentId: this.currentId }));
    } catch {
      // The ledger still holds the record. This tab can rejoin from the link.
    }
  }

  private restoreSession(): void {
    if (!this.session) return;
    let raw: string | null;
    try {
      raw = this.session.read();
    } catch {
      return;
    }
    if (!raw) return;
    const session = parseDemoSession(raw);
    if (!session) return;
    const world = this.worlds.get(session.currentId);
    if (!world?.members.some((member) => member.identity === session.identity)) return;
    this.viewer = session.identity;
    this.currentId = session.currentId;
  }

  private snapshotWorld(world: World): LedgerWorld {
    return {
      id: world.id,
      createdAt: world.createdAt.toISOString(),
      nextMemberId: world.nextMemberId.toString(),
      members: world.members.map((member) => this.snapshotMember(member)),
      invites: world.invites.map((invite) => ({ ...invite })),
      events: world.events.map((event) => ({
        channel: event.channel,
        seq: event.seq.toString(),
        eventId: event.eventId,
        author: event.author ? { ...event.author } : null,
        serverTs: event.serverTs.toISOString(),
        sentAt: event.sentAt ? event.sentAt.toISOString() : null,
        payload: event.payload,
        verdict: {
          ok: event.verdict.ok,
          failures: [...event.verdict.failures],
          warnings: [...event.verdict.warnings],
        },
      })),
    };
  }

  private snapshotMember(member: RosterEntry): LedgerMember {
    return {
      memberId: member.memberId.toString(),
      identity: member.identity,
      displayName: member.displayName,
      role: member.role,
      state: member.state,
      fingerprint: member.fingerprint,
      safetyCode: member.safetyCode,
      joinedAt: member.joinedAt.toISOString(),
      ...(member.admittedAt ? { admittedAt: member.admittedAt.toISOString() } : {}),
      ...(member.revokedAt ? { revokedAt: member.revokedAt.toISOString() } : {}),
      demoLinkMatched: member.demoLinkMatched,
    };
  }

  private mergeStoredWorld(stored: LedgerWorld): void {
    const existing = this.worlds.get(stored.id);
    if (!existing) {
      if (this.worlds.size >= MAX_INCIDENTS_PER_IDENTITY) return;
      const created = this.worldFromLedger(stored);
      if (created) this.worlds.set(stored.id, created);
      return;
    }
    const nextMemberId = BigInt(stored.nextMemberId);
    if (nextMemberId > existing.nextMemberId) existing.nextMemberId = nextMemberId;
    const createdAt = new Date(stored.createdAt);
    if (createdAt < existing.createdAt) existing.createdAt = createdAt;
    for (const invite of stored.invites) {
      const found = existing.invites.find((item) => item.token === invite.token);
      if (!found) {
        existing.invites.push({ ...invite });
        continue;
      }
      found.used = found.used || invite.used;
      if (invite.expiresAt > found.expiresAt) found.expiresAt = invite.expiresAt;
    }
    for (const member of stored.members) {
      const parsed = this.memberFromLedger(member);
      const found = existing.members.find((item) => item.memberId === parsed.memberId);
      if (!found) {
        if (existing.members.length >= MAX_MEMBERS) continue;
        existing.members.push(parsed);
        continue;
      }
      this.mergeMember(found, parsed);
    }
    for (const event of stored.events) {
      if (existing.events.some((item) => item.eventId === event.eventId)) continue;
      const parsed = this.eventFromLedger(event);
      if (parsed) existing.events.push(parsed);
    }
  }

  private worldFromLedger(stored: LedgerWorld): World | null {
    const members = stored.members.map((member) => this.memberFromLedger(member));
    if (members.length === 0) return null;
    const events = stored.events.flatMap((event) => {
      const parsed = this.eventFromLedger(event);
      return parsed ? [parsed] : [];
    });
    return {
      id: stored.id,
      createdAt: new Date(stored.createdAt),
      members,
      events,
      invites: stored.invites.map((invite) => ({ ...invite })),
      nextMemberId: BigInt(stored.nextMemberId),
    };
  }

  private memberFromLedger(member: LedgerMember): RosterEntry {
    return {
      memberId: BigInt(member.memberId),
      identity: member.identity,
      displayName: member.displayName,
      role: member.role,
      state: member.state,
      fingerprint: member.fingerprint,
      safetyCode: member.safetyCode,
      joinedAt: new Date(member.joinedAt),
      ...(member.admittedAt ? { admittedAt: new Date(member.admittedAt) } : {}),
      ...(member.revokedAt ? { revokedAt: new Date(member.revokedAt) } : {}),
      demoLinkMatched: member.demoLinkMatched,
    };
  }

  private mergeMember(target: RosterEntry, incoming: RosterEntry): void {
    if (incoming.demoLinkMatched) target.demoLinkMatched = true;
    if (memberStateRank(incoming.state) <= memberStateRank(target.state)) return;
    target.state = incoming.state;
    if (incoming.admittedAt) target.admittedAt = incoming.admittedAt;
    if (incoming.revokedAt) target.revokedAt = incoming.revokedAt;
  }

  private eventFromLedger(event: LedgerEvent): VerifiedEvent | null {
    return {
      channel: event.channel,
      seq: BigInt(event.seq),
      eventId: event.eventId,
      author: event.author ? { ...event.author } : null,
      serverTs: new Date(event.serverTs),
      sentAt: event.sentAt ? new Date(event.sentAt) : null,
      payload: event.payload,
      verdict: {
        ok: event.verdict.ok,
        failures: [...event.verdict.failures],
        warnings: [...event.verdict.warnings],
      },
    };
  }

  private origin(): string {
    if (this.options.origin) return this.options.origin;
    if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
    return "http://localhost:3001";
  }

  private cleanName(raw: string): string {
    const name = normalizeDisplayName(raw);
    if (!isValidDisplayName(name)) throw new Error("Enter a display name of 1 to 40 characters.");
    return name;
  }

  private viewerFor(world: World, viewer: MockViewer): string {
    if (viewer === "pending") {
      const pending = world.members.find((member) => member.state === "pending");
      if (!pending) throw new Error("The demo scenario has no pending member.");
      return pending.identity;
    }
    const match = world.members.find((member) => member.role === viewer && member.state === "active");
    if (!match) throw new Error("The demo scenario is missing that role.");
    return match.identity;
  }

  private currentWorld(): World {
    const world = this.currentId ? this.worlds.get(this.currentId) : undefined;
    if (!world) throw new Error("No incident is open.");
    return world;
  }

  private me(world: World): RosterEntry {
    const member = world.members.find((item) => item.identity === this.viewer);
    if (!member) throw new Error("You are not a member of this incident.");
    return member;
  }

  private requireCommander(): World {
    const world = this.currentWorld();
    const member = this.me(world);
    if (member.state !== "active" || member.role !== "commander") {
      throw new Error("Only the commander can do this.");
    }
    return world;
  }

  private write(channel: ChannelKind, kind: PayloadKind, body: unknown): void {
    const world = this.currentWorld();
    const member = this.me(world);
    if (member.state !== "active") throw new Error("You are not an active member of this incident.");
    if (!isKindAllowed(kind, channel, member.role)) throw new Error("Your role cannot add this to the incident.");
    this.push(world, channel, member, kind, body);
    this.publish();
  }

  private push(world: World, channel: ChannelKind, member: RosterEntry, kind: PayloadKind, body: unknown): void {
    const at = new Date(this.now()).toISOString();
    const parsed = PayloadSchema.safeParse({ v: PAYLOAD_VERSION, kind, sentAt: at, body });
    if (!parsed.success) throw new Error("That update was rejected.");
    this.pushParsed(world, channel, member, parsed.data, at);
  }

  private pushParsed(
    world: World,
    channel: ChannelKind,
    member: RosterEntry,
    payload: Payload,
    at: string,
  ): void {
    let max = 0n;
    for (const event of world.events) {
      if (event.channel === channel && event.seq > max) max = event.seq;
    }
    world.events.push({
      channel,
      seq: max + 1n,
      eventId: crypto.randomUUID(),
      author: { identity: member.identity, displayName: member.displayName, role: member.role },
      serverTs: new Date(at),
      sentAt: new Date(at),
      payload,
      verdict: { ok: true, failures: [], warnings: [] },
    });
  }

  private toView(member: RosterEntry, flags: { self: boolean; commander: boolean }): MemberView {
    const showCode = flags.self || (flags.commander && member.state === "pending");
    const view: MemberView = {
      identity: member.identity,
      displayName: member.displayName,
      role: member.role,
      memberId: member.memberId,
      state: member.state,
      fingerprint: member.fingerprint,
      verified: false,
      joinedAt: member.joinedAt,
    };
    if (member.admittedAt) view.admittedAt = member.admittedAt;
    if (member.revokedAt) view.revokedAt = member.revokedAt;
    if (showCode) view.safetyCode = member.safetyCode;
    if (flags.commander && member.state === "pending") view.linkVerified = member.demoLinkMatched;
    return view;
  }

  private publish(): void {
    const at = new Date(this.now());
    const world = this.currentId ? this.worlds.get(this.currentId) : undefined;
    if (!world) {
      this.state = freezeDeep(blank("error", at, "No incident is open."));
      this.emit();
      return;
    }
    const member = world.members.find((item) => item.identity === this.viewer);
    if (!member) {
      this.state = freezeDeep(blank("error", at, "You are not a member of this incident."));
      this.emit();
      return;
    }
    const commanderSession = member.role === "commander" && member.state === "active";
    if (member.state === "revoked") {
      const view = this.toView(member, { self: true, commander: false });
      this.state = freezeDeep({ ...blank("ready", at), me: view, members: [view] });
      this.emit();
      return;
    }
    const readable = member.state === "active" ? readableChannels(member.role) : [];
    const roster = member.state === "pending"
      ? world.members.filter((item) => item.role === "commander" || item.identity === member.identity)
      : world.members;
    const views = roster
      .map((item) => this.toView(item, { self: item.identity === member.identity, commander: commanderSession }))
      .sort((a, b) =>
        a.role === "commander" ? -1 : b.role === "commander" ? 1 : a.joinedAt.getTime() - b.joinedAt.getTime(),
      );
    const visible = world.events.filter((event) => readable.includes(event.channel));
    const folded = foldEvents(visible, views, readable);
    const integrity: IntegrityReport = {
      ok: true,
      checkedAt: at,
      channels: {},
      rosterFailures: [],
    };
    for (const kind of readable) {
      const report = channelIntegrity(visible.filter((event) => event.channel === kind));
      if (report) {
        integrity.channels[kind] = report;
        if (!report.ok) integrity.ok = false;
      }
    }
    const commander = views.find((item) => item.role === "commander") ?? null;
    const { title, ...rest } = folded;
    this.state = freezeDeep({
      ...rest,
      connection: "ready",
      me: views.find((item) => item.identity === member.identity) ?? null,
      incident: commander
        ? { id: world.id, title: title ?? "", createdAt: world.createdAt, commander }
        : null,
      members: views,
      integrity,
    });
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export function createMockIncidentClient(options?: MockClientOptions): IncidentClient {
  return new MockIncidentClient(options);
}
