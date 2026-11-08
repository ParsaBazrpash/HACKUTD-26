// Org roster, enrollment and paging for the demo client (WP4).
//
// Everything here is demo data. It does not seal, sign, hash or call a carrier,
// and it never stores a phone number: the number a caller types is checked for
// E.164 shape and then dropped. Paging is a simulated timeline. When a store is
// attached, the org (or the fact that this browser left) is kept there so a
// reload does not put the seeded clinic back.
//
// MockIncidentClient owns the incident world. This class reaches it only through
// the hooks below, so the incident rules (roles, channels) stay in mock.ts.

import {
  createOrgFixture,
  ORG_DEMO_LABEL,
  type OrgMemberSeed,
  type PhoneBehavior,
} from "@/lib/scenario/org";
import { demoFingerprint, demoSafety } from "@/lib/scenario/demo-codes";
import type { OrgView, PageStatus, PageView, RosterMember } from "@/lib/client/types";
import { parseDemoOrg, serializeDemoOrg, type DemoOrgStore, type StoredOrg } from "@/lib/client/demo-org-store";
import {
  ENROLL_LINK_CODE_LEN,
  isE164,
  isValidEnrollTtlHours,
  isValidOrgName,
  MAX_ORG_REASON,
  MAX_PAGE_TARGETS,
  normalizeOrgName,
} from "@/spacetimedb/src/shared/org";
import { displayNameKey, isUuidV4 } from "@/spacetimedb/src/shared/limits";

type PickRole = "counsel" | "technical" | "executive";

export interface OrgPerson {
  identity: string;
  displayName: string;
  role: PickRole;
  fingerprint: string;
  safetyCode: string;
}

/** Simulated page timeline, in milliseconds after the page request. */
export const PAGE_TIMELINE_MS = {
  calling: 500,
  ringing: 1500,
  acknowledged: 4000,
  joined: 7000,
  noAnswer: 20_000,
} as const;

export const MAX_OPEN_ENROLL_LINKS = 10;
const MAX_ROSTER = 50;

export interface MockOrgHooks {
  now(): number;
  origin(): string;
  /** True when the viewing tab is the active incident commander (the org admin). */
  isAdmin(): boolean;
  /** Identity and fingerprint of the viewing tab, used when an org is created. */
  viewer(): { identity: string; fingerprint: string };
  /** Normalizes and validates a display name, throwing a user-facing error. */
  cleanName(raw: string): string;
  /** True when the identity is an active member of the open incident. */
  inIncident(identity: string): boolean;
  /** Adds active incident members. The hook skips identities already in the incident. */
  admit(people: OrgPerson[]): void;
  /** Revokes the identity's incident membership, if it has one. */
  revokeFromIncident(identity: string): void;
  /** Posts "I'm here" in the incident as that person. */
  announce(identity: string, displayName: string): void;
  /** State changed: publish a new snapshot. */
  changed(): void;
}

interface OrgMemberRow extends OrgMemberSeed {
  attempts: number;
  revokedAt: Date | null;
  /** Role the person was last picked for. */
  role: PickRole;
}

interface EnrollLink {
  code: string;
  expiresAt: number;
}

interface PageRow {
  view: PageView;
  timers: ReturnType<typeof setTimeout>[];
}

interface OrgState {
  orgId: string;
  name: string;
  adminIdentity: string;
  adminFingerprint: string;
  members: OrgMemberRow[];
  links: EnrollLink[];
  nextMemberId: bigint;
  nextSerial: number;
}

export interface OrgSlice {
  org: OrgView | null;
  roster: RosterMember[];
  pages: PageView[];
}

export interface MockOrgOptions {
  /** Start with the seeded Lakeside org. Defaults to true. False starts with no org. A saved record wins over both. */
  seed?: boolean;
  /** When set, a leave or a created org is read back the next time a client opens. */
  store?: DemoOrgStore | null;
}

function parseEnrollFragment(fragment: string): { orgId: string; code: string } | "live" | null {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(raw);
  if (params.has("c") || params.has("s") || params.has("f")) return "live";
  if (params.get("demo") !== "1") return null;
  const orgId = params.get("o");
  const code = params.get("t");
  if (!orgId || !isUuidV4(orgId) || !code) return null;
  return { orgId, code };
}

function randomCode(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, ENROLL_LINK_CODE_LEN);
}

export class MockOrg {
  private org: OrgState | null;
  private readonly pages = new Map<bigint, PageRow>();
  private readonly store: DemoOrgStore | null;
  private disposed = false;

  constructor(
    private readonly hooks: MockOrgHooks,
    options: MockOrgOptions = {},
  ) {
    this.store = options.store ?? null;
    const saved = this.readStore();
    if (saved) this.org = saved.org;
    else this.org = options.seed === false ? null : this.fromFixture();
  }

  /** Writes the current org, including a deliberate leave (`org: null`). */
  serialize(): string {
    return serializeDemoOrg({ v: 1, org: this.org ? this.toStored(this.org) : null });
  }

  /**
   * Replaces the in-memory org from the store. Page timers are dropped.
   * Returns false when there is nothing new to apply.
   */
  reload(): boolean {
    const saved = this.readStore();
    if (!saved) return false;
    for (const row of this.pages.values()) this.clear(row);
    this.pages.clear();
    this.org = saved.org;
    return true;
  }

  private readStore(): { org: OrgState | null } | null {
    if (!this.store) return null;
    let raw: string | null;
    try {
      raw = this.store.read();
    } catch {
      return null;
    }
    if (!raw) return null;
    const file = parseDemoOrg(raw);
    if (!file) return null;
    return { org: file.org ? this.fromStored(file.org) : null };
  }

  /** Clears every pending page timer. The org keeps its state. */
  dispose(): void {
    this.disposed = true;
    for (const row of this.pages.values()) this.clear(row);
  }

  slice(): OrgSlice {
    const org = this.org;
    if (!org) return { org: null, roster: [], pages: [] };
    return {
      org: {
        orgId: org.orgId,
        name: org.name,
        myRole: this.hooks.isAdmin() ? "admin" : "member",
        adminFingerprint: org.adminFingerprint,
      },
      roster: org.members.map((m) => ({
        orgMemberId: m.orgMemberId,
        identity: m.identity,
        displayName: m.displayName,
        state: m.state,
        fingerprint: m.fingerprint,
        safetyCode: m.safetyCode,
        enrolledAt: m.enrolledAt,
        approvedAt: m.approvedAt,
        keyChanged: m.keyChanged,
      })),
      pages: [...this.pages.values()].map((row) => row.view),
    };
  }

  createOrg(input: { name: string; displayName: string; phone: string }): { orgId: string } {
    if (this.org) throw new Error("This demo already has an org.");
    const name = normalizeOrgName(input.name);
    if (!isValidOrgName(name)) throw new Error("Enter an org name of 1 to 80 characters.");
    const displayName = this.hooks.cleanName(input.displayName);
    if (!isE164(input.phone)) throw new Error("Enter the phone number in international format, like +15555550123.");
    const me = this.hooks.viewer();
    const at = new Date(this.hooks.now());
    const admin: OrgMemberRow = {
      orgMemberId: 1n,
      identity: me.identity,
      displayName,
      state: "active",
      fingerprint: me.fingerprint,
      safetyCode: demoSafety(1),
      enrolledAt: at,
      approvedAt: at,
      keyChanged: false,
      suggestedRole: "executive",
      phoneBehavior: "answers",
      attempts: 0,
      revokedAt: null,
      role: "executive",
    };
    this.org = {
      orgId: crypto.randomUUID(),
      name,
      adminIdentity: me.identity,
      adminFingerprint: me.fingerprint,
      members: [admin],
      links: [],
      nextMemberId: 2n,
      nextSerial: 0x300,
    };
    this.hooks.changed();
    return { orgId: this.org.orgId };
  }

  createEnrollLink(input: { ttlHours: number }): { url: string; qr: string | null } {
    const org = this.requireAdmin();
    if (!isValidEnrollTtlHours(input.ttlHours)) throw new Error("Enrollment links last 1 to 24 hours.");
    const now = this.hooks.now();
    org.links = org.links.filter((link) => link.expiresAt > now);
    if (org.links.length >= MAX_OPEN_ENROLL_LINKS) throw new Error("Too many open enrollment links.");
    const code = randomCode();
    org.links.push({ code, expiresAt: now + input.ttlHours * 3_600_000 });
    const url = `${this.hooks.origin()}/enroll#demo=1&o=${encodeURIComponent(org.orgId)}&t=${encodeURIComponent(code)}`;
    return { url, qr: null };
  }

  enroll(input: { fragment: string; displayName: string; phone: string }): { safetyCode: string } {
    const parsed = parseEnrollFragment(input.fragment);
    if (parsed === "live") throw new Error("Demo mode cannot use a live enrollment link.");
    if (!parsed) throw new Error("This demo enrollment link is not valid.");
    const org = this.org;
    if (!org || org.orgId !== parsed.orgId) {
      throw new Error("This demo enrollment link is not for an org in this browser.");
    }
    const now = this.hooks.now();
    const link = org.links.find((item) => item.code === parsed.code);
    if (!link) throw new Error("This demo enrollment link is not valid.");
    if (link.expiresAt <= now) throw new Error("This demo enrollment link has expired.");
    const displayName = this.hooks.cleanName(input.displayName);
    if (!isE164(input.phone)) throw new Error("Enter the phone number in international format, like +15555550123.");
    if (org.members.some((m) => m.state !== "revoked" && displayNameKey(m.displayName) === displayNameKey(displayName))) {
      throw new Error("That display name is already in use.");
    }
    if (org.members.length >= MAX_ROSTER) throw new Error("This org cannot add another person.");
    const serial = org.nextSerial++;
    const row: OrgMemberRow = {
      orgMemberId: org.nextMemberId++,
      identity: serial.toString(16).padStart(64, "0"),
      displayName,
      state: "pending",
      fingerprint: demoFingerprint(serial),
      safetyCode: demoSafety(serial),
      enrolledAt: new Date(now),
      approvedAt: null,
      keyChanged: false,
      suggestedRole: "technical",
      phoneBehavior: "answers",
      attempts: 0,
      revokedAt: null,
      role: "technical",
    };
    org.members.push(row);
    this.hooks.changed();
    return { safetyCode: row.safetyCode };
  }

  approveMember(orgMemberId: bigint): void {
    const org = this.requireAdmin();
    const target = this.find(org, orgMemberId);
    if (target.state !== "pending") throw new Error("That person is not waiting for approval.");
    target.state = "active";
    target.approvedAt = new Date(this.hooks.now());
    this.hooks.changed();
  }

  leaveOrg(): void {
    if (!this.org) throw new Error("You are not in an org.");
    for (const row of this.pages.values()) this.clear(row);
    this.pages.clear();
    this.org = null;
    this.hooks.changed();
  }

  revokeOrgMember(orgMemberId: bigint, reason: string): void {
    const org = this.requireAdmin();
    if (typeof reason !== "string" || reason.length > MAX_ORG_REASON) {
      throw new Error(`Reason must be ${MAX_ORG_REASON} characters or fewer.`);
    }
    const target = this.find(org, orgMemberId);
    if (target.identity === org.adminIdentity) throw new Error("The org admin cannot be revoked.");
    if (target.state === "revoked") throw new Error("That person is already revoked.");
    target.state = "revoked";
    target.revokedAt = new Date(this.hooks.now());
    const row = this.pages.get(target.orgMemberId);
    if (row) {
      this.clear(row);
      this.pages.delete(target.orgMemberId);
    }
    this.hooks.revokeFromIncident(target.identity);
    this.hooks.changed();
  }

  addFromRoster(picks: { orgMemberId: bigint; role: PickRole }[]): void {
    const org = this.requireAdmin();
    if (!Array.isArray(picks) || picks.length === 0) throw new Error("Pick at least one person.");
    if (picks.length > MAX_PAGE_TARGETS) throw new Error(`Pick at most ${MAX_PAGE_TARGETS} people at a time.`);
    const seen = new Set<bigint>();
    const people: OrgPerson[] = [];
    const chosen: [OrgMemberRow, PickRole][] = [];
    for (const pick of picks) {
      if (pick.role !== "counsel" && pick.role !== "technical" && pick.role !== "executive") {
        throw new Error("That role cannot be added from the roster.");
      }
      if (seen.has(pick.orgMemberId)) throw new Error("Each person can be picked once.");
      seen.add(pick.orgMemberId);
      const target = this.find(org, pick.orgMemberId);
      if (target.state !== "active") throw new Error(`${target.displayName} is not an approved org member.`);
      chosen.push([target, pick.role]);
      people.push({
        identity: target.identity,
        displayName: target.displayName,
        role: pick.role,
        fingerprint: target.fingerprint,
        safetyCode: target.safetyCode,
      });
    }
    this.hooks.admit(people);
    for (const [target, role] of chosen) target.role = role;
    this.hooks.changed();
  }

  page(orgMemberIds: bigint[]): { pageId: string } {
    const org = this.requireAdmin();
    if (!Array.isArray(orgMemberIds) || orgMemberIds.length === 0) throw new Error("Pick at least one person to page.");
    if (orgMemberIds.length > MAX_PAGE_TARGETS) throw new Error(`Page at most ${MAX_PAGE_TARGETS} people at a time.`);
    if (new Set(orgMemberIds).size !== orgMemberIds.length) throw new Error("Each person can be paged once.");
    const targets = orgMemberIds.map((id) => {
      const target = this.find(org, id);
      if (target.state !== "active") throw new Error(`${target.displayName} is not an approved org member.`);
      if (!this.hooks.inIncident(target.identity)) {
        throw new Error(`${target.displayName} is not in the incident yet. Add them from the roster first.`);
      }
      return target;
    });
    const pageId = crypto.randomUUID();
    for (const target of targets) this.startPage(target, pageId);
    this.hooks.changed();
    return { pageId };
  }

  // --- internals -----------------------------------------------------------------

  private startPage(target: OrgMemberRow, pageId: string): void {
    const previous = this.pages.get(target.orgMemberId);
    if (previous) this.clear(previous);
    const attempt = target.attempts++;
    const behavior: PhoneBehavior = attempt === 0 ? target.phoneBehavior : "answers";
    const row: PageRow = {
      view: {
        pageId,
        orgMemberId: target.orgMemberId,
        displayName: target.displayName,
        role: target.role,
        status: "requested",
        carrierReported: false,
        joined: previous?.view.joined ?? false,
        updatedAt: new Date(this.hooks.now()),
      },
      timers: [],
    };
    this.pages.set(target.orgMemberId, row);
    const set = (status: PageStatus, carrierReported: boolean, joined = false) => {
      if (this.disposed || this.pages.get(target.orgMemberId) !== row) return;
      row.view = {
        ...row.view,
        status,
        carrierReported,
        joined: row.view.joined || joined,
        updatedAt: new Date(this.hooks.now()),
      };
      this.hooks.changed();
    };
    const at = (ms: number, fn: () => void) => row.timers.push(setTimeout(fn, ms));
    at(PAGE_TIMELINE_MS.calling, () => set("calling", false));
    at(PAGE_TIMELINE_MS.ringing, () => set("ringing", false));
    if (behavior === "no_answer_first") {
      at(PAGE_TIMELINE_MS.noAnswer, () => set("no_answer", true));
      return;
    }
    at(PAGE_TIMELINE_MS.acknowledged, () => set("acknowledged", true));
    at(PAGE_TIMELINE_MS.joined, () => {
      if (this.disposed || this.pages.get(target.orgMemberId) !== row) return;
      const first = !row.view.joined;
      set("acknowledged", true, true);
      if (first) this.hooks.announce(target.identity, target.displayName);
    });
  }

  private clear(row: PageRow): void {
    for (const timer of row.timers) clearTimeout(timer);
    row.timers = [];
  }

  private find(org: OrgState, orgMemberId: bigint): OrgMemberRow {
    const target = typeof orgMemberId === "bigint" ? org.members.find((m) => m.orgMemberId === orgMemberId) : undefined;
    if (!target) throw new Error("That person is not on this org's roster.");
    return target;
  }

  private requireAdmin(): OrgState {
    if (!this.org) throw new Error("Create an org first.");
    if (!this.hooks.isAdmin()) throw new Error("Only the org admin can do this.");
    return this.org;
  }

  private toStored(org: OrgState): StoredOrg {
    return {
      orgId: org.orgId,
      name: org.name,
      adminIdentity: org.adminIdentity,
      adminFingerprint: org.adminFingerprint,
      nextMemberId: org.nextMemberId.toString(),
      nextSerial: org.nextSerial,
      links: org.links.map((link) => ({ code: link.code, expiresAt: link.expiresAt })),
      members: org.members.map((member) => ({
        orgMemberId: member.orgMemberId.toString(),
        identity: member.identity,
        displayName: member.displayName,
        state: member.state,
        fingerprint: member.fingerprint,
        safetyCode: member.safetyCode,
        enrolledAt: member.enrolledAt.toISOString(),
        approvedAt: member.approvedAt ? member.approvedAt.toISOString() : null,
        keyChanged: member.keyChanged,
        suggestedRole: member.suggestedRole,
        phoneBehavior: member.phoneBehavior,
        attempts: member.attempts,
        revokedAt: member.revokedAt ? member.revokedAt.toISOString() : null,
        role: member.role,
      })),
    };
  }

  private fromStored(org: StoredOrg): OrgState {
    return {
      orgId: org.orgId,
      name: org.name,
      adminIdentity: org.adminIdentity,
      adminFingerprint: org.adminFingerprint,
      nextMemberId: BigInt(org.nextMemberId),
      nextSerial: org.nextSerial,
      links: org.links.map((link) => ({ code: link.code, expiresAt: link.expiresAt })),
      members: org.members.map((member) => ({
        orgMemberId: BigInt(member.orgMemberId),
        identity: member.identity,
        displayName: member.displayName,
        state: member.state,
        fingerprint: member.fingerprint,
        safetyCode: member.safetyCode,
        enrolledAt: new Date(member.enrolledAt),
        approvedAt: member.approvedAt ? new Date(member.approvedAt) : null,
        keyChanged: member.keyChanged,
        suggestedRole: member.suggestedRole,
        phoneBehavior: member.phoneBehavior,
        attempts: member.attempts,
        revokedAt: member.revokedAt ? new Date(member.revokedAt) : null,
        role: member.role,
      })),
    };
  }

  private fromFixture(): OrgState {
    const fixture = createOrgFixture();
    return {
      orgId: fixture.orgId,
      name: fixture.name,
      adminIdentity: fixture.adminIdentity,
      adminFingerprint: fixture.adminFingerprint,
      members: fixture.members.map((m) => ({
        ...m,
        attempts: 0,
        revokedAt: m.state === "revoked" ? m.enrolledAt : null,
        role: m.suggestedRole,
      })),
      links: [],
      nextMemberId: BigInt(fixture.members.length + 1),
      nextSerial: 0x300,
    };
  }
}

export { ORG_DEMO_LABEL };
