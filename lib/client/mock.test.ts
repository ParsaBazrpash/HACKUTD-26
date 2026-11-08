import { describe, expect, test } from "vitest";
import { createMemoryLedger, createMemorySession, parseDemoLedger } from "@/lib/client/demo-ledger";
import { createMockIncidentClient } from "@/lib/client/mock";
import { computeDeadlines } from "@/lib/legal";
import { isKindAllowed, PayloadSchema } from "@/lib/protocol/events";
import { CLINIC_INCIDENT_ID, createClinicFixture } from "@/lib/scenario/clinic";
import { demoSafety } from "@/lib/scenario/demo-codes";
import { EMPTY_PROFILE, type ProfileBody, type StatusBody } from "@/lib/client/types";

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (typeof value === "bigint" || value === null || typeof value !== "object") return false;
  return Object.values(value).some((item) => containsText(item, needle));
}

const statusBody: StatusBody = {
  severity: "SEV2",
  phase: "containment",
  summary: "Updated in the demo.",
};

describe("clinic scenario", () => {
  test("builds valid events the shared policy allows", () => {
    const clinic = createClinicFixture();
    expect(clinic.incidentId).toBe(CLINIC_INCIDENT_ID);
    expect(clinic.title).toContain("Lakeside Family Clinic");
    expect(clinic.events.length).toBeGreaterThan(20);
    for (const event of clinic.events) {
      expect(event.verdict.ok).toBe(true);
      expect(event.author).not.toBeNull();
      expect(PayloadSchema.safeParse(event.payload).success).toBe(true);
      if (event.payload && event.author) {
        expect(isKindAllowed(event.payload.kind, event.channel, event.author.role)).toBe(true);
      }
    }
  });
});

describe("mock incident client", () => {
  test("folds the Lakeside story and keeps the snapshot stable", () => {
    const client = createMockIncidentClient({ origin: "http://localhost:3001" });
    const first = client.getState();
    const second = client.getState();
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { connection: string }).connection = "offline";
    }).toThrow(TypeError);

    expect(first.incident?.title).toBe("Ransomware at Lakeside Family Clinic");
    expect(first.me?.role).toBe("commander");
    expect(first.me?.verified).toBe(false);
    expect(first.status?.severity).toBe("SEV1");
    expect(first.status?.phase).toBe("eradication");
    expect(first.members).toHaveLength(5);
    expect(first.members.filter((member) => member.state === "active").map((member) => member.role)).toEqual([
      "commander",
      "counsel",
      "technical",
      "executive",
    ]);
    expect(first.timeline).toHaveLength(12);
    expect(first.scope).toHaveLength(7);
    expect(first.tasks).toHaveLength(6);
    expect(first.evidence).toHaveLength(3);
    expect(first.profile.hipaaCoveredEntity).toBe(true);
    expect(first.discovery?.basis).toMatch(/02:13/);
    expect(first.materiality).toBeNull();
    expect(first.channels.map((channel) => channel.kind)).toEqual(["command", "privileged", "technical"]);
    expect(first.channels.some((channel) => channel.kind === "record")).toBe(false);

    const hr = first.scope.find((item) => item.latest.system === "HR-SQL-01");
    expect(hr?.latest.status).toBe("exfiltrated");
    expect(hr?.latest.recordCount).toBe(342);
    expect(hr?.latest.dataTypes).toEqual(["ssn", "employee_hr", "financial_account"]);
    expect(hr?.latest.affected).toEqual([{ state: "TX", count: 342 }]);
    const pm = first.scope.find((item) => item.latest.system === "PM-SQL-01");
    expect(pm?.latest.status).toBe("exfiltrated");
    expect(pm?.latest.recordCount).toBe(41200);
    expect(pm?.latest.affected).toEqual([{ state: "TX", count: 41200 }]);
    expect(first.scope.some((item) => item.latest.affected.some((a) => a.state === "CA"))).toBe(false);
    expect(first.scope.find((item) => item.latest.system === "FS-CLINIC-01")?.latest.status).toBe("encrypted");
    expect(first.scope.find((item) => item.latest.system === "EHR-APP-01")?.latest.dataTypes).toEqual(["phi"]);
    expect(first.scope.find((item) => item.latest.system === "BACKUP-VEEAM")?.latest.status).toBe("contained");
    expect(first.scope.find((item) => item.latest.system === "M365-LAKESIDE")?.latest.status).toBe("suspected");
    expect(first.scope.find((item) => item.latest.system === "FW-VPN-01")?.latest.status).toBe("eradicated");

    const pending = first.members.find((member) => member.state === "pending");
    expect(pending?.linkVerified).toBe(true);
    expect(pending?.safetyCode).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(first.channels.find((channel) => channel.kind === "privileged")?.messages[0]?.text).toMatch(/Do not forward/);

    expect(first.discovery).not.toBeNull();
    expect(() => computeDeadlines(first, new Date("2026-11-07T18:00:00.000Z"))).not.toThrow();
  });

  test("notifies once and leaves the previous snapshot untouched", async () => {
    const client = createMockIncidentClient();
    const before = client.getState();
    let calls = 0;
    const unsubscribe = client.subscribe(() => {
      calls += 1;
    });
    expect(calls).toBe(0);
    await client.setStatus(statusBody);
    expect(calls).toBe(1);
    expect(client.getState()).not.toBe(before);
    expect(before.status?.severity).toBe("SEV1");
    expect(client.getState().status?.severity).toBe("SEV2");
    unsubscribe();
    await client.setStatus({ ...statusBody, summary: "Second update." });
    expect(calls).toBe(1);
  });

  test("hides privileged content from technical and blocks their writes", async () => {
    const technical = createMockIncidentClient({ viewer: "technical" });
    const state = technical.getState();
    expect(state.me?.role).toBe("technical");
    expect(state.channels.map((channel) => channel.kind)).toEqual(["command", "technical"]);
    expect(state.integrity.channels.privileged).toBeUndefined();
    expect(containsText(state.channels, "Do not forward")).toBe(false);
    await expect(technical.postMessage("privileged", { text: "no", mentions: [] })).rejects.toThrow(/role/i);
    await expect(technical.setProfile({ ...EMPTY_PROFILE, hipaaCoveredEntity: true })).rejects.toThrow(/role/i);
    await expect(technical.recordDiscovery({ determinedAt: "2026-11-07T08:13:00.000Z", basis: "no" })).rejects.toThrow(
      /role/i,
    );
    expect(technical.getState()).toBe(state);
  });

  test("lets an executive read privileged and blocks record writes", async () => {
    const executive = createMockIncidentClient({ viewer: "executive" });
    expect(executive.getState().channels.map((channel) => channel.kind)).toEqual(["command", "privileged"]);
    await expect(
      executive.addTimelineEntry({
        occurredAt: "2026-11-07T12:00:00.000Z",
        phase: "recovery",
        csf: "RC.CO",
        text: "An executive cannot write the record.",
      }),
    ).rejects.toThrow(/role/i);
    await expect(executive.setStatus(statusBody)).rejects.toThrow(/role/i);
    await expect(executive.postMessage("technical", { text: "no", mentions: [] })).rejects.toThrow(/role/i);
    await expect(
      executive.updateDeadline({ ruleId: "hipaa-404", status: "open", note: "An executive cannot update this." }),
    ).rejects.toThrow(/role/i);
    await executive.postMessage("command", { text: "Holding statement is still with counsel.", mentions: [] });
    expect(executive.getState().channels.find((channel) => channel.kind === "command")?.messages.at(-1)?.text).toMatch(
      /Holding statement/,
    );
  });

  test("a pending viewer sees only the commander and themselves", () => {
    const pending = createMockIncidentClient({ viewer: "pending" });
    const state = pending.getState();
    expect(state.me?.state).toBe("pending");
    expect(state.channels).toEqual([]);
    expect(state.timeline).toEqual([]);
    expect(state.members.map((member) => member.role).sort()).toEqual(["commander", "technical"]);
    expect(state.me?.safetyCode).toBe(demoSafety(5));
    expect(state.me?.safetyCode).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(state.me?.linkVerified).toBeUndefined();
    expect(containsText(state, "Do not forward")).toBe(false);
  });

  test("uses demo invite tokens and refuses a live fragment or a swapped role", async () => {
    const client = createMockIncidentClient({ origin: "http://localhost:3001" });
    const invite = await client.createInvite({ role: "counsel", ttlMinutes: 15 });
    const url = new URL(invite.url);
    expect(url.pathname).toBe("/join");
    expect(url.search).toBe("");
    expect(url.hash.startsWith("#demo=1")).toBe(true);
    expect(url.hash).not.toContain("c=");
    expect(url.hash).not.toContain("s=");
    expect(url.hash).not.toContain("f=");

    const params = new URLSearchParams(url.hash.slice(1));
    params.set("r", "executive");
    await expect(
      client.redeemInvite({ fragment: `#${params.toString()}`, displayName: "Pat Lee" }),
    ).rejects.toThrow(/role/i);
    expect(client.getState().me?.role).toBe("commander");

    await expect(
      client.redeemInvite({
        fragment: "#i=00000000-0000-4000-8000-0000000000c1&c=aa&s=bb&f=cc&r=counsel",
        displayName: "Pat Lee",
      }),
    ).rejects.toThrow(/live invite/i);
    expect(client.getState().me?.role).toBe("commander");
  });

  test("redeems a demo invite as the invited role and then blocks writes", async () => {
    const client = createMockIncidentClient({ origin: "http://localhost:3001" });
    const invite = await client.createInvite({ role: "executive" });
    await client.redeemInvite({ fragment: new URL(invite.url).hash, displayName: "Riley Guest" });
    expect(client.getState().me?.role).toBe("executive");
    expect(client.getState().me?.state).toBe("pending");
    expect(client.getState().me?.verified).toBe(false);
    expect(client.getState().channels).toEqual([]);
    await expect(client.postMessage("command", { text: "hello", mentions: [] })).rejects.toThrow(/active/i);
    await expect(
      client.redeemInvite({ fragment: new URL(invite.url).hash, displayName: "Second Guest" }),
    ).rejects.toThrow(/used/i);
  });

  test("redeems a demo invite from another tab and keeps the commander tab", async () => {
    const ledger = createMemoryLedger();
    const origin = "http://localhost:3001";
    const commanderSession = createMemorySession();
    const commander = createMockIncidentClient({
      origin,
      ledger,
      session: commanderSession,
    });
    const invite = await commander.createInvite({ role: "counsel", ttlMinutes: 15 });
    await commander.setStatus({
      severity: "SEV2",
      phase: "containment",
      summary: "Ledger round trip.",
    });

    const joinerSession = createMemorySession();
    const joiner = createMockIncidentClient({ origin, ledger, session: joinerSession });
    await joiner.redeemInvite({ fragment: new URL(invite.url).hash, displayName: "Alex Jahani" });
    expect(joiner.getState().me).toMatchObject({
      displayName: "Alex Jahani",
      role: "counsel",
      state: "pending",
    });
    const pending = commander.getState().members.find((member) => member.displayName === "Alex Jahani");
    expect(pending).toMatchObject({ role: "counsel", state: "pending", linkVerified: true });

    const params = new URLSearchParams(new URL(invite.url).hash.slice(1));
    params.set("r", "executive");
    await expect(
      joiner.redeemInvite({ fragment: `#${params.toString()}`, displayName: "Pat Lee" }),
    ).rejects.toThrow(/role/i);

    const reloaded = createMockIncidentClient({ origin, ledger, session: joinerSession });
    expect(reloaded.getState().me?.displayName).toBe("Alex Jahani");
    const commanderAgain = createMockIncidentClient({ origin, ledger, session: commanderSession });
    expect(commanderAgain.getState().me?.role).toBe("commander");
    expect(commanderAgain.getState().status?.summary).toBe("Ledger round trip.");

    await commander.admitMember(pending?.memberId ?? 0n);
    expect(reloaded.getState().me?.state).toBe("active");

    const stranger = createMockIncidentClient({
      origin,
      ledger: createMemoryLedger(),
      session: createMemorySession(),
    });
    await expect(
      stranger.redeemInvite({ fragment: new URL(invite.url).hash, displayName: "Someone Else" }),
    ).rejects.toThrow(/not in this browser/i);
  });

  test("a corrupt demo ledger is left in place", async () => {
    const ledger = createMemoryLedger();
    ledger.write("{not json");
    const client = createMockIncidentClient({
      origin: "http://localhost:3001",
      ledger,
      session: createMemorySession(),
    });
    await client.createInvite({ role: "technical" });
    expect(ledger.read()).toBe("{not json");
    expect(parseDemoLedger("{not json")).toBeNull();
  });

  test("expires a demo invite", async () => {
    let now = Date.parse("2026-11-07T12:00:00.000Z");
    const client = createMockIncidentClient({ now: () => now, origin: "http://localhost:3001" });
    const invite = await client.createInvite({ role: "technical", ttlMinutes: 15 });
    now += 16 * 60_000;
    await expect(
      client.redeemInvite({ fragment: new URL(invite.url).hash, displayName: "Sam Guest" }),
    ).rejects.toThrow(/expired/i);
  });

  test("admits and revokes without claiming a certificate check", async () => {
    const client = createMockIncidentClient();
    const pending = client.getState().members.find((member) => member.state === "pending");
    expect(pending).toBeDefined();
    await client.admitMember(pending?.memberId ?? 0n);
    const admitted = client.getState().members.find((member) => member.memberId === pending?.memberId);
    expect(admitted?.state).toBe("active");
    expect(admitted?.verified).toBe(false);

    const counsel = client.getState().members.find((member) => member.role === "counsel");
    await client.revokeMember(counsel?.memberId ?? 0n, "Lost laptop");
    expect(client.getState().members.find((member) => member.memberId === counsel?.memberId)?.state).toBe("revoked");
    await expect(client.revokeMember(client.getState().me?.memberId ?? 0n, "no")).rejects.toThrow(/cannot be revoked/i);

    const technical = createMockIncidentClient({ viewer: "technical" });
    const stillPending = technical.getState().members.find((member) => member.displayName === "Noah Ellis");
    await expect(technical.admitMember(stillPending?.memberId ?? 0n)).rejects.toThrow(/commander/i);
  });

  test("appends record updates through the fold", async () => {
    const client = createMockIncidentClient();
    const item = client.getState().scope.find((entry) => entry.latest.system === "HR-SQL-01");
    expect(item).toBeDefined();
    await client.upsertScopeItem({ ...item!.latest, status: "contained" });
    const next = client.getState().scope.find((entry) => entry.itemId === item?.itemId);
    expect(next?.latest.status).toBe("contained");
    expect(next?.history).toHaveLength(2);

    await client.addTimelineEntry({
      occurredAt: "2026-11-07T12:30:00.000Z",
      phase: "recovery",
      csf: "RC.RP",
      text: "Downtime forms are still in use at both clinics.",
    });
    expect(client.getState().timeline.some((entry) => entry.entry.text.includes("Downtime forms"))).toBe(true);

    await client.addEvidence({
      label: "Downtime roster photo",
      sha256: "ab".repeat(32),
      location: "Plano front desk, shared phone",
      custodian: "Avery Chen",
    });
    expect(client.getState().evidence).toHaveLength(4);

    const counsel = createMockIncidentClient({ viewer: "counsel" });
    const profile: ProfileBody = { ...EMPTY_PROFILE, hipaaCoveredEntity: true, euDataSubjects: true };
    await counsel.setProfile(profile);
    expect(counsel.getState().profile.euDataSubjects).toBe(true);
    await counsel.recordMateriality({
      determinedAt: "2026-11-07T12:00:00.000Z",
      basis: "Private clinic. Materiality is recorded so the clock can stay closed.",
    });
    expect(counsel.getState().materiality?.basis).toMatch(/Private clinic/);
    const counselId = counsel.getState().me?.identity;
    await counsel.updateDeadline({
      ruleId: "hipaa-404",
      status: "in_progress",
      ...(counselId ? { owner: counselId } : {}),
      note: "Individual notice is still with counsel.",
    });
    expect(counsel.getState().deadlineUpdates["hipaa-404"]?.body.status).toBe("in_progress");
  });

  test("creates an incident as commander and keeps demo integrity structural", async () => {
    const client = createMockIncidentClient();
    const report = await client.verifyAll();
    expect(report.ok).toBe(true);
    expect(report.channels.record?.head?.hashHex).toBe("0".repeat(64));
    expect(report.channels.privileged?.eventsChecked).toBeGreaterThan(0);
    await expect(client.signCheckpoint()).rejects.toThrow(/demo mode/i);

    const created = await client.createIncident({ title: "Saturday clinic", displayName: "Casey Quinn" });
    expect(client.getState().incident?.id).toBe(created.incidentId);
    expect(client.getState().incident?.title).toBe("Saturday clinic");
    expect(client.getState().me?.role).toBe("commander");
    expect(client.getState().me?.displayName).toBe("Casey Quinn");
    await expect(client.openIncident(CLINIC_INCIDENT_ID)).rejects.toThrow(/not a member/i);
    await expect(client.createIncident({ title: " ", displayName: "Casey Quinn" })).rejects.toThrow(/title/i);
    await expect(client.createIncident({ title: "Ok", displayName: "   " })).rejects.toThrow(/display name/i);
    await expect(client.createInvite({ role: "commander" as "counsel" })).rejects.toThrow(/role/i);
  });
});
