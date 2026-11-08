import { describe, expect, test } from "vitest";
import {
  FEDERAL_HOLIDAYS,
  addBusinessDays,
  addElapsedHours,
  civilDate,
  civilParts,
  endOfNthCalendarDay,
  holidayOn,
  zonedWallTime,
} from "@/lib/legal/calendar";

describe("legal calendar", () => {
  test("uses the OPM observed holidays for 2026 and 2027", () => {
    expect(FEDERAL_HOLIDAYS.filter((holiday) => holiday.date.startsWith("2026")).map((holiday) => holiday.date)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03",
      "2026-09-07",
      "2026-10-12",
      "2026-11-11",
      "2026-11-26",
      "2026-12-25",
    ]);
    expect(FEDERAL_HOLIDAYS.filter((holiday) => holiday.date.startsWith("2027")).map((holiday) => holiday.date)).toEqual([
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-05-31",
      "2027-06-18",
      "2027-07-05",
      "2027-09-06",
      "2027-10-11",
      "2027-11-11",
      "2027-11-25",
      "2027-12-24",
      "2027-12-31",
    ]);
    expect(holidayOn("2026-11-26")).toBe("Thanksgiving Day");
    expect(holidayOn("2026-11-27")).toBeNull();
    expect(holidayOn("2026-07-03")).toMatch(/Independence Day/);
    expect(holidayOn("2026-07-04")).toBeNull();
    expect(holidayOn("2027-12-31")).toBe("New Year's Day, observed");
  });

  test("adds elapsed hours across the March 2026 daylight-saving change", () => {
    const start = new Date("2026-03-07T14:00:00-05:00");
    const due = addElapsedHours(start, 72);
    expect(due.toISOString()).toBe("2026-03-10T19:00:00.000Z");
    expect(civilDate(start, "America/New_York")).toBe("2026-03-07");
    expect(civilDate(due, "America/New_York")).toBe("2026-03-10");
    expect(civilParts(due, "America/New_York").hour).toBe(15);
    expect(civilParts(start, "America/New_York").hour).toBe(14);
  });

  test("places 5:30 p.m. Eastern on the Eastern instant", () => {
    expect(zonedWallTime("2026-12-02", 17, 30, "America/New_York").toISOString()).toBe("2026-12-02T22:30:00.000Z");
    expect(zonedWallTime("2026-07-07", 17, 30, "America/New_York").toISOString()).toBe("2026-07-07T21:30:00.000Z");
  });

  test("ends a calendar-day period on the last millisecond of the civil day", () => {
    const start = new Date("2026-11-07T14:00:00-06:00");
    const due = endOfNthCalendarDay(start, 60, "America/Chicago");
    expect(civilDate(due, "America/Chicago")).toBe("2027-01-06");
    expect(due.toISOString()).toBe("2027-01-07T05:59:59.999Z");
  });

  test("skips Thanksgiving and refuses a year whose holiday list is not loaded", () => {
    const thanksgiving = addBusinessDays(new Date("2026-11-25T15:00:00-05:00"), 4, "America/New_York");
    expect(thanksgiving?.dueDate).toBe("2026-12-02");
    expect(thanksgiving?.skippedHolidays.map((holiday) => holiday.date)).toEqual(["2026-11-26"]);

    const observed = addBusinessDays(new Date("2026-06-30T12:00:00-04:00"), 4, "America/New_York");
    expect(observed?.dueDate).toBe("2026-07-07");
    expect(observed?.skippedHolidays.map((holiday) => holiday.date)).toContain("2026-07-03");

    expect(addBusinessDays(new Date("2025-06-04T15:00:00-04:00"), 4, "America/New_York")).toBeNull();
    expect(addBusinessDays(new Date("2027-12-27T12:00:00-05:00"), 4, "America/New_York")).toBeNull();
    expect(addBusinessDays(new Date("2027-12-30T15:00:00-05:00"), 4, "America/New_York")).toBeNull();
  });
});
