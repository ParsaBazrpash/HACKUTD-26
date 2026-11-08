// Lakeside Family Clinic org roster for the mock (WP4).
//
// Story data only. Names, fingerprints and safety codes are demo stand-ins,
// not derived from any key, and no phone number is stored here.

import type { Role } from "@/spacetimedb/src/shared/policy";
import type { RosterMember } from "@/lib/client/types";

export const ORG_ID = "00000000-0000-4000-8000-0000000000a1";
export const ORG_NAME = "Lakeside Family Clinic";
/** Shown wherever the mock org appears. */
export const ORG_DEMO_LABEL =
  "Demo data: stand-in names, fingerprints and safety codes. No real key, phone or call is involved.";

export type PhoneBehavior = "answers" | "no_answer_first";

export interface OrgMemberSeed extends RosterMember {
  /** Incident role used when this person is picked from the roster. */
  suggestedRole: Exclude<Role, "commander">;
  /** Demo only: what the simulated phone does on the first page. */
  phoneBehavior: PhoneBehavior;
}

export interface OrgFixture {
  orgId: string;
  name: string;
  adminIdentity: string;
  adminFingerprint: string;
  members: OrgMemberSeed[];
}

function demoIdentity(n: number): string {
  return n.toString(16).padStart(64, "0");
}

export function demoOrgFingerprint(n: number): string {
  return `de30 0000 de30 0000 de30 0000 de30 ${n.toString(16).padStart(4, "0")}`;
}

export function demoOrgSafety(n: number): string {
  const digits = (n * 7919).toString().padStart(12, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 12)}`;
}

function seed(
  id: number,
  serial: number,
  displayName: string,
  state: RosterMember["state"],
  suggestedRole: OrgMemberSeed["suggestedRole"],
  enrolledAt: string,
  phoneBehavior: PhoneBehavior = "answers",
): OrgMemberSeed {
  return {
    orgMemberId: BigInt(id),
    identity: demoIdentity(serial),
    displayName,
    state,
    fingerprint: demoOrgFingerprint(serial),
    safetyCode: demoOrgSafety(serial),
    enrolledAt: new Date(enrolledAt),
    approvedAt: state === "pending" ? null : new Date(enrolledAt),
    keyChanged: false,
    suggestedRole,
    phoneBehavior,
  };
}

/** Fresh objects on every call so two mock clients cannot share mutable rows. */
export function createOrgFixture(): OrgFixture {
  const members: OrgMemberSeed[] = [
    // The commander and the three people already in the clinic incident share
    // their identities with createClinicFixture (serials 1 to 4).
    seed(1, 1, "Avery Chen", "active", "executive", "2026-10-01T15:00:00.000Z"),
    seed(2, 2, "Jordan Hale", "active", "counsel", "2026-10-01T15:05:00.000Z"),
    seed(3, 3, "Sam Okonkwo", "active", "technical", "2026-10-01T15:10:00.000Z"),
    seed(4, 4, "Riley Patel", "active", "executive", "2026-10-01T15:15:00.000Z"),
    // Not yet in the incident.
    seed(5, 0x201, "Morgan Diaz", "active", "technical", "2026-10-02T15:00:00.000Z"),
    seed(6, 0x202, "Priya Shah", "active", "executive", "2026-10-02T15:05:00.000Z"),
    seed(7, 0x203, "Lee Carter", "active", "technical", "2026-10-02T15:10:00.000Z", "no_answer_first"),
    // Waiting for approval, with a visible demo safety code.
    seed(8, 0x204, "Casey Brooks", "pending", "technical", "2026-11-07T10:55:00.000Z"),
    // Lost phone.
    seed(9, 0x205, "Taylor Nguyen", "revoked", "technical", "2026-10-02T15:15:00.000Z"),
  ];
  return {
    orgId: ORG_ID,
    name: ORG_NAME,
    adminIdentity: members[0].identity,
    adminFingerprint: members[0].fingerprint,
    members,
  };
}
