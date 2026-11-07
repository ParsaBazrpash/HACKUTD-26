import { describe, expect, test } from "vitest";
import { projectLegalDeadlines } from "@/lib/legal";

const awarenessAt = "2026-11-07T12:00:00.000Z";

describe("legal deadline projection", () => {
  test("schedules GDPR 72 calendar hours from awareness", () => {
    const deadlines = projectLegalDeadlines({
      incidentId: "inc_harbor",
      awarenessAt,
      now: new Date("2026-11-07T12:00:00.000Z"),
    });
    const gdpr = deadlines.find((deadline) => deadline.catalogId === "gdpr-art-33");
    expect(gdpr?.dueAt).toBe("2026-11-10T12:00:00.000Z");
    expect(gdpr?.status).toBe("upcoming");
    expect(gdpr?.sealedCounselNote).toBeNull();
  });

  test("marks a clock due inside six hours and elapsed after the due time", () => {
    const dueSoon = projectLegalDeadlines({
      incidentId: "inc_harbor",
      awarenessAt,
      now: new Date("2026-11-10T08:00:00.000Z"),
    }).find((deadline) => deadline.catalogId === "gdpr-art-33");
    expect(dueSoon?.status).toBe("due");

    const elapsed = projectLegalDeadlines({
      incidentId: "inc_harbor",
      awarenessAt,
      now: new Date("2026-11-10T13:00:00.000Z"),
    }).find((deadline) => deadline.catalogId === "gdpr-art-33");
    expect(elapsed?.status).toBe("elapsed");
  });

  test("does not invent a business-day due time for the SEC clock", () => {
    const sec = projectLegalDeadlines({
      incidentId: "inc_harbor",
      awarenessAt,
      now: new Date("2026-11-08T12:00:00.000Z"),
      materialityDeterminedAt: "2026-11-08T12:00:00.000Z",
    }).find((deadline) => deadline.catalogId === "sec-8k-1-05");

    expect(sec?.dueAt).toBeNull();
    expect(sec?.status).toBe("unscheduled");
    expect(sec?.scheduleNote).toMatch(/business days/);
  });

  test("starts the ransom clock only when a payment time is supplied", () => {
    const missing = projectLegalDeadlines({
      incidentId: "inc_harbor",
      awarenessAt,
      now: new Date(awarenessAt),
    }).find((deadline) => deadline.catalogId === "circia-ransom");
    expect(missing?.dueAt).toBeNull();
    expect(missing?.status).toBe("unscheduled");

    const scheduled = projectLegalDeadlines({
      incidentId: "inc_harbor",
      awarenessAt,
      now: new Date("2026-11-07T12:00:00.000Z"),
      ransomPaidAt: "2026-11-07T18:00:00.000Z",
    }).find((deadline) => deadline.catalogId === "circia-ransom");
    expect(scheduled?.dueAt).toBe("2026-11-08T18:00:00.000Z");
    expect(scheduled?.status).toBe("upcoming");
  });
});
