/** UTC stamps for the printable report. The PDF labels every clock UTC. */

const STAMP = /^(\d{2} [\p{L}.]+) (\d{4}), (\d{2}:\d{2}) UTC$/u;

export function formatReportStamp(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const month = read("month").replace(/\.$/, "");
  return `${read("day")} ${month} ${read("year")}, ${read("hour")}:${read("minute")} UTC`;
}

/** "08 Nov 2026, 01:53 UTC" -> "08 Nov, 01:53 UTC" */
export function reportPill(stamp: string): string {
  const match = STAMP.exec(stamp);
  return match ? `${match[1]}, ${match[3]} UTC` : stamp;
}

/** "08 Nov 2026, 01:53 UTC" -> "08 Nov 01:53" */
export function reportSigned(stamp: string): string {
  const match = STAMP.exec(stamp);
  return match ? `${match[1]} ${match[3]}` : stamp;
}

/** "08 Nov 2026, 01:53 UTC" -> "08 Nov 01:53 UTC" */
export function reportClock(stamp: string): string {
  const match = STAMP.exec(stamp);
  return match ? `${match[1]} ${match[3]} UTC` : stamp;
}
