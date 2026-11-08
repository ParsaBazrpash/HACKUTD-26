// IncidentClient interface and state shape (docs/PLAN.md 6.1 and 6.2).
//
// This is the seam between Lane A (RealIncidentClient) and Lane B (UI and
// MockIncidentClient). Frozen after Sync 1. Types only, no runtime code.

import type { ChannelKind, MemberStateName, Role } from '@/spacetimedb/src/shared/policy';
import type {
  ChatBody,
  DeadlineBody,
  DiscoveryBody,
  EvidenceBody,
  Payload,
  PayloadKind,
  ProfileBody,
  ScopeBody,
  Severity,
  Phase,
  StatusBody,
  TaskBody,
  TimelineBody,
} from '@/lib/protocol/events';

export type {
  ChatBody,
  DeadlineBody,
  DiscoveryBody,
  EvidenceBody,
  Phase,
  ProfileBody,
  ScopeBody,
  Severity,
  StatusBody,
  TaskBody,
  TimelineBody,
};

// --- People ----------------------------------------------------------------

/** Lightweight reference to an author. `identity` is lowercase hex. */
export interface MemberRef {
  identity: string;
  displayName: string;
  role: Role;
}

export interface MemberView extends MemberRef {
  /** Server row id; use it with admitMember and revokeMember. */
  memberId: bigint;
  state: MemberStateName;
  /** 8 groups of 4 hex characters, e.g. "a1b2 c3d4 ...". */
  fingerprint: string;
  /** True when the member's admitSig verifies under the pinned commander key. */
  verified: boolean;
  /** Set when the member was added from the org roster: the roster row (org member id) they were added under. */
  rosterId?: bigint;
  /** Commander view of a pending member: the joinTag matched the invite secret. */
  linkVerified?: boolean;
  /** "123 456 789 012". Shown to me, and to the commander for pending members. */
  safetyCode?: string;
  /** Live presence from the server: true while any of their browsers is connected. Unset when unknown. */
  online?: boolean;
  /** When their last browser connected or left. Unset when the server has never seen them since presence started. */
  lastSeenAt?: Date;
  joinedAt: Date;
  admittedAt?: Date;
  revokedAt?: Date;
}

// --- Verification ----------------------------------------------------------

/** Why an event failed verification (PLAN 4.9). */
export type FailureReason =
  | 'gap' // seq is not previous + 1
  | 'chain_broken' // prevHash or recomputed hash does not match
  | 'unknown_author' // author has no valid admission certificate
  | 'revoked_author' // author was revoked before this event
  | 'bad_signature'
  | 'cannot_decrypt' // tampered ciphertext, wrong AAD or wrong key
  | 'invalid_payload' // zod failed
  | 'unknown_kind'
  | 'not_permitted' // kind or role not allowed in this channel
  | 'replay' // duplicate clientEventId or non-increasing counter
  | 'stale_epoch' // appended in an epoch older than the channel had already reached
  | 'history_rewritten'; // contradicts the pinned head

export type WarningReason = 'clock_drift' | 'waiting_for_keys';

export interface Verdict {
  ok: boolean;
  failures: FailureReason[];
  warnings: WarningReason[];
}

export interface ChannelIntegrity {
  ok: boolean;
  eventsChecked: number;
  failures: { seq: bigint; reason: FailureReason; detail?: string }[];
  /** Head of the chain as the server presents it. */
  head: { seq: bigint; hashHex: string } | null;
  /** False when the head contradicts the head pinned in IndexedDB. */
  pinnedOk: boolean;
  /** Events exist that cannot be decrypted yet because keys have not arrived. */
  waitingForKeys: boolean;
  latestCheckpoint?: { seq: bigint; hashHex: string; verified: boolean };
}

export interface IntegrityReport {
  ok: boolean;
  checkedAt: Date;
  /** Only channels the caller's role can read. */
  channels: Partial<Record<ChannelKind, ChannelIntegrity>>;
  /** Roster problems (bad admission certificates, key mismatch with the pinned commander). */
  rosterFailures: { identity: string; reason: string }[];
}

// --- Events as the fold sees them -------------------------------------------

/**
 * One event after (or instead of) decryption and verification. The mock builds
 * these directly from a scenario; the real client builds them in verify.ts.
 * `payload` is null when the event could not be decrypted or parsed.
 */
export interface VerifiedEvent {
  channel: ChannelKind;
  seq: bigint;
  /** clientEventId. */
  eventId: string;
  author: MemberRef | null;
  serverTs: Date;
  /** The author-signed sentAt, when the payload was readable. */
  sentAt: Date | null;
  payload: Payload | null;
  verdict: Verdict;
}

// --- Org roster and paging (WP0) ---------------------------------------------

export interface OrgView {
  orgId: string;
  name: string;
  myRole: 'admin' | 'member';
  /** Full admin fingerprint (formatted) that members pin at enrollment. */
  adminFingerprint: string;
}

export interface RosterMember {
  orgMemberId: bigint;
  /** Lowercase hex Spacetime identity. */
  identity: string;
  displayName: string;
  state: 'pending' | 'active' | 'revoked';
  fingerprint: string;
  /** Spoken during approval, like the incident safety code. */
  safetyCode: string;
  enrolledAt: Date;
  approvedAt: Date | null;
  /** True when the member's key differs from the one pinned earlier. */
  keyChanged: boolean;
}

export type PageStatus = 'requested' | 'calling' | 'ringing' | 'acknowledged' | 'no_answer' | 'busy' | 'failed';

export interface PageView {
  pageId: string;
  orgMemberId: bigint;
  displayName: string;
  role: Role;
  status: PageStatus;
  /** True when the status came from the carrier callback, not the commander. */
  carrierReported: boolean;
  joined: boolean;
  updatedAt: Date;
}

// --- State -----------------------------------------------------------------

export interface ChannelMessage {
  seq: bigint;
  messageId: string;
  author: MemberRef | null;
  sentAt: Date;
  serverTs: Date;
  text: string;
  mentions: string[];
  replyTo?: string;
  verdict: Verdict;
}

export interface ChannelView {
  kind: ChannelKind;
  messages: ChannelMessage[];
  /** True when some events cannot be read yet because keys are missing. */
  waitingForKeys: boolean;
}

/** Common provenance for folded items. */
export interface Provenance {
  seq: bigint;
  by: MemberRef | null;
  at: Date; // serverTs
  sentAt: Date | null;
  verdict: Verdict;
}

export interface TimelineItem extends Provenance {
  entry: TimelineBody;
  /** entryIds of entries that amend this one. */
  amendedBy: string[];
}

export interface ScopeVersion extends Provenance {
  body: ScopeBody;
}
export interface ScopeItem {
  itemId: string;
  latest: ScopeBody;
  /** Oldest first, including the latest. */
  history: ScopeVersion[];
}

export interface TaskVersion extends Provenance {
  body: TaskBody;
}
export interface Task {
  taskId: string;
  latest: TaskBody;
  history: TaskVersion[];
}

export interface DeadlineUpdate extends Provenance {
  body: DeadlineBody;
}

export interface Evidence extends Provenance {
  body: EvidenceBody;
}

export interface IncidentState {
  connection: 'connecting' | 'ready' | 'offline' | 'error';
  me: MemberView | null; // includes role, state, safetyCode
  incident: { id: string; title: string; createdAt: Date; commander: MemberView } | null;
  status: { severity: Severity; phase: Phase; summary: string; at: Date; by: MemberRef } | null;
  members: MemberView[]; // role, state, displayName, fingerprint, verified, linkVerified, safetyCode
  channels: ChannelView[]; // only readable ones
  timeline: TimelineItem[]; // sorted by occurredAt, amendments linked
  scope: ScopeItem[]; // latest per itemId, with history
  tasks: Task[];
  profile: ProfileBody;
  discovery: { determinedAt: Date; basis: string; by: MemberRef } | null;
  materiality: { determinedAt: Date; basis: string; by: MemberRef } | null;
  deadlineUpdates: Record<string, DeadlineUpdate>;
  evidence: Evidence[];
  integrity: IntegrityReport;
  /** Org roster and paging (WP0). Null and empty until the org features are built. */
  org: OrgView | null;
  roster: RosterMember[];
  pages: PageView[];
  /** Human-readable error when connection is 'error'. Never includes secrets. */
  error?: string;
}

/** Fold output; the client adds connection, identity, roster, incident row and integrity. */
export type FoldedState = Omit<IncidentState, 'connection' | 'me' | 'incident' | 'members' | 'integrity' | 'error' | 'org' | 'roster' | 'pages'> & {
  /** Latest `incident.title` from a verified event, or null. */
  title: string | null;
};

export const EMPTY_PROFILE: ProfileBody = {
  publicCompany: false,
  hipaaCoveredEntity: false,
  nydfsRegulated: false,
  defenseContractor: false,
  bank: false,
  euDataSubjects: false,
};

// --- Client ----------------------------------------------------------------

export interface IncidentClient {
  getState(): IncidentState; // immutable snapshot
  subscribe(listener: () => void): () => void; // for useSyncExternalStore
  // lifecycle
  createIncident(i: { title: string; displayName: string }): Promise<{ incidentId: string }>;
  openIncident(incidentId: string): Promise<void>;
  createInvite(i: {
    role: 'counsel' | 'technical' | 'executive';
    ttlMinutes?: number;
  }): Promise<{ url: string; expiresAt: Date }>;
  redeemInvite(i: { fragment: string; displayName: string }): Promise<void>;
  admitMember(memberId: bigint): Promise<void>;
  revokeMember(memberId: bigint, reason: string): Promise<void>;
  // #record actions (one per payload kind)
  setStatus(b: StatusBody): Promise<void>;
  addTimelineEntry(b: Omit<TimelineBody, 'entryId'>): Promise<void>;
  upsertScopeItem(b: ScopeBody): Promise<void>;
  upsertTask(b: TaskBody): Promise<void>;
  setProfile(b: ProfileBody): Promise<void>;
  recordDiscovery(b: DiscoveryBody): Promise<void>;
  recordMateriality(b: DiscoveryBody): Promise<void>;
  updateDeadline(b: DeadlineBody): Promise<void>;
  addEvidence(b: Omit<EvidenceBody, 'evidenceId'>): Promise<void>;
  // chat
  postMessage(channel: 'command' | 'privileged' | 'technical', b: Omit<ChatBody, 'messageId'>): Promise<void>;
  // integrity
  verifyAll(): Promise<IntegrityReport>;
  signCheckpoint(): Promise<void>; // P1
  // org roster and paging (WP0)
  createOrg(i: { name: string; displayName: string; phone: string }): Promise<{ orgId: string }>;
  createEnrollLink(i: { ttlHours: number }): Promise<{ url: string; qr: string | null }>;
  enroll(i: { fragment: string; displayName: string; phone: string }): Promise<{ safetyCode: string }>;
  approveMember(orgMemberId: bigint): Promise<void>;
  revokeOrgMember(orgMemberId: bigint, reason: string): Promise<void>;
  addFromRoster(picks: { orgMemberId: bigint; role: 'counsel' | 'technical' | 'executive' }[]): Promise<void>;
  /** Calling it again for the same people is the retry. */
  page(orgMemberIds: bigint[]): Promise<{ pageId: string }>;
  announcePresence(): Promise<void>;
}

export type { PayloadKind };
