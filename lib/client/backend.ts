// The narrow seam between RealIncidentClient and the data layer.
//
// `IncidentBackend` exposes plain rows (bigints, Uint8Arrays, lowercase-hex
// identities) from the `my_*` views and one method per module reducer. The
// production implementation wraps the generated Spacetime bindings
// (`spacetime-backend.ts`); tests use an in-process backend over the module
// test harness. Nothing here is incident plaintext: rows are ciphertext,
// signatures, public keys and structure.

import type { RawEvent } from '@/lib/crypto/verify';

export interface MemberRow {
  memberId: bigint;
  incidentId: string;
  identityHex: string;
  role: string;
  state: string; // 'pending' | 'active' | 'revoked'
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  joinTag: Uint8Array;
  inviteCodeHash: string; // lowercase hex
  admitSig: Uint8Array;
  revokeSig: Uint8Array;
  lastCounter: bigint;
  joinedAtMicros: bigint;
  admittedAtMicros?: bigint;
  revokedAtMicros?: bigint;
}

export interface IncidentRow {
  id: string;
  commanderHex: string;
  commanderSignPub: Uint8Array;
  commanderEcdhPub: Uint8Array;
  createdAtMicros: bigint;
  closed: boolean;
}

export interface ChannelRow {
  incidentId: string;
  kind: string;
  currentEpoch: number;
  headSeq: bigint;
  headHash: Uint8Array;
}

export interface EnvelopeRow {
  incidentId: string;
  kind: string;
  epoch: number;
  recipientHex: string;
  wrapped: Uint8Array;
  iv: Uint8Array;
}

export interface InviteRow {
  incidentId: string;
  codeHash: string; // lowercase hex
  role: string;
  expiresAtMicros: bigint;
  used: boolean;
}

export interface AttemptRow {
  incidentId: string;
  ok: boolean;
  atMicros: bigint;
}

export interface CheckpointRow {
  incidentId: string;
  kind: string;
  seq: bigint;
  hash: Uint8Array;
  signature: Uint8Array;
}

export type EventRow = RawEvent & { incidentId: string };

export interface BackendRows {
  /** The caller's own member rows, any state (`my_status`). */
  status: MemberRow[];
  incidents: IncidentRow[];
  members: MemberRow[];
  channels: ChannelRow[];
  envelopes: EnvelopeRow[];
  events: EventRow[];
  invites: InviteRow[];
  joinAttempts: AttemptRow[];
  checkpoints: CheckpointRow[];
}

export type ConnectionState = 'connecting' | 'ready' | 'offline' | 'error';

// --- Org roster and paging (WP1 views and reducers) --------------------------------

export interface OrgRow {
  id: string;
  name: string;
  adminHex: string;
  adminSignPub: Uint8Array;
  adminEcdhPub: Uint8Array;
  createdAtMicros: bigint;
}

export interface OrgMemberRow {
  orgMemberId: bigint;
  orgId: string;
  identityHex: string;
  displayName: string;
  signPub: Uint8Array;
  ecdhPub: Uint8Array;
  joinTag: Uint8Array;
  /** Ciphertext sealed to the pager key. The server never holds a number in clear. */
  sealedContact: Uint8Array;
  state: string; // 'pending' | 'active' | 'revoked'
  enrollSig: Uint8Array;
  revokeSig: Uint8Array;
  enrolledAtMicros: bigint;
  approvedAtMicros?: bigint;
  revokedAtMicros?: bigint;
}

export interface PageRow {
  pageId: string;
  incidentId: string;
  orgMemberId: bigint;
  status: string;
  carrierReported: boolean;
  requestedByHex: string;
  createdAtMicros: bigint;
  updatedAtMicros: bigint;
}

export interface OrgRows {
  /** `my_org`: orgs where I am active. */
  orgs: OrgRow[];
  /** `my_roster`: rows of those orgs (the admin also sees pending rows). */
  roster: OrgMemberRow[];
  /** `my_org_status`: my own rows in any state, so a pending phone can show where it stands. */
  own: OrgMemberRow[];
  /** `my_pages`: pages of incidents I am an active member of. */
  pages: PageRow[];
}

export interface PickWire {
  orgMemberId: bigint;
  role: string;
  admitSig: Uint8Array;
  envelopes: { kind: string; epoch: number; wrapped: Uint8Array; iv: Uint8Array }[];
}

/** Org reducers and views. Optional on a backend, so the incident-only backends keep working. */
export interface OrgBackend {
  rows(): OrgRows;
  createOrg(a: {
    orgId: string;
    name: string;
    displayName: string;
    signPub: Uint8Array;
    ecdhPub: Uint8Array;
    sealedContact: Uint8Array;
    enrollSig: Uint8Array;
  }): Promise<void>;
  createEnrollLink(a: { orgId: string; codeHash: Uint8Array; ttlHours: number }): Promise<void>;
  enrollMember(a: {
    orgId: string;
    code: Uint8Array;
    displayName: string;
    signPub: Uint8Array;
    ecdhPub: Uint8Array;
    joinTag: Uint8Array;
    sealedContact: Uint8Array;
  }): Promise<void>;
  approveMember(a: { orgId: string; orgMemberId: bigint; enrollSig: Uint8Array }): Promise<void>;
  revokeOrgMember(a: { orgId: string; orgMemberId: bigint; reason: string; revokeSig: Uint8Array }): Promise<void>;
  linkIncidentOrg(a: { incidentId: string; orgId: string }): Promise<void>;
  addFromRoster(a: { incidentId: string; picks: PickWire[] }): Promise<void>;
  requestPage(a: { incidentId: string; pageId: string; orgMemberIds: bigint[] }): Promise<void>;
}

export interface IncidentBackend {
  connection(): ConnectionState;
  /** Lowercase hex of my Spacetime identity, once connected. */
  identityHex(): string | null;
  rows(): BackendRows;
  /** Called after rows change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  createIncident(a: {
    incidentId: string;
    signPub: Uint8Array;
    ecdhPub: Uint8Array;
    displayName: string;
    admitSig: Uint8Array;
    envelopes: { kind: string; wrapped: Uint8Array; iv: Uint8Array }[];
  }): Promise<void>;
  createInvite(a: { incidentId: string; codeHash: Uint8Array; role: string; ttlMinutes: number }): Promise<void>;
  redeemInvite(a: {
    incidentId: string;
    code: Uint8Array;
    displayName: string;
    signPub: Uint8Array;
    ecdhPub: Uint8Array;
    joinTag: Uint8Array;
  }): Promise<void>;
  admitMember(a: {
    incidentId: string;
    memberId: bigint;
    admitSig: Uint8Array;
    envelopes: { kind: string; epoch: number; wrapped: Uint8Array; iv: Uint8Array }[];
  }): Promise<void>;
  revokeMember(a: {
    incidentId: string;
    memberId: bigint;
    revokeSig: Uint8Array;
    rotations: {
      kind: string;
      newEpoch: number;
      envelopes: { recipientHex: string; wrapped: Uint8Array; iv: Uint8Array }[];
    }[];
  }): Promise<void>;
  appendEvent(a: {
    incidentId: string;
    kind: string;
    epoch: number;
    clientEventId: string;
    authorCounter: bigint;
    iv: Uint8Array;
    ciphertext: Uint8Array;
    signature: Uint8Array;
  }): Promise<void>;
  postCheckpoint(a: { incidentId: string; kind: string; seq: bigint; signature: Uint8Array }): Promise<void>;
  /** Org roster and paging. Absent on a backend that only speaks incidents. */
  org?: OrgBackend;
}
