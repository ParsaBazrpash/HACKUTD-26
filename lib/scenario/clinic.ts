// Lakeside Family Clinic demo (docs/PLAN.md 6.3).
//
// These are ordinary VerifiedEvent values with ok verdicts. They are story
// data for the mock. Nothing here is sealed, signed, or hashed.

import { PAYLOAD_VERSION, PayloadSchema, type PayloadKind, type PayloadOf } from "@/lib/protocol/events";
import type { MemberStateName, Role } from "@/spacetimedb/src/shared/policy";
import type { MemberRef, VerifiedEvent } from "@/lib/client/types";
import { demoFingerprint, demoSafety } from "@/lib/scenario/demo-codes";

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

export interface ClinicMemberSeed {
  memberId: bigint;
  identity: string;
  displayName: string;
  role: Role;
  state: MemberStateName;
  fingerprint: string;
  /** Stand-in derived from a fixed label, not from a key. */
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

  // All times are UTC. Central time is six hours earlier in November.
  const t = {
    detect: "2026-11-07T08:13:00.000Z", // 02:13 CT
    admitCounsel: "2026-11-07T08:14:00.000Z",
    admitTechnical: "2026-11-07T08:15:00.000Z",
    admitExecutive: "2026-11-07T08:16:00.000Z",
    declare: "2026-11-07T08:33:00.000Z", // 02:33 CT
    extensions: "2026-11-07T08:48:00.000Z", // 02:48 CT
    desks: "2026-11-07T08:50:00.000Z", // 02:50 CT
    vpnOff: "2026-11-07T08:54:00.000Z", // 02:54 CT
    profile: "2026-11-07T09:02:00.000Z",
    discovery: "2026-11-07T09:05:00.000Z",
    pm: "2026-11-07T09:22:00.000Z", // 03:22 CT
    egress: "2026-11-07T09:28:00.000Z", // 03:28 CT
    backup: "2026-11-07T09:33:00.000Z", // 03:33 CT
    note: "2026-11-07T09:38:00.000Z",
    insurer: "2026-11-07T09:55:00.000Z",
    deadline: "2026-11-07T10:20:00.000Z",
    hr: "2026-11-07T10:53:00.000Z", // 04:53 CT
    ehr: "2026-11-07T10:58:00.000Z",
    mail: "2026-11-07T11:43:00.000Z", // 05:43 CT
    vpnOn: "2026-11-07T12:13:00.000Z", // 06:13 CT
    brief: "2026-11-07T12:35:00.000Z",
    status: "2026-11-07T12:43:00.000Z", // 06:43 CT
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
    summary: "File server encrypted at Plano at 02:13 CT. Scope still unknown. Both sites are moving to paper downtime.",
  });

  const timeline: PayloadOf<"timeline.add">["body"][] = [
    {
      entryId: uid(0x201),
      occurredAt: t.detect,
      phase: "detection_analysis",
      csf: "DE.AE",
      text: "Alert on FS-CLINIC-01: mass file renames at 02:13 CT. RESTORE-FILES.txt is on the shared drive at both sites.",
    },
    {
      entryId: uid(0x202),
      occurredAt: t.declare,
      phase: "detection_analysis",
      csf: "RS.MA",
      text: "Commander declares SEV1. Shared drives are off limits. Front desk and nursing start paper downtime at Plano and McKinney. No ransom decision is made from this room.",
    },
    {
      entryId: uid(0x203),
      occurredAt: t.extensions,
      phase: "detection_analysis",
      csf: "RS.AN",
      text: "IT confirms .locked suffixes on FS-CLINIC-01 and copies the ransom note aside before any restore. HV-01 and VOIP-PBX-01 are also encrypted.",
    },
    {
      entryId: uid(0x204),
      occurredAt: t.desks,
      phase: "containment",
      csf: "RS.CO",
      text: "Nursing stations and the front desk are disconnected from the file share. Both sites stay open on downtime forms. Patients already in the building are being seen.",
    },
    {
      entryId: uid(0x205),
      occurredAt: t.vpnOff,
      phase: "containment",
      csf: "RS.MI",
      text: "FW-VPN-01 isolated from the network after outbound traffic to an unfamiliar host. Remote access for staff is down on purpose.",
    },
    {
      entryId: uid(0x206),
      occurredAt: t.pm,
      phase: "containment",
      csf: "RS.AN",
      text: "PM-SQL-01 holds 41,200 active patient records, all Texas residents. SSNs are on file for 12,400 of them. Firewall logs show the data left the network.",
    },
    {
      entryId: uid(0x207),
      occurredAt: t.egress,
      phase: "containment",
      csf: "RS.AN",
      text: "About 18.6 GB went out to a cloud storage host between 03:40 and 04:55 CT the night before encryption. The managed service provider admin VPN account (Drew Kim's credentials) was the entry point.",
    },
    {
      entryId: uid(0x208),
      occurredAt: t.backup,
      phase: "containment",
      csf: "RS.MI",
      text: "BACKUP-VEEAM taken offline. The Friday 18:40 CT job is intact. It stays offline until eradication is confirmed.",
    },
    {
      entryId: uid(0x209),
      occurredAt: t.ehr,
      phase: "containment",
      csf: "RS.AN",
      text: "EHR-APP-01 shows 37 charts opened by the compromised account. Whether the content was copied is not confirmed. HR-SQL-01 shows data for 342 current and former staff in the same window.",
    },
    {
      entryId: uid(0x20a),
      occurredAt: t.mail,
      phase: "eradication",
      csf: "RS.MI",
      text: "A forwarding rule on the administrator mailbox in M365-LAKESIDE was created by the MSP admin account. Rule removed, sessions revoked, clinic email treated as compromised.",
    },
    {
      entryId: uid(0x20b),
      occurredAt: t.vpnOn,
      phase: "eradication",
      csf: "RS.MI",
      text: "FW-VPN-01 rebuilt from the vendor image. The MSP admin account is disabled and privileged credentials are being rotated. Remote access stays closed.",
    },
    {
      entryId: uid(0x20c),
      occurredAt: t.brief,
      phase: "recovery",
      csf: "RC.CO",
      text: "Medical director briefed. Both sites remain open on downtime forms. Outside counsel has notified the cyber insurer. No ransom payment. Notice decisions are with counsel.",
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
    technical,
    technical,
    commander,
  ];
  timeline.forEach((body, index) => {
    const author = timelineAuthors[index] ?? commander;
    append("record", author, body.occurredAt, "timeline.add", body);
  });

  append("record", commander, t.status, "status.set", {
    severity: "SEV1",
    phase: "eradication",
    summary:
      "Lakeside Family Clinic, Plano and McKinney. File server, hypervisor and phones encrypted. 41,200 patient records and 342 staff records exfiltrated. FW-VPN-01 rebuilt, backups offline and intact. No ransom paid. Both sites on paper downtime.",
  });

  append("record", technical, t.extensions, "scope.set", {
    itemId: uid(0x301),
    system: "FS-CLINIC-01",
    assetType: "server",
    status: "encrypted",
    dataTypes: ["employee_hr", "other_pii"],
    notes: "Clinic file server. Mass renames to .locked and a RESTORE-FILES.txt note at both sites. Shared documents were on this volume.",
    affected: [],
  });
  append("record", technical, t.pm, "scope.set", {
    itemId: uid(0x307),
    system: "PM-SQL-01",
    assetType: "database",
    status: "exfiltrated",
    dataTypes: ["phi", "ssn"],
    recordCount: 41_200,
    affected: [{ state: "TX", count: 41_200 }],
    notes: "Practice database. 41,200 active patients, all Texas residents. SSNs are on file for 12,400 of them. Egress to a cloud storage host confirmed in the firewall logs.",
  });
  append("record", technical, t.backup, "scope.set", {
    itemId: uid(0x304),
    system: "BACKUP-VEEAM",
    assetType: "backup",
    status: "contained",
    dataTypes: ["phi", "employee_hr"],
    affected: [],
    notes: "Backup appliance. Offline. The Friday 18:40 CT job is intact and is not being mounted.",
  });
  append("record", technical, t.hr, "scope.set", {
    itemId: uid(0x302),
    system: "HR-SQL-01",
    assetType: "database",
    status: "exfiltrated",
    dataTypes: ["ssn", "employee_hr", "financial_account"],
    recordCount: 342,
    affected: [{ state: "TX", count: 342 }],
    notes: "HR database. 342 current and former staff, all in Texas. SSNs and bank account details are on file.",
  });
  append("record", technical, t.ehr, "scope.set", {
    itemId: uid(0x303),
    system: "EHR-APP-01",
    assetType: "server",
    status: "suspected",
    dataTypes: ["phi"],
    recordCount: 37,
    affected: [{ state: "TX", count: 37 }],
    notes: "EHR application server. 37 charts were opened by the compromised account. Whether the content was acquired is not confirmed.",
  });
  append("record", technical, t.mail, "scope.set", {
    itemId: uid(0x305),
    system: "M365-LAKESIDE",
    assetType: "saas",
    status: "suspected",
    dataTypes: ["phi", "credentials"],
    affected: [],
    notes: "Clinic email tenant. Forwarding rule on the administrator mailbox created by the MSP admin account. Sessions revoked. Mail contents copied is not confirmed.",
  });
  append("record", technical, t.vpnOn, "scope.set", {
    itemId: uid(0x306),
    system: "FW-VPN-01",
    assetType: "network",
    status: "eradicated",
    dataTypes: ["credentials"],
    affected: [],
    notes: "VPN appliance. Isolated at 02:54 CT, then rebuilt from the vendor image. The MSP admin account is disabled.",
  });

  append("record", technical, t.extensions, "task.set", {
    taskId: uid(0x401),
    title: "Image FS-CLINIC-01 and preserve the ransom note",
    assignee: technical.identity,
    dueAt: "2026-11-07T18:00:00.000Z",
    status: "in_progress",
  });
  append("record", technical, t.pm, "task.set", {
    taskId: uid(0x402),
    title: "Confirm the PM-SQL-01 patient count and the SSN subset",
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
    title: "Paper downtime staffing through Monday",
    assignee: executive.identity,
    dueAt: "2026-11-09T18:00:00.000Z",
    status: "in_progress",
  });
  append("record", technical, t.backup, "task.set", {
    taskId: uid(0x405),
    title: "Restore the file server after eradication",
    assignee: technical.identity,
    status: "blocked",
  });
  append("record", counsel, t.insurer, "task.set", {
    taskId: uid(0x406),
    title: "Confirm cyber insurer notice and keep the analysis privileged",
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
      "Counsel records awareness at 02:13 CT, when the ransom note was found on FS-CLINIC-01. Data theft was confirmed later the same morning.",
  });
  append("record", technical, t.note, "evidence.add", {
    evidenceId: uid(0x501),
    label: "Ransom note, RESTORE-FILES.txt",
    sha256: "3af692ab8be71ed65622724b1691fb5dba67069c42f714a7554ac472003f9985",
    location: "Image of FS-CLINIC-01, evidence store 1",
    custodian: "Sam Okonkwo",
  });
  append("record", technical, t.egress, "evidence.add", {
    evidenceId: uid(0x502),
    label: "Firewall egress log export",
    sha256: "2d29038892b7518d23f012c53eaec1e45726f1f828092ceb522ce35a8b0a1edf",
    location: "Forensics firm transfer folder",
    custodian: "Sam Okonkwo",
  });
  append("record", technical, t.mail, "evidence.add", {
    evidenceId: uid(0x503),
    label: "Mailbox forwarding rule export",
    sha256: "4947e8ed6fb3f45749b174bbb686a0e9555cdb9fa5cea7bd9479f5386178c902",
    location: "Forensics firm transfer folder",
    custodian: "Sam Okonkwo",
  });
  append("record", counsel, t.deadline, "deadline.update", {
    ruleId: "tx-521-ag",
    status: "in_progress",
    owner: counsel.identity,
    note: "Texas AG notice (30 days, 250 or more Texans) is being drafted. HHS and individual notice (60 days) follow. Privately held, so no SEC filing.",
  });

  append("command", commander, t.declare, "chat.post", {
    messageId: uid(0x601),
    text: "SEV1. File server encrypted at Plano at 02:13. Both sites are on paper downtime. No ransom decision from this room.",
    mentions: [],
  });
  append("command", technical, t.vpnOff, "chat.post", {
    messageId: uid(0x602),
    text: "FW-VPN-01 is isolated. I am imaging FS-CLINIC-01 before any restore.",
    mentions: [],
  });
  append("command", executive, t.brief, "chat.post", {
    messageId: uid(0x603),
    text: "Both sites stay open on downtime forms. I need a patient holding statement from counsel before the front desk opens.",
    mentions: [],
  });
  append("privileged", counsel, t.discovery, "chat.post", {
    messageId: uid(0x604),
    text: "Attorney-client privileged. Do not forward. I am treating 02:13 CT as awareness. Privately held, so SEC does not apply. Texas AG notice is 30 days and HHS plus individual notice is 60 days. Forensics will be engaged through this office.",
    mentions: [],
  });
  append("privileged", commander, t.insurer, "chat.post", {
    messageId: uid(0x605),
    text: "Understood. No public statement until you clear it. Insurer notice goes through you.",
    mentions: [],
  });
  append("technical", technical, t.extensions, "chat.post", {
    messageId: uid(0x606),
    text: "Note is RESTORE-FILES.txt and the extension is .locked. The Friday 18:40 backup job looks intact and is offline.",
    mentions: [],
  });
  append("technical", technical, t.ehr, "chat.post", {
    messageId: uid(0x607),
    text: "EHR-APP-01 shows 37 charts opened by the compromised account. I cannot yet say any were copied.",
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
