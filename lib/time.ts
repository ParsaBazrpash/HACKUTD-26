export const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

export function formatDuration(ms: number): string {
  const negative = ms < 0;
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const body = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return negative ? `-${body}` : body;
}

/** IANA zone of this runtime. In the browser that is the person's local zone. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Wall clock in the local zone. Stored instants stay absolute; only the reading changes. */
export function formatTimestamp(value: string | Date): string {
  return formatWallClock(value);
}

/** Same local reading as `formatTimestamp`. */
export function formatLocalTimestamp(value: string | Date): string {
  return formatWallClock(value);
}

function formatWallClock(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return value instanceof Date ? value.toISOString() : value;

  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: localTimeZone(),
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${read("day")} ${read("month")} ${read("hour")}:${read("minute")}`;
}
