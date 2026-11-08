import { describe, expect, test } from "vitest";
import type { DeadlineUpdate, IncidentState, ScopeBody, ScopeItem } from "@/lib/client/types";
import { EMPTY_PROFILE } from "@/lib/client/types";
import { civilDate } from "@/lib/legal/calendar";
import {
  COUNSEL_REVIEW_WARNING,
  LEGAL_RULES,
  computeDeadlines,
  exposureSummary,
  nextCountdown,
  type ComputedDeadline,
} from "@/lib/legal";

const MEMBER = {
  identity: "a".repeat(64),
  displayName: "Counsel",
  role: "counsel" as const,
};

const NOW = new Date("2026-11-07T14:00:00-06:00");

function state(partial: Partial<IncidentState> = {}): IncidentState {
  return {
    connection: "ready",
    me: null,
    incident: null,
    status: null,
    members: [],
    channels: [],
    timeline: [],
    scope: [],
    tasks: [],
    profile: EMPTY_PROFILE,
    discovery: null,
    materiality: null,
    deadlineUpdates: {},
    evidence: [],
    integrity: {
      ok: true,
      checkedAt: NOW,
      channels: {},
      rosterFailures: [],
    },
    org: null,
    roster: [],
    pages: [],
    ...partial,
  };
}

function at(iso: string): IncidentState["discovery"] {
  return { determinedAt: new Date(iso), basis: "Recorded determination.", by: MEMBER };
}

function item(partial: Partial<ScopeBody> & Pick<ScopeBody, "status" | "dataTypes">, id = "00000000-0000-4000-8000-000000000001"): ScopeItem {
  const latest: ScopeBody = {
    itemId: id,
    system: "records",
    assetType: "database",
    affected: [],
    notes: "",
    ...partial,
  };
  return { itemId: id, latest, history: [] };
}

function update(ruleId: string, status: DeadlineUpdate["body"]["status"], note: string, owner = MEMBER.identity): DeadlineUpdate {
  return {
    seq: 1n,
    by: MEMBER,
    at: NOW,
    sentAt: NOW,
    verdict: { ok: true, failures: [], warnings: [] },
    body: { ruleId, status, note, owner },
  };
}

function find(deadlines: ComputedDeadline[], id: string): ComputedDeadline {
  const match = deadlines.find((deadline) => deadline.rule.id === id);
  if (!match) throw new Error(`Missing rule ${id}`);
  return match;
}

const TEXAS_SCOPE = [item({ status: "exfiltrated", dataTypes: ["ssn"], affected: [{ state: "TX", count: 300 }] })];

describe("legal deadline engine", () => {
  test("every catalog rule carries a citation, an official source, and the counsel warning", () => {
    expect(LEGAL_RULES.map((rule) => rule.id)).toEqual([
      "sec-8k-105",
      "hipaa-404",
      "hipaa-408",
      "hipaa-406",
      "tx-521-ind",
      "tx-521-ag",
    ]);
    for (const rule of LEGAL_RULES) {
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.jurisdiction.length).toBeGreaterThan(0);
      expect(rule.citation.length).toBeGreaterThan(0);
      expect(rule.sourceUrl.startsWith("https://")).toBe(true);
      expect(rule.appliesWhen.length).toBeGreaterThan(0);
      expect(rule.trigger.length).toBeGreaterThan(0);
      expect(rule.calculation.length).toBeGreaterThan(0);
    }
    const deadlines = computeDeadlines(state(), NOW);
    expect(deadlines.length).toBeGreaterThan(0);
    for (const deadline of deadlines) {
      expect(deadline.counselReview).toContain(COUNSEL_REVIEW_WARNING);
    }
  });

  test("Texas attorney general notice is due at the end of the 30th civil day in Central time", () => {
    const deadlines = computeDeadlines(state({ discovery: at("2026-11-07T14:00:00-06:00"), scope: TEXAS_SCOPE }), NOW);
    const ag = find(deadlines, "tx-521-ag");
    expect(ag.applicability).toBe("applies");
    expect(civilDate(ag.startedAt!, "America/Chicago")).toBe("2026-11-07");
    expect(civilDate(ag.dueAt!, "America/Chicago")).toBe("2026-12-07");
    expect(civilDate(new Date(ag.dueAt!.getTime() + 1), "America/Chicago")).toBe("2026-12-08");
    expect(ag.clockStatus).toBe("scheduled");
    const individuals = find(deadlines, "tx-521-ind");
    expect(civilDate(individuals.dueAt!, "America/Chicago")).toBe("2027-01-06");
  });

  test("the Texas due instant itself is still inside the window", () => {
    const incident = state({ discovery: at("2026-11-07T14:00:00-06:00"), scope: TEXAS_SCOPE });
    const due = find(computeDeadlines(incident, NOW), "tx-521-ag").dueAt!;
    expect(find(computeDeadlines(incident, due), "tx-521-ag").clockStatus).toBe("due_soon");
    expect(find(computeDeadlines(incident, new Date(due.getTime() + 1)), "tx-521-ag").clockStatus).toBe("elapsed");
  });

  test("SEC materiality on Wednesday November 25 2026 is due Wednesday December 2 at 5:30 p.m. Eastern", () => {
    const sec = find(
      computeDeadlines(
        state({
          profile: { ...EMPTY_PROFILE, publicCompany: true },
          materiality: at("2026-11-25T15:00:00-05:00"),
        }),
        new Date("2026-11-25T15:00:00-05:00"),
      ),
      "sec-8k-105",
    );
    expect(sec.applicability).toBe("applies");
    expect(sec.dueAt?.toISOString()).toBe("2026-12-02T22:30:00.000Z");
    expect(civilDate(sec.dueAt!, "America/New_York")).toBe("2026-12-02");
    expect(sec.explanation).toContain("Thanksgiving Day (2026-11-26)");
    expect(sec.explanation).not.toContain("2026-11-28");
    const exact = find(
      computeDeadlines(
        state({
          profile: { ...EMPTY_PROFILE, publicCompany: true },
          materiality: at("2026-11-25T15:00:00-05:00"),
        }),
        new Date("2026-12-02T22:30:00.000Z"),
      ),
      "sec-8k-105",
    );
    expect(exact.clockStatus).not.toBe("elapsed");
    expect(
      find(
        computeDeadlines(
          state({
            profile: { ...EMPTY_PROFILE, publicCompany: true },
            materiality: at("2026-11-25T15:00:00-05:00"),
          }),
          new Date("2026-12-02T22:30:00.001Z"),
        ),
        "sec-8k-105",
      ).clockStatus,
    ).toBe("elapsed");
  });

  test("the observed Independence Day is skipped, and an unloaded holiday year produces no date", () => {
    const skipped = find(
      computeDeadlines(
        state({
          profile: { ...EMPTY_PROFILE, publicCompany: true },
          materiality: at("2026-06-30T12:00:00-04:00"),
        }),
        new Date("2026-06-30T12:00:00-04:00"),
      ),
      "sec-8k-105",
    );
    expect(civilDate(skipped.dueAt!, "America/New_York")).toBe("2026-07-07");
    expect(skipped.explanation).toContain("2026-07-03");

    const unloaded = find(
      computeDeadlines(
        state({
          profile: { ...EMPTY_PROFILE, publicCompany: true },
          materiality: at("2025-06-04T15:00:00-04:00"),
        }),
        new Date("2025-06-04T15:00:00-04:00"),
      ),
      "sec-8k-105",
    );
    expect(unloaded.dueAt).toBeNull();
    expect(unloaded.clockStatus).toBe("needs_counsel");
    expect(unloaded.explanation).toContain("2026 and 2027");
  });

  test("a missing materiality determination does not start the SEC countdown", () => {
    const sec = find(
      computeDeadlines(
        state({
          profile: { ...EMPTY_PROFILE, publicCompany: true },
          discovery: at("2026-11-07T14:00:00-06:00"),
        }),
        NOW,
      ),
      "sec-8k-105",
    );
    expect(sec.applicability).toBe("applies");
    expect(sec.clockStatus).toBe("not_started");
    expect(sec.dueAt).toBeNull();
    expect(sec.explanation).toContain("has not started");
  });

  test("a private company does not receive an SEC countdown", () => {
    const sec = find(
      computeDeadlines(
        state({
          materiality: at("2026-11-25T15:00:00-05:00"),
        }),
        NOW,
      ),
      "sec-8k-105",
    );
    expect(sec.applicability).toBe("no");
    expect(sec.dueAt).toBeNull();
  });

  test("no discovery time means the clock has not started", () => {
    const texas = find(computeDeadlines(state({ scope: TEXAS_SCOPE }), NOW), "tx-521-ind");
    expect(texas.clockStatus).toBe("not_started");
    expect(texas.dueAt).toBeNull();
    expect(texas.startedAt).toBeNull();
  });

  test("malformed, future, and unusable clocks do not throw or invent a countdown", () => {
    const exposed = state({
      profile: { ...EMPTY_PROFILE, publicCompany: true },
      discovery: { determinedAt: new Date(Number.NaN), basis: "Unusable.", by: MEMBER },
      materiality: { determinedAt: new Date("not-a-date"), basis: "Unusable.", by: MEMBER },
      scope: TEXAS_SCOPE,
    });
    expect(() => computeDeadlines(exposed, NOW)).not.toThrow();
    const invalid = computeDeadlines(exposed, NOW);
    expect(find(invalid, "tx-521-ind").clockStatus).toBe("invalid_trigger");
    expect(find(invalid, "tx-521-ind").dueAt).toBeNull();
    expect(find(invalid, "sec-8k-105").dueAt).toBeNull();

    const future = computeDeadlines(
      state({ discovery: at("2026-11-08T14:00:00-06:00"), scope: TEXAS_SCOPE }),
      NOW,
    );
    expect(find(future, "tx-521-ind").clockStatus).toBe("future_trigger");
    expect(find(future, "tx-521-ind").dueAt).toBeNull();

    expect(() => computeDeadlines(exposed, new Date(Number.NaN))).not.toThrow();
  });

  test("HIPAA counts encrypted PHI, and encryption alone does not start Texas", () => {
    const deadlines = computeDeadlines(
      state({
        profile: { ...EMPTY_PROFILE, hipaaCoveredEntity: true },
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: [
          item({
            status: "encrypted",
            dataTypes: ["phi"],
            recordCount: 10,
            affected: [{ state: "TX", count: 10 }],
          }),
        ],
      }),
      NOW,
    );
    const individuals = find(deadlines, "hipaa-404");
    expect(individuals.applicability).toBe("applies");
    expect(civilDate(individuals.dueAt!, "America/Chicago")).toBe("2027-01-06");
    expect(find(deadlines, "hipaa-408").dueAt).toBeNull();
    expect(find(deadlines, "hipaa-408").explanation).toContain("annual log");
    expect(find(deadlines, "hipaa-406").applicability).toBe("no");
    expect(find(deadlines, "tx-521-ind").dueAt).toBeNull();
    expect(find(deadlines, "tx-521-ag").dueAt).toBeNull();
  });

  test("HIPAA HHS uses 500 or more, and media notice uses more than 500", () => {
    const media = computeDeadlines(
      state({
        profile: { ...EMPTY_PROFILE, hipaaCoveredEntity: true },
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: [item({ status: "suspected", dataTypes: ["phi"], recordCount: 501, affected: [{ state: "OH", count: 501 }] })],
      }),
      NOW,
    );
    expect(find(media, "hipaa-408").applicability).toBe("applies");
    expect(find(media, "hipaa-406").applicability).toBe("applies");
    expect(find(media, "hipaa-406").dueAt).not.toBeNull();

    const exact = computeDeadlines(
      state({
        profile: { ...EMPTY_PROFILE, hipaaCoveredEntity: true },
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: [item({ status: "suspected", dataTypes: ["phi"], recordCount: 500, affected: [{ state: "OH", count: 500 }] })],
      }),
      NOW,
    );
    expect(find(exact, "hipaa-408").applicability).toBe("applies");
    expect(find(exact, "hipaa-406").applicability).toBe("no");
    expect(find(exact, "hipaa-406").dueAt).toBeNull();
  });

  test("a missing PHI count does not borrow a non-PHI record count", () => {
    const secretary = find(
      computeDeadlines(
        state({
          profile: { ...EMPTY_PROFILE, hipaaCoveredEntity: true },
          discovery: at("2026-11-07T14:00:00-06:00"),
          scope: [
            item({ status: "exfiltrated", dataTypes: ["ssn"], recordCount: 12_400, affected: [{ state: "TX", count: 100 }] }, "00000000-0000-4000-8000-000000000010"),
            item({ status: "suspected", dataTypes: ["phi"], affected: [{ state: "TX", count: 10 }] }, "00000000-0000-4000-8000-000000000011"),
          ],
        }),
        NOW,
      ),
      "hipaa-408",
    );
    expect(secretary.dueAt).toBeNull();
    expect(secretary.clockStatus).toBe("needs_counsel");
  });

  test("Texas attorney general notice appears at 250 residents and not at 249", () => {
    const below = computeDeadlines(
      state({
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: [item({ status: "exfiltrated", dataTypes: ["ssn"], affected: [{ state: "TX", count: 249 }] })],
      }),
      NOW,
    );
    expect(find(below, "tx-521-ind").applicability).toBe("applies");
    expect(civilDate(find(below, "tx-521-ind").dueAt!, "America/Chicago")).toBe("2027-01-06");
    expect(find(below, "tx-521-ag").applicability).toBe("no");
    expect(find(below, "tx-521-ag").dueAt).toBeNull();

    const met = find(
      computeDeadlines(
        state({
          discovery: at("2026-11-07T14:00:00-06:00"),
          scope: [item({ status: "exfiltrated", dataTypes: ["ssn"], affected: [{ state: "TX", count: 250 }] })],
        }),
        NOW,
      ),
      "tx-521-ag",
    );
    expect(met.applicability).toBe("applies");
    expect(civilDate(met.dueAt!, "America/Chicago")).toBe("2026-12-07");
    expect(met.dueAt?.toISOString()).toBe("2026-12-08T05:59:59.999Z");
  });

  test("a known Texas count that already meets 250 still counts when another system has no resident list", () => {
    const attorney = find(
      computeDeadlines(
        state({
          discovery: at("2026-11-07T14:00:00-06:00"),
          scope: [
            item({ status: "exfiltrated", dataTypes: ["ssn"], affected: [{ state: "TX", count: 9_800 }] }, "00000000-0000-4000-8000-000000000020"),
            item({ status: "suspected", dataTypes: ["phi"] }, "00000000-0000-4000-8000-000000000021"),
          ],
        }),
        NOW,
      ),
      "tx-521-ag",
    );
    expect(attorney.applicability).toBe("applies");
    expect(attorney.dueAt).not.toBeNull();
  });

  test("unknown jurisdiction and incomplete applicability go to counsel with no invented date", () => {
    const deadlines = computeDeadlines(
      state({
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: [
          item(
            {
              status: "exfiltrated",
              dataTypes: ["ssn"],
              affected: [
                { state: "CA", count: 2_600 },
                { state: "NY", count: 40 },
              ],
            },
            "00000000-0000-4000-8000-000000000030",
          ),
          item({ status: "suspected", dataTypes: ["other_pii"] }, "00000000-0000-4000-8000-000000000031"),
        ],
      }),
      NOW,
    );
    const california = find(deadlines, "state-check-ca");
    const newYork = find(deadlines, "state-check-ny");
    expect(california.applicability).toBe("check");
    expect(california.clockStatus).toBe("needs_counsel");
    expect(california.dueAt).toBeNull();
    expect(california.explanation).toContain("30 calendar days");
    expect(california.explanation).toContain("No California countdown");
    expect(newYork.dueAt).toBeNull();
    expect(newYork.explanation).toContain("does not encode");
    expect(find(deadlines, "state-check-unknown").dueAt).toBeNull();
    expect(find(deadlines, "hipaa-404").applicability).toBe("no");
  });

  test("contained PHI does not start a HIPAA countdown", () => {
    const individuals = find(
      computeDeadlines(
        state({
          profile: { ...EMPTY_PROFILE, hipaaCoveredEntity: true },
          discovery: at("2026-11-07T14:00:00-06:00"),
          scope: [item({ status: "contained", dataTypes: ["phi"], recordCount: 800, affected: [{ state: "TX", count: 800 }] })],
        }),
        NOW,
      ),
      "hipaa-404",
    );
    expect(individuals.applicability).toBe("check");
    expect(individuals.dueAt).toBeNull();
  });

  test("only the Winstead catalog is produced, whatever other stored profile flags say", () => {
    const deadlines = computeDeadlines(
      state({
        profile: { ...EMPTY_PROFILE, defenseContractor: true, bank: true, nydfsRegulated: true, euDataSubjects: true },
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: [item({ status: "exfiltrated", dataTypes: ["other_pii"], euResidents: 40, affected: [{ state: "TX", count: 1 }] })],
      }),
      NOW,
    );
    const ids = deadlines.map((deadline) => deadline.rule.id);
    for (const gone of ["gdpr-33", "nydfs-50017", "dfars-7012", "bank-36h", "circia-reporting"]) {
      expect(ids).not.toContain(gone);
    }
    expect(deadlines.every((deadline) => deadline.dueAt === null || deadline.applicability === "applies")).toBe(true);
    const outside = find(deadlines, "outside-catalog");
    expect(outside.applicability).toBe("check");
    expect(outside.dueAt).toBeNull();
    expect(outside.explanation).toContain("GDPR");
    expect(outside.explanation).toContain("NYDFS");
    expect(find(computeDeadlines(state({ scope: TEXAS_SCOPE }), NOW), "tx-521-ind")).toBeTruthy();
    expect(computeDeadlines(state({ scope: TEXAS_SCOPE }), NOW).some((row) => row.rule.id === "outside-catalog")).toBe(false);
  });

  test("EU residents on an exposed system alone raise the counsel row", () => {
    const rows = computeDeadlines(
      state({ scope: [item({ status: "suspected", dataTypes: ["other_pii"], euResidents: 3, affected: [] })] }),
      NOW,
    );
    expect(find(rows, "outside-catalog").explanation).toContain("EU data subjects");
  });

  test("the exposure summary counts the way the Texas rule counts", () => {
    const summary = exposureSummary(
      state({
        scope: [
          item({ status: "encrypted", dataTypes: ["ssn"], affected: [{ state: "TX", count: 300 }, { state: "CA", count: 50 }] }, "00000000-0000-4000-8000-000000000041"),
          item({ status: "exfiltrated", dataTypes: ["credentials"], affected: [{ state: "TX", count: 900 }] }, "00000000-0000-4000-8000-000000000042"),
          item({ status: "exfiltrated", dataTypes: ["ssn"], affected: [{ state: "TX", count: 20 }, { state: "CA", count: 7 }] }, "00000000-0000-4000-8000-000000000043"),
        ],
      }),
    );
    expect(summary.texasCount).toBe(20);
    expect(summary.otherStates.get("CA")).toBe(7);
  });

  test("recorded deadline updates are returned and do not rewrite the computed instant", () => {
    const deadlines = computeDeadlines(
      state({
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: TEXAS_SCOPE,
        deadlineUpdates: {
          "tx-521-ag": update("tx-521-ag", "in_progress", "Drafting the attorney general notice."),
          "custom-clock": update("custom-clock", "done", "Closed in the war room."),
        },
      }),
      NOW,
    );
    const ag = find(deadlines, "tx-521-ag");
    expect(ag.recorded?.status).toBe("in_progress");
    expect(ag.recorded?.owner).toBe(MEMBER.identity);
    expect(ag.recorded?.note).toBe("Drafting the attorney general notice.");
    expect(civilDate(ag.dueAt!, "America/Chicago")).toBe("2026-12-07");

    const custom = find(deadlines, "custom-clock");
    expect(custom.dueAt).toBeNull();
    expect(custom.recorded?.status).toBe("done");
    expect(custom.clockStatus).toBe("needs_counsel");

    const done = computeDeadlines(
      state({
        discovery: at("2026-11-07T14:00:00-06:00"),
        scope: TEXAS_SCOPE,
        deadlineUpdates: { "tx-521-ag": update("tx-521-ag", "done", "Filed.") },
      }),
      NOW,
    );
    expect(find(done, "tx-521-ag").dueAt).not.toBeNull();
    expect(nextCountdown(done)?.rule.id).toBe("tx-521-ind");
  });

  test("the same state and clock produce the same result", () => {
    const incident = state({
      profile: { ...EMPTY_PROFILE, publicCompany: true, bank: true },
      discovery: at("2026-11-07T14:00:00-06:00"),
      materiality: at("2026-11-25T15:00:00-05:00"),
    });
    const discoveryTime = incident.discovery?.determinedAt.getTime();
    const first = computeDeadlines(incident, NOW);
    const second = computeDeadlines(incident, NOW);
    expect(incident.discovery?.determinedAt.getTime()).toBe(discoveryTime);
    expect(first.map((deadline) => [deadline.rule.id, deadline.dueAt?.toISOString() ?? null, deadline.clockStatus])).toEqual(
      second.map((deadline) => [deadline.rule.id, deadline.dueAt?.toISOString() ?? null, deadline.clockStatus]),
    );
  });
});
