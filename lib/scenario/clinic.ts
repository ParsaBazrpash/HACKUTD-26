// Lakeside Family Clinic demo (docs/PLAN.md 6.3).
//
// These are ordinary VerifiedEvent values with ok verdicts. They are story
// data for the mock. Nothing here is sealed, signed, or hashed.

import { PAYLOAD_VERSION, PayloadSchema, type PayloadKind, type PayloadOf } from "@/lib/protocol/events";
import type { MemberStateName, Role } from "@/spacetimedb/src/shared/policy";
import type { MemberRef, VerifiedEvent } from "@/lib/client/types";

export const CLINIC_INCIDENT_ID = "00000000-0000-4000-8000-0000000000c1";
export const CLINIC_TITLE = "Ransomware at Lakeside Family Clinic";
/** 02:13 CT on 7 Nov 2026. */
export const CLINIC_DETECTED_AT = "2026-11-07T08:13:00.000Z";

const OK = (): VerifiedEvent["verdict"] => ({ ok: true, failures: [], warnings: [] });

function uid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function demoIdentity(n: number): string {
  return n.toString(16).padStart(64, "0");
}

function demoFingerprint(n: number): string {
  const tail = n.toString(16).padStart(4, "0");
  return `de30 0000 de30 0000 de30 0000 de30 ${tail}`;
}

function demoSafety(n: number): string {
  const digits = n.toString().padStart(12, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 12)}`;
}

export interface ClinicMemberSeed {
  memberId: bigint;
  identity: string;
  displayName: string;
  role: Role;
  state: MemberStateName;
  fingerprint: string;
  /** Demo stand-in. Not derived from a key. */
  safetyCode: string;
  joinedAt: Date;
  admittedAt?: Date;
  /** Demo bookkeeping for a pending member. Not an HMAC result. */
  demoLinkMatched: boolean;
}

export interface ClinicFixture {
  incidentId: string;
  title: string;
  createdAt: Date;
  detectedAt: string;
  members: ClinicMemberSeed[];
  events: VerifiedEvent[];
}

const IDS = {
  commander: demoIdentity(1),
  counsel: demoIdentity(2),
  technical: demoIdentity(3),
  executive: demoIdentity(4),
  pending: demoIdentity(5),
} as const;

function person(identity: string, displayName: string, role: Role): MemberRef {
  return { identity, displayName, role };
}

/**
 * Fresh objects on every call so two mock clients cannot share mutable rows.
 */
export function createClinicFixture(): ClinicFixture {
  const createdAt = new Date(CLINIC_DETECTED_AT);
  const commander = person(IDS.commander, "Avery Chen", "commander");
  const counsel = person(IDS.counsel, "Jordan Hale", "counsel");
  const technical = person(IDS.technical, "Sam Okonkwo", "technical");
  const executive = person(IDS.executive, "Riley Patel", "executive");

  const members: ClinicMemberSeed[] = [
    {
      memberId: 1n,
      identity: commander.identity,
      displayName: commander.displayName,
      role: "commander",
      state: "active",
      fingerprint: demoFingerprint(1),
      safetyCode: demoSafety(1),
      joinedAt: new Date("2026-11-07T08:13:00.000Z"),
      admittedAt: new Date("2026-11-07T08:13:00.000Z"),
      demoLinkMatched: false,
    },
    {
      memberId: 2n,
      identity: counsel.identity,
      displayName: counsel.displayName,
      role: "counsel",
      state: "active",
      fingerprint: demoFingerprint(2),
      safetyCode: demoSafety(2),
      joinedAt: new Date("2026-11-07T08:14:00.000Z"),
      admittedAt: new Date("2026-11-07T08:14:00.000Z"),
      demoLinkMatched: false,
    },
    {
      memberId: 3n,
      identity: technical.identity,
      displayName: technical.displayName,
      role: "technical",
      state: "active",
      fingerprint: demoFingerprint(3),
      safetyCode: demoSafety(3),
      joinedAt: new Date("2026-11-07T08:15:00.000Z"),
      admittedAt: new Date("2026-11-07T08:15:00.000Z"),
      demoLinkMatched: false,
    },
    {
      memberId: 4n,
      identity: executive.identity,
      displayName: executive.displayName,
      role: "executive",
      state: "active",
      fingerprint: demoFingerprint(4),
      safetyCode: demoSafety(4),
      joinedAt: new Date("2026-11-07T08:16:00.000Z"),
      admittedAt: new Date("2026-11-07T08:16:00.000Z"),
      demoLinkMatched: false,
    },
    {
      memberId: 5n,
      identity: IDS.pending,
      displayName: "Noah Ellis",
      role: "technical",
      state: "pending",
      fingerprint: demoFingerprint(5),
      safetyCode: demoSafety(5),
      joinedAt: new Date("2026-11-07T10:50:00.000Z"),
      demoLinkMatched: true,
    },
  ];

  const events: VerifiedEvent[] = [];
  const seqBy = { record: 0, command: 0, privileged: 0, technical: 0 };
  let serial = 0x100;

  function append<K extends PayloadKind>(
    channel: VerifiedEvent["channel"],
    author: MemberRef,
    at: string,
    kind: K,
    body: PayloadOf<K>["body"],
  ): void {
    const parsed = PayloadSchema.parse({
      v: PAYLOAD_VERSION,
      kind,
      sentAt: at,
      body,
    });
    seqBy[channel] += 1;
    serial += 1;
    events.push({
      channel,
      seq: BigInt(seqBy[channel]),
      eventId: uid(serial),
      author,
      serverTs: new Date(at),
      sentAt: new Date(at),
      payload: parsed,
      verdict: OK(),
    });
  }

  const t = {
    detect: "2026-11-07T08:13:00.000Z",
    admitCounsel: "2026-11-07T08:14:00.000Z",
    admitTechnical: "2026-11-07T08:15:00.000Z",
    admitExecutive: "2026-11-07T08:16:00.000Z",
    declare: "2026-11-07T08:21:00.000Z",
    extensions: "2026-11-07T08:34:00.000Z",
    desks: "2026-11-07T08:48:00.000Z",
    vpnOff: "2026-11-07T09:05:00.000Z",
    hr: "2026-11-07T09:22:00.000Z",
    ehr: "2026-11-07T09:40:00.000Z",
    backup: "2026-11-07T09:55:00.000Z",
    vpnOn: "2026-11-07T10:20:00.000Z",
    profile: "2026-11-07T10:32:00.000Z",
    discovery: "2026-11-07T10:33:00.000Z",
    insurer: "2026-11-07T10:35:00.000Z",
    deadline: "2026-11-07T10:42:00.000Z",
    mail: "2026-11-07T10:48:00.000Z",
    brief: "2026-11-07T11:05:00.000Z",
    status: "2026-11-07T11:10:00.000Z",
  };

  append("record", commander, t.detect, "incident.title", { title: CLINIC_TITLE });
  append("record", commander, t.detect, "roster.admit", {
    memberIdentity: commander.identity,
    role: "commander",
    displayName: commander.displayName,
  });
  append("record", commander, t.admitCounsel, "roster.admit", {
    memberIdentity: counsel.identity,
    role: "counsel",
    displayName: counsel.displayName,
  });
  append("record", commander, t.admitTechnical, "roster.admit", {
    memberIdentity: technical.identity,
    role: "technical",
    displayName: technical.displayName,
  });
  append("record", commander, t.admitExecutive, "roster.admit", {
    memberIdentity: executive.identity,
    role: "executive",
    displayName: executive.displayName,
  });
  append("record", commander, t.declare, "status.set", {
    severity: "SEV1",
    phase: "detection_analysis",
    summary: "Ransom note found on the clinic file server at 02:13 CT. 300 staff are moving to paper downtime.",
  });

  const timeline: PayloadOf<"timeline.add">["body"][] = [
    {
      entryId: uid(0x201),
      occurredAt: t.detect,
      phase: "detection_analysis",
      csf: "DE.AE",
      text: "File server FS-CLINIC-01 raised a mass-rename alert at 02:13 CT. A note named RESTORE-FILES.txt is on the share. Lakeside Family Clinic has about 300 staff across two sites.",
    },
    {
      entryId: uid(0x202),
      occurredAt: t.declare,
      phase: "detection_analysis",
      csf: "RS.MA",
      text: "Commander declares SEV1. Shared drives are off limits. Front desk and nursing start paper downtime. No ransom will be paid from this room.",
    },
    {
      entryId: uid(0x203),
      occurredAt: t.extensions,
      phase: "detection_analysis",
      csf: "RS.AN",
      text: "Technical confirms .locked suffixes on FS-CLINIC-01 and copies the ransom note aside before any restore. The note demands payment and does not name a family we can verify.",
    },
    {
      entryId: uid(0x204),
      occurredAt: t.desks,
      phase: "containment",
      csf: "RS.CO",
      text: "Nursing stations and the front desk are disconnected from the file share. Clinics stay open on downtime forms. Patients already in the building are being seen.",
    },
    {
      entryId: uid(0x205),
      occurredAt: t.vpnOff,
      phase: "containment",
      csf: "RS.MI",
      text: "VPN appliance FW-VPN-01 is isolated after outbound traffic to an unfamiliar host. Remote access for clinical staff is down on purpose.",
    },
    {
      entryId: uid(0x206),
      occurredAt: t.hr,
      phase: "containment",
      csf: "RS.AN",
      text: "HR database logs show a 12,400-row export before encryption. The rows include SSNs: 9,800 Texas residents and 2,600 California residents.",
    },
    {
      entryId: uid(0x207),
      occurredAt: t.ehr,
      phase: "containment",
      csf: "RS.AN",
      text: "EHR application server shows chart access from the compromised VPN admin account. Whether PHI was copied is not confirmed.",
    },
    {
      entryId: uid(0x208),
      occurredAt: t.backup,
      phase: "containment",
      csf: "RS.MI",
      text: "Backup appliance taken offline. The Friday 18:40 CT job is still intact. It stays offline until eradication is confirmed.",
    },
    {
      entryId: uid(0x209),
      occurredAt: t.vpnOn,
      phase: "eradication",
      csf: "RS.MI",
      text: "VPN appliance rebuilt from the vendor image. The compromised admin account is disabled. Remote access stays closed.",
    },
    {
      entryId: uid(0x20a),
      occurredAt: t.insurer,
      phase: "recovery",
      csf: "RS.CO",
      text: "Counsel is drafting the cyber-insurer notice. No public statement. Privileged analysis stays in the privileged channel.",
    },
    {
      entryId: uid(0x20b),
      occurredAt: t.mail,
      phase: "recovery",
      csf: "RC.RP",
      text: "Microsoft 365 sessions for clinical staff are revoked. The clinic tenant shows suspected mailbox rules. Mail is not the system of record for this room.",
    },
    {
      entryId: uid(0x20c),
      occurredAt: t.brief,
      phase: "post_incident",
      csf: "RC.CO",
      text: "Medical director briefed. Both clinics remain open on downtime forms. No ransom has been paid. Individual notice is not cleared.",
    },
  ];
  const timelineAuthors = [
    commander,
    commander,
    technical,
    commander,
    technical,
    technical,
    technical,
    technical,
    technical,
    counsel,
    technical,
    commander,
  ];
  timeline.forEach((body, index) => {
    const author = timelineAuthors[index] ?? commander;
    append("record", author, body.occurredAt, "timeline.add", body);
  });

  append("record", commander, t.status, "status.set", {
    severity: "SEV1",
    phase: "recovery",
    summary:
      "Lakeside Family Clinic, 300 staff. File server encrypted, HR database exfiltrated (12,400 SSNs), EHR PHI suspected. VPN rebuilt. No ransom paid. Clinics are on paper downtime.",
  });

  append("record", technical, t.extensions, "scope.set", {
    itemId: uid(0x301),
    system: "FS-CLINIC-01",
    assetType: "server",
    status: "encrypted",
    dataTypes: ["employee_hr", "other_pii"],
    notes: "Clinic file server. Mass renames to .locked and a RESTORE-FILES.txt note. Shared documents and HR files were on this volume.",
    affected: [],
  });
  append("record", technical, t.hr, "scope.set", {
    itemId: uid(0x302),
    system: "HR-SQL-01",
    assetType: "database",
    status: "exfiltrated",
    dataTypes: ["ssn"],
    recordCount: 12_400,
    affected: [
      { state: "TX", count: 9_800 },
      { state: "CA", count: 2_600 },
    ],
    notes: "HR database. Export of 12,400 rows completed before the volume was encrypted. Counts are from the job log, not a new query.",
  });
  append("record", technical, t.ehr, "scope.set", {
    itemId: uid(0x303),
    system: "EHR-APP-01",
    assetType: "server",
    status: "suspected",
    dataTypes: ["phi"],
    affected: [],
    notes: "EHR application server. Chart access from the compromised VPN account is suspected. Acquisition of PHI is not confirmed.",
  });
  append("record", technical, t.backup, "scope.set", {
    itemId: uid(0x304),
    system: "BACKUP-VEEAM",
    assetType: "backup",
    status: "contained",
    dataTypes: ["phi", "employee_hr"],
    affected: [],
    notes: "Backup appliance. Taken offline. The Friday 18:40 CT job is still intact and is not being mounted.",
  });
  append("record", technical, t.mail, "scope.set", {
    itemId: uid(0x305),
    system: "M365-LAKESIDE",
    assetType: "saas",
    status: "suspected",
    dataTypes: ["phi", "credentials"],
    affected: [],
    notes: "Clinic email tenant. Sessions revoked. Suspected mailbox rules. Not confirmed as a copy of the record.",
  });
  append("record", technical, t.vpnOn, "scope.set", {
    itemId: uid(0x306),
    system: "FW-VPN-01",
    assetType: "network",
    status: "eradicated",
    dataTypes: ["credentials"],
    affected: [],
    notes: "VPN appliance. Isolated, then rebuilt from the vendor image. The compromised admin account is disabled.",
  });

  append("record", technical, t.extensions, "task.set", {
    taskId: uid(0x401),
    title: "Image FS-CLINIC-01 and preserve the ransom note",
    assignee: technical.identity,
    dueAt: "2026-11-07T18:00:00.000Z",
    status: "in_progress",
  });
  append("record", technical, t.hr, "task.set", {
    taskId: uid(0x402),
    title: "Confirm the HR export row counts from the job log",
    assignee: technical.identity,
    dueAt: "2026-11-07T20:00:00.000Z",
    status: "open",
  });
  append("record", counsel, t.discovery, "task.set", {
    taskId: uid(0x403),
    title: "Determine whether PHI was acquired and draft notice options",
    assignee: counsel.identity,
    dueAt: "2026-11-08T20:00:00.000Z",
    status: "in_progress",
  });
  append("record", commander, t.desks, "task.set", {
    taskId: uid(0x404),
    title: "Staff both clinics on paper downtime through the weekend",
    assignee: executive.identity,
    dueAt: "2026-11-09T18:00:00.000Z",
    status: "in_progress",
  });
  append("record", technical, t.backup, "task.set", {
    taskId: uid(0x405),
    title: "Restore the file server only after eradication is confirmed",
    assignee: technical.identity,
    status: "blocked",
  });
  append("record", counsel, t.insurer, "task.set", {
    taskId: uid(0x406),
    title: "Send the cyber insurer notice and keep the analysis privileged",
    assignee: counsel.identity,
    status: "open",
  });

  append("record", counsel, t.profile, "profile.set", {
    publicCompany: false,
    hipaaCoveredEntity: true,
    nydfsRegulated: false,
    defenseContractor: false,
    bank: false,
    euDataSubjects: false,
  });
  append("record", counsel, t.discovery, "legal.discovery", {
    determinedAt: t.detect,
    basis:
      "Counsel records awareness at 02:13 CT, when the ransom note and the HR export logs were both in hand.",
  });
  append("record", technical, t.extensions, "evidence.add", {
    evidenceId: uid(0x501),
    label: "Ransom note RESTORE-FILES.txt",
    sha256: "0".repeat(64),
    location: "Demo placeholder. This digest was not computed from the file.",
    custodian: "Sam Okonkwo",
  });
  append("record", technical, t.hr, "evidence.add", {
    evidenceId: uid(0x502),
    label: "HR export job log",
    sha256: "0".repeat(63) + "1",
    location: "Demo placeholder. This digest was not computed from the log.",
    custodian: "Sam Okonkwo",
  });
  append("record", counsel, t.deadline, "deadline.update", {
    ruleId: "hipaa-404",
    status: "in_progress",
    owner: counsel.identity,
    note: "Individual notice analysis is underway. Counsel has not cleared a public statement.",
  });

  append("command", commander, t.declare, "chat.post", {
    messageId: uid(0x601),
    text: "SEV1. Lakeside Family Clinic, 300 staff. File server encrypted at 02:13. Paper downtime is in effect. No ransom payment.",
    mentions: [],
  });
  append("command", technical, t.vpnOff, "chat.post", {
    messageId: uid(0x602),
    text: "VPN is isolated. I am imaging the file server before any restore.",
    mentions: [],
  });
  append("command", executive, t.brief, "chat.post", {
    messageId: uid(0x603),
    text: "Clinics stay open on downtime forms. I need a patient-facing holding statement from counsel before noon.",
    mentions: [],
  });
  append("privileged", counsel, t.discovery, "chat.post", {
    messageId: uid(0x604),
    text: "Attorney-client privileged. Do not forward. The HR export is 9,800 Texas residents and 2,600 California. I am treating 02:13 CT as awareness. SEC does not apply. We have not decided on individual notice.",
    mentions: [],
  });
  append("privileged", commander, t.insurer, "chat.post", {
    messageId: uid(0x605),
    text: "Understood. No public statement until you clear it. The insurer notice stays in draft here.",
    mentions: [],
  });
  append("technical", technical, t.extensions, "chat.post", {
    messageId: uid(0x606),
    text: "Ransom note name is RESTORE-FILES.txt. Extensions are .locked. The Friday 18:40 backup job looks intact and is offline.",
    mentions: [],
  });
  append("technical", technical, t.ehr, "chat.post", {
    messageId: uid(0x607),
    text: "EHR app server shows chart access from the compromised VPN account. I cannot yet say records were copied.",
    mentions: [],
  });

  return {
    incidentId: CLINIC_INCIDENT_ID,
    title: CLINIC_TITLE,
    createdAt,
    detectedAt: CLINIC_DETECTED_AT,
    members,
    events,
  };
}
