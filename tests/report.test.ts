import { describe, expect, test } from "vitest";
import { EMPTY_PROFILE, type ChannelView, type IncidentState, type MemberView, type ScopeItem } from "@/lib/client/types";
import { showsConfirmedCountdown } from "@/lib/legal";
import { incidentAccess } from "@/lib/report/access";
import { buildIncidentReport, type IncidentReport, type ReportOptions } from "@/lib/report";
import { executiveBullets, coverDecisions } from "@/lib/report/sheet";

const NOW = new Date("2026-11-08T18:00:00.000Z");
const SAFETY = "123 456 789 012";
const COUNSEL_ID = "a".repeat(64);
const COMMANDER_ID = "b".repeat(64);
const MENTION = "c".repeat(64);
const EVIDENCE_HASH = "ab".repeat(32);
const PLACEHOLDER_HASH = "0".repeat(64);
const LIVE_HASH = "cd".repeat(32);
const CHECKPOINT_HASH = "ef".repeat(32);

function member(partial: Pick<MemberView, "identity" | "displayName" | "role"> & Partial<MemberView>): MemberView {
  return {
    memberId: 1n,
    state: "active",
    fingerprint: `${partial.role} fingerprint`,
    verified: true,
    joinedAt: NOW,
    admittedAt: NOW,
    ...partial,
  };
}

function scope(): ScopeItem {
  return {
    itemId: "00000000-0000-4000-8000-000000000010",
    latest: {
      itemId: "00000000-0000-4000-8000-000000000010",
      system: "HR database",
      assetType: "database",
      status: "exfiltrated",
      dataTypes: ["phi", "ssn"],
      recordCount: 12400,
      affected: [
        { state: "TX", count: 9800 },
        { state: "CA", count: 2600 },
      ],
      notes: "Export job finished.",
    },
    history: [],
  };
}

function channel(kind: ChannelView["kind"], text: string): ChannelView {
  return {
    kind,
    waitingForKeys: false,
    messages: [
      {
        seq: 1n,
        messageId: "00000000-0000-4000-8000-000000000020",
        author: { identity: COUNSEL_ID, displayName: "Dana Counsel", role: "counsel" },
        sentAt: NOW,
        serverTs: NOW,
        text,
        mentions: [MENTION],
        verdict: { ok: true, failures: [], warnings: [] },
      },
    ],
  };
}

function state(role: MemberView["role"] = "counsel"): IncidentState {
  const counsel = member({
    identity: COUNSEL_ID,
    displayName: "Dana Counsel",
    role: "counsel",
    safetyCode: SAFETY,
  });
  const commander = member({
    identity: COMMANDER_ID,
    displayName: "Avery Commander",
    role: "commander",
    fingerprint: "commander fingerprint",
  });
  const me = role === "commander" ? commander : role === "counsel" ? counsel : member({ identity: "d".repeat(64), displayName: "Sam Technical", role });
  return {
    connection: "ready",
    me,
    incident: {
      id: "incident-1",
      title: "Lakeside Family Clinic",
      createdAt: NOW,
      commander,
    },
    status: {
      severity: "SEV1",
      phase: "containment",
      summary: "Clinics are on paper downtime.",
      at: NOW,
      by: commander,
    },
    members: [commander, counsel, me].filter((item, index, all) => all.findIndex((other) => other.identity === item.identity) === index),
    channels: [
      channel("command", `SECRET-COMMAND ${SAFETY}`),
      channel("privileged", "SECRET-PRIVILEGED"),
      channel("technical", "SECRET-TECHNICAL"),
    ],
    timeline: [
      {
        seq: 1n,
        by: commander,
        at: NOW,
        sentAt: NOW,
        verdict: { ok: true, failures: [], warnings: [] },
        entry: {
          entryId: "00000000-0000-4000-8000-000000000030",
          occurredAt: NOW.toISOString(),
          phase: "detection_analysis",
          csf: "DE.AE",
          text: "Ransom note found on the file server.",
        },
        amendedBy: [],
      },
    ],
    scope: [scope()],
    tasks: [],
    profile: { ...EMPTY_PROFILE, publicCompany: true, hipaaCoveredEntity: true },
    discovery: {
      determinedAt: new Date("2026-11-07T14:00:00.000Z"),
      basis: "Awareness when the note and the export were both in hand.",
      by: counsel,
    },
    materiality: null,
    deadlineUpdates: {},
    evidence: [
      {
        seq: 2n,
        by: commander,
        at: NOW,
        sentAt: NOW,
        verdict: { ok: true, failures: [], warnings: [] },
        body: {
          evidenceId: "00000000-0000-4000-8000-000000000040",
          label: "HR export job log",
          sha256: EVIDENCE_HASH,
          location: "Held by the response team.",
          custodian: "Sam Okonkwo",
        },
      },
    ],
    org: null,
    roster: [],
    pages: [],
    integrity: {
      ok: true,
      checkedAt: NOW,
      channels: {
        record: {
          ok: true,
          eventsChecked: 4,
          failures: [],
          head: { seq: 4n, hashHex: PLACEHOLDER_HASH },
          pinnedOk: true,
          waitingForKeys: false,
        },
      },
      rosterFailures: [],
    },
  };
}

function options(partial: Partial<ReportOptions> = {}): ReportOptions {
  return { now: NOW, includePrivileged: false, demo: true, buildSha: null, ...partial };
}

function textOf(report: IncidentReport): string {
  return JSON.stringify(report);
}

describe("incident report", () => {
  test("refuses a report when the member cannot read the incident", () => {
    const revoked = state("counsel");
    revoked.me = { ...revoked.me!, state: "revoked" };
    expect(incidentAccess(revoked).phase).toBe("denied");
    expect(buildIncidentReport(revoked, options({ includePrivileged: true }))).toBeNull();

    const pending = state("counsel");
    pending.me = { ...pending.me!, state: "pending" };
    expect(buildIncidentReport(pending, options({ includePrivileged: true }))).toBeNull();
  });

  test("leaves privileged, command, and technical chat out by default and omits secrets", () => {
    const report = buildIncidentReport(state("counsel"), options());
    expect(report).not.toBeNull();
    if (!report) return;
    const dumped = textOf(report);
    expect(dumped).not.toContain("SECRET-PRIVILEGED");
    expect(dumped).not.toContain("SECRET-COMMAND");
    expect(dumped).not.toContain("SECRET-TECHNICAL");
    expect(dumped).not.toContain(SAFETY);
    expect(dumped).not.toContain(MENTION);
    expect(report.privileged.included).toBe(false);
    expect(report.privileged.offered).toBe(true);
    expect(report.privileged.watermark).toBeNull();
    expect(report.privileged.messages).toEqual([]);
    expect(dumped).toContain("Clinics are on paper downtime.");
    expect(dumped).toContain("Ransom note found on the file server.");
    expect(dumped).toContain(EVIDENCE_HASH);
    expect(dumped).toContain("Lakeside Family Clinic");
    expect(dumped).toContain("incident-1");
    expect(dumped).not.toContain("ff".repeat(32));
  });

  test("counsel can include only the privileged channel, with a watermark", () => {
    const report = buildIncidentReport(state("counsel"), options({ includePrivileged: true }));
    expect(report).not.toBeNull();
    if (!report) return;
    const dumped = textOf(report);
    expect(report.privileged.included).toBe(true);
    expect(report.privileged.watermark).toBe("PRIVILEGED / CONFIDENTIAL");
    expect(dumped).toContain("SECRET-PRIVILEGED");
    expect(dumped).not.toContain("SECRET-COMMAND");
    expect(dumped).not.toContain("SECRET-TECHNICAL");
    expect(dumped).not.toContain(SAFETY);
    expect(dumped).not.toContain(MENTION);
  });

  test("a non-counsel role cannot opt privileged content in, even when the channel is present", () => {
    for (const role of ["commander", "technical", "executive"] as const) {
      const report = buildIncidentReport(state(role), options({ includePrivileged: true }));
      expect(report?.privileged.included).toBe(false);
      expect(report?.privileged.messages).toEqual([]);
      expect(textOf(report!)).not.toContain("SECRET-PRIVILEGED");
    }
  });

  test("does not invent privileged messages when this client has no privileged channel", () => {
    const current = state("counsel");
    current.channels = current.channels.filter((item) => item.kind !== "privileged");
    const report = buildIncidentReport(current, options({ includePrivileged: true }));
    expect(report?.privileged.included).toBe(false);
    expect(report?.privileged.messages).toEqual([]);
    expect(report?.privileged.note).toContain("does not have the privileged channel");
  });

  test("marks counsel review without a countdown, and does not start SEC before materiality", () => {
    const report = buildIncidentReport(state("counsel"), options());
    expect(report).not.toBeNull();
    if (!report || !report.deadlines) return;
    const california = report.deadlines.find((deadline) => deadline.id === "state-check-ca");
    const sec = report.deadlines.find((deadline) => deadline.id === "sec-8k-105");
    const hipaa = report.deadlines.find((deadline) => deadline.id === "hipaa-404");
    expect(california?.status).toBe("Review with counsel");
    expect(california?.countdown).toBe("No confirmed countdown");
    expect(california?.due).toBe("No confirmed deadline");
    expect(sec?.status).toBe("Clock not started");
    expect(sec?.countdown).toBe("No confirmed countdown");
    expect(sec?.trigger).toBe("Materiality determination");
    expect(hipaa?.due).not.toBe("No confirmed deadline");
    expect(hipaa?.countdown).not.toBe("No confirmed countdown");
    expect(hipaa?.sourceUrl).toMatch(/^https:\/\//);
    expect(report.disclaimer).toContain("does not determine legal obligations");
    expect(report.discovery.basis).toContain("Awareness");
    expect(report.materiality.recorded).toBe(false);
    expect(report.tasksEmpty).toBe("No response tasks are on the record.");
  });

  test("does not claim a checkpoint unless this client verified one", () => {
    const demo = buildIncidentReport(state("counsel"), options({ demo: true }));
    expect(demo?.demoNote).toContain("does not claim a cryptographic checkpoint");
    expect(demo?.integrity.summary).toContain("Signatures are not verified.");
    expect(demo?.integrity.summary).not.toContain("Client verification passed");
    expect(demo?.integrity.channels[0]?.head).toContain("demo placeholder");
    expect(demo?.integrity.channels[0]?.checkpoint).toBe("No verified checkpoint is recorded for this channel.");
    expect(demo?.integrity.build).toBe("Build hash is not recorded for this deployment.");

    const rejected = state("counsel");
    rejected.integrity = {
      ...rejected.integrity,
      channels: {
        record: {
          ...rejected.integrity.channels.record!,
          latestCheckpoint: { seq: 4n, hashHex: CHECKPOINT_HASH, verified: false },
        },
      },
    };
    const rejectedReport = buildIncidentReport(rejected, options({ demo: false }));
    expect(rejectedReport?.integrity.channels[0]?.checkpoint).toContain("did not verify");
    expect(textOf(rejectedReport!)).not.toContain("Verified checkpoint");
    expect(textOf(rejectedReport!)).not.toContain(CHECKPOINT_HASH);

    const verified = state("counsel");
    verified.integrity = {
      ok: true,
      checkedAt: NOW,
      rosterFailures: [],
      channels: {
        record: {
          ok: true,
          eventsChecked: 4,
          failures: [],
          head: { seq: 4n, hashHex: LIVE_HASH },
          pinnedOk: true,
          waitingForKeys: false,
          latestCheckpoint: { seq: 4n, hashHex: CHECKPOINT_HASH, verified: true },
        },
      },
    };
    const verifiedReport = buildIncidentReport(verified, options({ demo: false, buildSha: "abc1234" }));
    expect(verifiedReport?.integrity.summary).toContain("Client verification passed");
    expect(verifiedReport?.integrity.channels[0]?.checkpoint).toBe(
      `Verified checkpoint at sequence 4. Hash ${CHECKPOINT_HASH}.`,
    );
    expect(verifiedReport?.integrity.channels[0]?.head).toContain(LIVE_HASH);
    expect(verifiedReport?.integrity.channels[0]?.head).not.toContain("placeholder");
    expect(verifiedReport?.integrity.build).toBe("Build abc1234");
    expect(verifiedReport?.demoNote).toBeNull();
  });

  test("prints UTC clocks and a cover summary from the recorded facts", () => {
    const report = buildIncidentReport(state("counsel"), options());
    expect(report?.exportedAt).toBe("08 Nov 2026, 18:00 UTC");
    expect(report?.timeline[0]?.entries[0]?.occurredAt).toBe("08 Nov 2026, 18:00 UTC");
    expect(report?.timeline[0]?.entries[0]?.at).toBe(NOW.getTime());
    expect(executiveBullets(report!)).toEqual([
      "Clinics are on paper downtime.",
      "Incident is open and in the containment phase.",
    ]);

    const current = state("commander");
    const entry = current.timeline[0];
    if (!entry) throw new Error("missing timeline entry");
    current.timeline = [
      {
        ...entry,
        entry: {
          ...entry.entry,
          entryId: "00000000-0000-4000-8000-000000000031",
          text: "Decision: Remove HHRA",
          phase: "detection_analysis",
          csf: "RS.CO",
        },
      },
    ];
    current.status = current.status ? { ...current.status, phase: "detection_analysis", summary: "" } : current.status;
    const decided = buildIncidentReport(current, options());
    expect(decided?.summary).toBe("No summary has been recorded.");
    expect(executiveBullets(decided!)).toEqual([
      "Incident is open and in the detection and analysis phase; remove HHRA has been decided.",
    ]);
    expect(coverDecisions(decided!)).toEqual([
      expect.objectContaining({ title: "Remove HHRA", meta: "AC, Commander · 08 Nov 18:00 UTC" }),
    ]);
  });

  test("a counsel-review result is not a confirmed countdown", () => {
    const report = buildIncidentReport(state("counsel"), options());
    const california = report?.deadlines?.find((deadline) => deadline.id === "state-check-ca");
    expect(california?.applicability).toBe("Review with counsel");
    expect(showsConfirmedCountdown({
      rule: { id: "state-check-ca", name: "", jurisdiction: "", citation: "", sourceUrl: "", appliesWhen: "", trigger: "None", calculation: "", timeZone: null },
      applicability: "check",
      clockStatus: "needs_counsel",
      startedAt: null,
      dueAt: null,
      explanation: "",
      counselReview: "",
      recorded: null,
    })).toBe(false);
  });
});
