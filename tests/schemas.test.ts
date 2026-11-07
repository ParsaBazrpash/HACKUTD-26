import { describe, expect, test } from "vitest";
import { UNSET_INTEGRITY } from "@/types/common";
import { incidentSchema } from "@/types/domain";
import {
  ciphertextEnvelopeSchema,
  incidentShellSchema,
  integritySchema,
  joinIncidentInputSchema,
} from "@/types";
import { fixtureEnvelope } from "@/lib/data/fixtures";

const shell = {
  id: "inc_harbor",
  status: "active" as const,
  startedAt: "2026-11-07T14:12:00.000Z",
  sealedBrief: fixtureEnvelope("fixture-key", "harbor-brief"),
  integrity: UNSET_INTEGRITY,
};

describe("boundary schemas", () => {
  test("accepts a sealed incident shell", () => {
    expect(incidentShellSchema.parse(shell).id).toBe("inc_harbor");
  });

  test("rejects incident narrative fields on a shell", () => {
    expect(incidentShellSchema.safeParse({ ...shell, title: "Outage" }).success).toBe(false);
    expect(incidentShellSchema.safeParse({ ...shell, summary: "Details" }).success).toBe(false);
  });

  test("rejects a decrypted incident as a shell", () => {
    const incident = incidentSchema.parse({
      id: "inc_harbor",
      title: "Harbor",
      summary: "A decrypted brief that must stay in the browser.",
      status: "active",
      startedAt: "2026-11-07T14:12:00.000Z",
    });
    expect(incidentShellSchema.safeParse(incident).success).toBe(false);
  });

  test("rejects server-claimed integrity", () => {
    expect(
      integritySchema.safeParse({ status: "verified", source: "unset" }).success,
    ).toBe(false);
    expect(
      integritySchema.safeParse({ status: "verified", source: "browser-verified" }).success,
    ).toBe(true);
  });

  test("requires fixture envelopes to be labeled", () => {
    const envelope = fixtureEnvelope("fixture-key", "labeled");
    expect(envelope.ciphertext.startsWith("fixture:")).toBe(true);
    expect(
      ciphertextEnvelopeSchema.safeParse({ ...envelope, ciphertext: "not-labeled" }).success,
    ).toBe(false);
  });

  test("rejects names, keys, and extra join fields", () => {
    const valid = { incidentId: "inc_harbor", role: "responder" as const };
    expect(joinIncidentInputSchema.parse(valid)).toEqual(valid);
    expect(joinIncidentInputSchema.safeParse({ ...valid, displayName: "Ada" }).success).toBe(false);
    expect(joinIncidentInputSchema.safeParse({ ...valid, privateKey: "secret" }).success).toBe(false);
    expect(joinIncidentInputSchema.safeParse({ ...valid, channelKey: "secret" }).success).toBe(false);
  });
});
