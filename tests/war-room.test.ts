import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  canAuthorRecord,
  draftDeadline,
  draftDiscovery,
  draftScope,
  draftStatus,
  draftTask,
  draftTimeline,
} from "@/components/incidents/record-actions";
import {
  exposedScope,
  listIntegrityFindings,
  mostUrgentDeadline,
  selectMessages,
  taskCounts,
} from "@/components/incidents/situation";
import { createMockIncidentClient } from "@/lib/client/mock";
import type { ChannelMessage, IntegrityReport } from "@/lib/client/types";
import { PayloadSchema } from "@/lib/protocol/events";

function isolated(viewer: "commander" | "counsel" | "technical" | "executive" = "commander") {
  return createMockIncidentClient({
    viewer,
    origin: "http://localhost:3001",
    ledger: null,
    session: null,
  });
}

function message(seq: bigint, ok: boolean): ChannelMessage {
  return {
    seq,
    messageId: `00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`,
    author: null,
    sentAt: new Date(0),
    serverTs: new Date(0),
    text: `note ${seq.toString()}`,
    mentions: [],
    verdict: { ok, failures: ok ? [] : ["bad_signature"], warnings: [] },
  };
}

describe("record authorization", () => {
  test("only the commander sets status, and executives cannot write the record", () => {
    expect(canAuthorRecord("commander", "active", "status.set")).toBe(true);
    expect(canAuthorRecord("counsel", "active", "status.set")).toBe(false);
    expect(canAuthorRecord("technical", "active", "status.set")).toBe(false);
    expect(canAuthorRecord("executive", "active", "status.set")).toBe(false);
    expect(canAuthorRecord("executive", "active", "timeline.add")).toBe(false);
    expect(canAuthorRecord("executive", "active", "scope.set")).toBe(false);
    expect(canAuthorRecord("executive", "active", "task.set")).toBe(false);
    expect(canAuthorRecord("counsel", "active", "timeline.add")).toBe(true);
    expect(canAuthorRecord("technical", "active", "scope.set")).toBe(true);
    expect(canAuthorRecord("commander", "pending", "status.set")).toBe(false);
    expect(canAuthorRecord(undefined, "active", "task.set")).toBe(false);
    expect(canAuthorRecord("counsel", "active", "legal.discovery")).toBe(true);
    expect(canAuthorRecord("commander", "active", "legal.materiality")).toBe(true);
    expect(canAuthorRecord("commander", "active", "deadline.update")).toBe(true);
    expect(canAuthorRecord("technical", "active", "legal.discovery")).toBe(false);
    expect(canAuthorRecord("technical", "active", "deadline.update")).toBe(false);
    expect(canAuthorRecord("executive", "active", "legal.materiality")).toBe(false);
    expect(canAuthorRecord("counsel", "pending", "deadline.update")).toBe(false);
  });

  test("the client still rejects a record write the role cannot make", async () => {
    const executive = isolated("executive");
    const technical = isolated("technical");
    const status = draftStatus({ severity: "SEV2", phase: "containment", summary: "No." });
    const entry = draftTimeline({
      occurredAt: "2026-11-07T18:00",
      phase: "containment",
      csf: "RS.MI",
      text: "Should not land.",
      amends: "",
    });
    expect(status.ok).toBe(true);
    expect(entry.ok).toBe(true);
    if (!status.ok || !entry.ok) return;
    await expect(technical.setStatus(status.body)).rejects.toThrow(/role/i);
    await expect(executive.addTimelineEntry(entry.body)).rejects.toThrow(/role/i);
  });
});

describe("record drafts", () => {
  test("accepts a status, timeline entry, system, and task the schema allows", () => {
    const status = draftStatus({ severity: "SEV1", phase: "recovery", summary: "Clinics are on paper." });
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(PayloadSchema.safeParse({ v: 1, kind: "status.set", sentAt: new Date().toISOString(), body: status.body }).success).toBe(true);

    const entry = draftTimeline({
      occurredAt: "2026-11-07T08:13",
      phase: "detection_analysis",
      csf: "DE.AE",
      text: "<img src=x onerror=alert(1)>",
      amends: "",
    });
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    expect(entry.body).not.toHaveProperty("entryId");
    expect(entry.body.text).toBe("<img src=x onerror=alert(1)>");
    expect(new Date(entry.body.occurredAt).getTime()).toBe(new Date("2026-11-07T08:13").getTime());

    const scope = draftScope({
      itemId: crypto.randomUUID(),
      system: "E2E-PORTAL",
      assetType: "server",
      status: "suspected",
      dataTypes: ["phi", "phi"],
      recordCount: "12",
      euResidents: "",
      affected: [
        { state: "tx", count: "10" },
        { state: "", count: "" },
      ],
      notes: "Held as text.",
    });
    expect(scope.ok).toBe(true);
    if (!scope.ok) return;
    expect(scope.body.dataTypes).toEqual(["phi"]);
    expect(scope.body.affected).toEqual([{ state: "TX", count: 10 }]);
    expect(scope.body.recordCount).toBe(12);
    expect(scope.body.euResidents).toBeUndefined();

    const task = draftTask({
      taskId: crypto.randomUUID(),
      title: "Call the clinics",
      assignee: "",
      dueAt: "",
      status: "open",
    });
    expect(task.ok).toBe(true);

    const discovery = draftDiscovery({
      determinedAt: "2026-11-07T08:13",
      basis: "Awareness when the note and the export were both in hand.",
    });
    expect(discovery.ok).toBe(true);
    if (discovery.ok) {
      expect(discovery.body.basis).toContain("Awareness");
      expect(PayloadSchema.safeParse({ v: 1, kind: "legal.discovery", sentAt: new Date().toISOString(), body: discovery.body }).success).toBe(true);
    }

    const deadline = draftDeadline({
      ruleId: "hipaa-404",
      status: "in_progress",
      owner: "ab".repeat(32),
      note: "Notice analysis is underway.",
    });
    expect(deadline.ok).toBe(true);
  });

  test("rejects empty, oversized, and malformed record fields", () => {
    expect(draftStatus({ severity: "SEV9", phase: "recovery", summary: "x" }).ok).toBe(false);
    expect(draftDiscovery({ determinedAt: "", basis: "x" }).ok).toBe(false);
    expect(draftDiscovery({ determinedAt: "2026-11-07T08:13", basis: "x".repeat(1001) }).ok).toBe(false);
    expect(draftDeadline({ ruleId: "HIPAA", status: "open", owner: "", note: "" }).ok).toBe(false);
    expect(draftDeadline({ ruleId: "x".repeat(41), status: "open", owner: "", note: "" }).ok).toBe(false);
    expect(draftDeadline({ ruleId: "hipaa-404", status: "closed", owner: "", note: "" }).ok).toBe(false);
    expect(draftStatus({ severity: "SEV1", phase: "recovery", summary: "x".repeat(501) }).ok).toBe(false);
    expect(draftTimeline({ occurredAt: "", phase: "recovery", csf: "DE.AE", text: "x", amends: "" }).ok).toBe(false);
    expect(draftTimeline({ occurredAt: "2026-11-07T08:13", phase: "recovery", csf: "DE.AE", text: " ", amends: "" }).ok).toBe(false);
    expect(
      draftTimeline({
        occurredAt: "2026-11-07T08:13",
        phase: "recovery",
        csf: "DE.AE",
        text: "x".repeat(4001),
        amends: "",
      }).ok,
    ).toBe(false);
    expect(
      draftTimeline({
        occurredAt: "2026-11-07T08:13",
        phase: "recovery",
        csf: "NOPE",
        text: "x",
        amends: "",
      }).ok,
    ).toBe(false);
    expect(
      draftScope({
        itemId: "not-a-uuid",
        system: "FS",
        assetType: "server",
        status: "unknown",
        dataTypes: [],
        recordCount: "",
        euResidents: "",
        affected: [],
        notes: "",
      }).ok,
    ).toBe(false);
    expect(
      draftScope({
        itemId: crypto.randomUUID(),
        system: " ",
        assetType: "server",
        status: "unknown",
        dataTypes: [],
        recordCount: "",
        euResidents: "",
        affected: [],
        notes: "",
      }).ok,
    ).toBe(false);
    expect(
      draftScope({
        itemId: crypto.randomUUID(),
        system: "FS",
        assetType: "server",
        status: "unknown",
        dataTypes: [],
        recordCount: "-1",
        euResidents: "",
        affected: [],
        notes: "",
      }).ok,
    ).toBe(false);
    expect(
      draftScope({
        itemId: crypto.randomUUID(),
        system: "FS",
        assetType: "server",
        status: "unknown",
        dataTypes: [],
        recordCount: "",
        euResidents: "",
        affected: [{ state: "Texas", count: "1" }],
        notes: "",
      }).ok,
    ).toBe(false);
    expect(draftTask({ taskId: crypto.randomUUID(), title: " ", assignee: "", dueAt: "", status: "open" }).ok).toBe(false);
    expect(
      draftTask({
        taskId: crypto.randomUUID(),
        title: "Call",
        assignee: "abc",
        dueAt: "",
        status: "open",
      }).ok,
    ).toBe(false);
    expect(draftTask({ taskId: "bad", title: "Call", assignee: "", dueAt: "", status: "open" }).ok).toBe(false);
  });

  test("a commander can file each record action through the client", async () => {
    const client = isolated();
    const status = draftStatus({ severity: "SEV2", phase: "containment", summary: "Phone bridge is up." });
    const entry = draftTimeline({
      occurredAt: "2026-11-07T12:00",
      phase: "containment",
      csf: "RS.CO",
      text: "Bridge confirmed.",
      amends: "",
    });
    const scope = draftScope({
      itemId: crypto.randomUUID(),
      system: "E2E-PORTAL",
      assetType: "saas",
      status: "suspected",
      dataTypes: ["credentials"],
      recordCount: "",
      euResidents: "",
      affected: [],
      notes: "",
    });
    const task = draftTask({
      taskId: crypto.randomUUID(),
      title: "Call the clinics",
      assignee: client.getState().me?.identity ?? "",
      dueAt: "2026-11-08T18:00",
      status: "open",
    });
    expect(status.ok && entry.ok && scope.ok && task.ok).toBe(true);
    if (!status.ok || !entry.ok || !scope.ok || !task.ok) return;
    await client.setStatus(status.body);
    await client.addTimelineEntry(entry.body);
    await client.upsertScopeItem(scope.body);
    await client.upsertTask(task.body);
    const state = client.getState();
    expect(state.status?.summary).toBe("Phone bridge is up.");
    expect(state.timeline.some((item) => item.entry.text === "Bridge confirmed.")).toBe(true);
    expect(state.scope.some((item) => item.latest.system === "E2E-PORTAL")).toBe(true);
    expect(state.tasks.some((item) => item.latest.title === "Call the clinics")).toBe(true);
  });
});

describe("situation metrics", () => {
  test("counts exposure and tasks, and picks the earliest deadline", () => {
    expect(exposedScope([{ latest: { status: "exfiltrated" } }, { latest: { status: "restored" } }])).toHaveLength(1);
    expect(
      taskCounts([
        { latest: { status: "open" } },
        { latest: { status: "in_progress" } },
        { latest: { status: "blocked" } },
        { latest: { status: "done" } },
      ]),
    ).toEqual({ open: 1, inProgress: 1, blocked: 1, done: 1 });
    const urgent = mostUrgentDeadline([
      { id: "later", dueAt: "2026-11-10T00:00:00.000Z" },
      { id: "none", dueAt: null },
      { id: "sooner", dueAt: "2026-11-08T00:00:00.000Z" },
    ]);
    expect(urgent?.id).toBe("sooner");
  });

  test("keeps a failed chat message visible when the recent window would drop it", () => {
    const shown = selectMessages([message(1n, true), message(2n, false), message(3n, true), message(4n, true), message(5n, true)], 2);
    expect(shown.map((item) => item.seq)).toEqual([2n, 4n, 5n]);
  });

  test("lists every integrity and roster failure", () => {
    const report: IntegrityReport = {
      ok: true,
      checkedAt: new Date(0),
      channels: {
        record: {
          ok: false,
          eventsChecked: 2,
          failures: [
            { seq: 7n, reason: "bad_signature", detail: "byte flipped" },
            { seq: 8n, reason: "gap" },
          ],
          head: { seq: 8n, hashHex: "ab" },
          pinnedOk: true,
          waitingForKeys: false,
        },
      },
      rosterFailures: [{ identity: "aa", reason: "certificate mismatch" }],
    };
    const findings = listIntegrityFindings(report);
    expect(findings).toHaveLength(3);
    expect(findings[0]).toMatchObject({ kind: "event", channel: "record", seq: "7", reason: "bad_signature" });
    expect(findings[2]).toMatchObject({ kind: "roster", identity: "aa" });
  });
});

describe("war room wiring", () => {
  test("forms call the incident client and the report does not read channels itself", () => {
    const status = readFileSync("components/incidents/status-form.tsx", "utf8");
    const timeline = readFileSync("components/incidents/timeline-form.tsx", "utf8");
    const scope = readFileSync("components/incidents/scope-form.tsx", "utf8");
    const tasks = readFileSync("components/incidents/task-form.tsx", "utf8");
    const taskList = readFileSync("components/incidents/task-list.tsx", "utf8");
    const legal = readFileSync("components/incidents/legal-forms.tsx", "utf8");
    const report = readFileSync("components/incidents/report-view.tsx", "utf8");
    const builder = readFileSync("lib/report/build.ts", "utf8");
    expect(status).toContain("setStatus(draft.body)");
    expect(status).toContain("canAuthorRecord");
    expect(timeline).toContain("addTimelineEntry(draft.body)");
    expect(scope).toContain("upsertScopeItem(draft.body)");
    expect(tasks).toContain("upsertTask(draft.body)");
    expect(taskList).toContain("upsertTask(draft.body)");
    expect(legal).toContain("recordDiscovery(draft.body)");
    expect(legal).toContain("recordMateriality(draft.body)");
    expect(legal).toContain("updateDeadline(draft.body)");
    expect(report).toContain("buildIncidentReport");
    expect(report).toContain("attorney-client privileged");
    expect(report).not.toContain("state.channels");
    expect(report).not.toContain("safetyCode");
    expect(builder).not.toContain("safetyCode");
    for (const file of [status, timeline, scope, tasks, taskList, legal, report, builder]) {
      expect(file).not.toMatch(/console\./);
      expect(file).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
