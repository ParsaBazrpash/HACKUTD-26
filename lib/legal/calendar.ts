/**
 * Civil-date and business-day arithmetic for the legal engine.
 *
 * Federal holidays are the observed dates OPM published for 2026 and 2027
 * under 5 U.S.C. 6103, checked November 7, 2026:
 * https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/#url=2026
 *
 * December 31, 2027 is New Year's Day 2028 observed. OPM prints that Friday
 * on the 2028 schedule, not the 2027 schedule. It is included here so a
 * business-day count does not treat it as a filing day. A count that needs
 * any other date outside 2026 and 2027 returns no date.
 */

export const OPM_HOLIDAY_URL =
  "https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/#url=2026";

export const CIVIL_ZONE = "America/Chicago";
export const SEC_ZONE = "America/New_York";

/** Last instant an EDGAR direct transmission still counts as that business day. 17 CFR 232.13(a)(2). */
export const SEC_FILING_HOUR = 17;
export const SEC_FILING_MINUTE = 30;

const MS_PER_HOUR = 3_600_000;

export interface FederalHoliday {
  date: string;
  name: string;
}

export const FEDERAL_HOLIDAYS: readonly FederalHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-01-19", name: "Birthday of Martin Luther King, Jr." },
  { date: "2026-02-16", name: "Washington's Birthday" },
  { date: "2026-05-25", name: "Memorial Day" },
  { date: "2026-06-19", name: "Juneteenth National Independence Day" },
  { date: "2026-07-03", name: "Independence Day, observed" },
  { date: "2026-09-07", name: "Labor Day" },
  { date: "2026-10-12", name: "Columbus Day" },
  { date: "2026-11-11", name: "Veterans Day" },
  { date: "2026-11-26", name: "Thanksgiving Day" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-01-18", name: "Birthday of Martin Luther King, Jr." },
  { date: "2027-02-15", name: "Washington's Birthday" },
  { date: "2027-05-31", name: "Memorial Day" },
  { date: "2027-06-18", name: "Juneteenth National Independence Day, observed" },
  { date: "2027-07-05", name: "Independence Day, observed" },
  { date: "2027-09-06", name: "Labor Day" },
  { date: "2027-10-11", name: "Columbus Day" },
  { date: "2027-11-11", name: "Veterans Day" },
  { date: "2027-11-25", name: "Thanksgiving Day" },
  { date: "2027-12-24", name: "Christmas Day, observed" },
  { date: "2027-12-31", name: "New Year's Day, observed" },
];

const HOLIDAYS_BY_DATE = new Map(FEDERAL_HOLIDAYS.map((holiday) => [holiday.date, holiday.name]));
const HOLIDAY_YEARS = new Set(FEDERAL_HOLIDAYS.map((holiday) => holiday.date.slice(0, 4)));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface CivilParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function addElapsedHours(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * MS_PER_HOUR);
}

export function civilParts(instant: Date, timeZone: string): CivilParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`Missing ${type} in ${timeZone}`);
    return Number(value);
  };
  let hour = read("hour");
  if (hour === 24) hour = 0;
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour,
    minute: read("minute"),
    second: read("second"),
  };
}

export function civilDate(instant: Date, timeZone: string): string {
  const parts = civilParts(instant, timeZone);
  return isoDate(parts.year, parts.month, parts.day);
}

export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Instant of a wall-clock time on a civil date in `timeZone`. */
export function zonedWallTime(iso: string, hour: number, minute: number, timeZone: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = zoneOffsetMs(timeZone, utcGuess);
  let utc = utcGuess - firstOffset;
  const secondOffset = zoneOffsetMs(timeZone, utc);
  if (secondOffset !== firstOffset) utc = utcGuess - secondOffset;
  return new Date(utc);
}

/**
 * Last millisecond of the civil date `days` after `start`'s civil date.
 * "The 60th day after" and "60 calendar days after" both land on that date.
 * The count uses the calendar, not 24-hour blocks, so a daylight-saving
 * change does not move the civil day.
 */
export function endOfNthCalendarDay(start: Date, days: number, timeZone: string): Date {
  const dueDate = addIsoDays(civilDate(start, timeZone), days);
  const nextMidnight = zonedWallTime(addIsoDays(dueDate, 1), 0, 0, timeZone);
  return new Date(nextMidnight.getTime() - 1);
}

export interface BusinessDayWalk {
  dueDate: string;
  skippedHolidays: readonly FederalHoliday[];
}

/**
 * Form 8-K General Instruction B.1: the report is due within four business
 * days after the event. The event date is not counted. Each step moves to
 * the next civil day and skips Saturdays, Sundays, and federal holidays.
 * If the event itself falls on a weekend or holiday, the first business day
 * thereafter is day one of the count.
 *
 * Returns null when a weekday falls in a year whose holiday list is not loaded.
 */
export function addBusinessDays(start: Date, days: number, timeZone: string): BusinessDayWalk | null {
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(days) || days < 1) return null;
  let cursor = civilDate(start, timeZone);
  const skipped: FederalHoliday[] = [];
  let counted = 0;
  while (counted < days) {
    cursor = addIsoDays(cursor, 1);
    const kind = classifyDay(cursor);
    if (kind === "unknown") return null;
    if (kind === "holiday") {
      const name = HOLIDAYS_BY_DATE.get(cursor);
      if (name) skipped.push({ date: cursor, name });
      continue;
    }
    if (kind === "weekend") continue;
    counted += 1;
  }
  return { dueDate: cursor, skippedHolidays: skipped };
}

export function formatLegalInstant(value: Date, timeZone: string): string {
  if (!Number.isFinite(value.getTime())) return "Unusable time";
  const parts = civilParts(value, timeZone);
  const month = MONTHS[parts.month - 1] ?? "";
  const day = String(parts.day).padStart(2, "0");
  const hour = String(parts.hour).padStart(2, "0");
  const minute = String(parts.minute).padStart(2, "0");
  return `${day} ${month} ${parts.year} ${hour}:${minute} ${timeZone}`;
}

export function holidayOn(iso: string): string | null {
  return HOLIDAYS_BY_DATE.get(iso) ?? null;
}

function classifyDay(iso: string): "weekend" | "holiday" | "business" | "unknown" {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return "weekend";
  if (!HOLIDAY_YEARS.has(iso.slice(0, 4))) return "unknown";
  if (HOLIDAYS_BY_DATE.has(iso)) return "holiday";
  return "business";
}

function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = civilParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  return asUtc - utcMs;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
