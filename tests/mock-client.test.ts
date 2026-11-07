import { describe, expect, test } from "vitest";
import { createMockIncidentDataClient } from "@/lib/data/mock-client";
import { UnknownIncidentError } from "@/lib/data/client";
import { assertNoSensitiveFields, assertPrototypeFixtures, findSensitiveFields } from "@/lib/data/sensitive";

const now = () => new Date("2026-11-08T14:12:00.000Z");

describe("mock incident client", () => {
  test("lists sealed shells and keeps the list referentially stable", () => {
    const client = createMockIncidentDataClient({ now });
    const first = client.getIncidentList();
    const second = client.getIncidentList();
    expect(first.map((incident) => incident.id)).toEqual(["inc_harbor", "inc_kiln"]);
    expect(first).toBe(second);
  });

  test("returns a fixture-only snapshot with a 72 hour GDPR clock", () => {
    const client = createMockIncidentDataClient({ now });
    const snapshot = client.getSnapshot("inc_harbor", now());
    expect(snapshot).not.toBeNull();
    assertNoSensitiveFields(snapshot);
    assertPrototypeFixtures(snapshot);

    const gdpr = snapshot?.legalDeadlines.find((deadline) => deadline.catalogId === "gdpr-art-33");
    expect(gdpr?.dueAt).toBe("2026-11-10T14:12:00.000Z");
    expect(gdpr?.status).toBe("upcoming");
    expect(gdpr?.sealedCounselNote).toBeNull();
    expect(snapshot?.members).toHaveLength(4);
    expect(snapshot?.channels).toHaveLength(4);
  });

  test("returns null for an unknown shell", () => {
    const client = createMockIncidentDataClient({ now });
    expect(client.getSnapshot("inc_missing")).toBeNull();
  });

  test("join adds a member and notifies subscribers", async () => {
    const client = createMockIncidentDataClient({ now });
    let calls = 0;
    const unsubscribe = client.subscribe(() => {
      calls += 1;
    });

    const before = client.getIncidentList();
    const member = await client.joinIncident({
      incidentId: "inc_harbor",
      role: "responder",
    });

    expect(member.id).toBe("mem_join_001");
    expect(member.publicKeyId).toBeNull();
    expect(calls).toBe(1);
    expect(client.getSnapshot("inc_harbor")?.members.some((item) => item.id === "mem_join_001")).toBe(true);
    expect(client.getIncidentList()).not.toBe(before);
    unsubscribe();
    await client.joinIncident({ incidentId: "inc_harbor", role: "executive" });
    expect(calls).toBe(1);
  });

  test("join rejects unknown incidents and plaintext fields", async () => {
    const client = createMockIncidentDataClient({ now });
    await expect(
      client.joinIncident({ incidentId: "inc_missing", role: "responder" }),
    ).rejects.toBeInstanceOf(UnknownIncidentError);
    await expect(
      client.joinIncident({
        incidentId: "inc_harbor",
        role: "responder",
        displayName: "Ada",
      } as never),
    ).rejects.toThrow();
  });
});

describe("sensitive field guard", () => {
  test("flags plaintext fields and private key material", () => {
    expect(findSensitiveFields({ title: "x" })).toEqual(["$.title"]);
    expect(findSensitiveFields({ privateKey: "abc" })).toEqual(["$.privateKey"]);
    expect(findSensitiveFields({ channel_key: "abc" })).toEqual(["$.channel_key"]);
    expect(findSensitiveFields({ sealedBrief: { keyId: "fixture-key" } })).toEqual([]);
    expect(findSensitiveFields("-----BEGIN PRIVATE KEY-----\nabc")).toEqual(["$"]);
  });

  test("rejects browser-sealed envelopes in prototype data", () => {
    expect(() => assertPrototypeFixtures({ provenance: "browser-sealed" })).toThrow(/browser-sealed/);
    expect(() => assertNoSensitiveFields({ note: "case facts" })).toThrow(/plaintext/);
  });
});
