import {
  legalDeadlineSchema,
  type LegalClockStart,
  type LegalDeadline,
  type LegalDeadlineStatus,
} from "@/types/legal";

export type LegalOffset =
  | { kind: "calendar_hours"; hours: number }
  | { kind: "business_days"; days: number };

export interface LegalCatalogEntry {
  id: string;
  citation: string;
  obligation: string;
  clockStarts: LegalClockStart;
  offset: LegalOffset;
  confirmationRequired: true;
}

/**
 * Public statute clocks. They are planning aids.
 * Counsel decides whether a duty applies. This catalog is not legal advice.
 */
export const LEGAL_CATALOG: readonly LegalCatalogEntry[] = [
  {
    id: "gdpr-art-33",
    citation: "GDPR Article 33",
    obligation:
      "Notify the competent supervisory authority of a personal data breach without undue delay and, where feasible, within 72 hours of becoming aware of it.",
    clockStarts: "awareness",
    offset: { kind: "calendar_hours", hours: 72 },
    confirmationRequired: true,
  },
  {
    id: "circia-incident",
    citation: "CIRCIA 6 U.S.C. 681b",
    obligation:
      "A covered entity reports a covered cyber incident to CISA within 72 hours after it reasonably believes the incident occurred.",
    clockStarts: "awareness",
    offset: { kind: "calendar_hours", hours: 72 },
    confirmationRequired: true,
  },
  {
    id: "circia-ransom",
    citation: "CIRCIA 6 U.S.C. 681b",
    obligation:
      "A covered entity reports a ransom payment to CISA within 24 hours after the payment is made.",
    clockStarts: "ransom_payment",
    offset: { kind: "calendar_hours", hours: 24 },
    confirmationRequired: true,
  },
  {
    id: "sec-8k-1-05",
    citation: "SEC Form 8-K Item 1.05",
    obligation:
      "A registrant discloses a material cybersecurity incident on Form 8-K within four business days after determining the incident is material.",
    clockStarts: "materiality_determination",
    offset: { kind: "business_days", days: 4 },
    confirmationRequired: true,
  },
];

export interface DeadlineProjectionInput {
  incidentId: string;
  awarenessAt: string;
  now: Date;
  materialityDeterminedAt?: string | null;
  ransomPaidAt?: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DUE_SOON_MS = 6 * HOUR_MS;

function validIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function startFor(clock: LegalClockStart, input: DeadlineProjectionInput): string | null {
  if (clock === "awareness") return validIso(input.awarenessAt);
  if (clock === "materiality_determination") return validIso(input.materialityDeterminedAt);
  return validIso(input.ransomPaidAt);
}

function missingStartNote(clock: LegalClockStart): string {
  if (clock === "materiality_determination") {
    return "The clock starts when counsel records a materiality determination. None is stored.";
  }
  if (clock === "ransom_payment") {
    return "The clock starts when a ransom payment time is recorded. None is stored.";
  }
  return "Awareness time is missing, so this clock is not scheduled.";
}

function deadlineStatus(dueAt: string | null, now: Date): LegalDeadlineStatus {
  if (!dueAt) return "unscheduled";
  const delta = Date.parse(dueAt) - now.getTime();
  if (delta < 0) return "elapsed";
  if (delta <= DUE_SOON_MS) return "due";
  return "upcoming";
}

export function describeOffset(offset: LegalOffset): string {
  if (offset.kind === "calendar_hours") return `${offset.hours} calendar hours`;
  return `${offset.days} business days`;
}

export function describeClockStart(clock: LegalClockStart): string {
  if (clock === "awareness") return "awareness";
  if (clock === "materiality_determination") return "materiality determination";
  return "ransom payment";
}

export function projectLegalDeadlines(input: DeadlineProjectionInput): LegalDeadline[] {
  return LEGAL_CATALOG.map((entry) => {
    const start = startFor(entry.clockStarts, input);
    let dueAt: string | null = null;
    let scheduleNote: string | null = null;

    if (!start) {
      scheduleNote = missingStartNote(entry.clockStarts);
    } else if (entry.offset.kind === "business_days") {
      scheduleNote = `${entry.offset.days} business days from materiality. This client does not count business days, so no due time is shown.`;
    } else {
      dueAt = new Date(Date.parse(start) + entry.offset.hours * HOUR_MS).toISOString();
    }

    return legalDeadlineSchema.parse({
      id: `${input.incidentId}__${entry.id}`,
      incidentId: input.incidentId,
      catalogId: entry.id,
      citation: entry.citation,
      obligation: entry.obligation,
      clockStarts: entry.clockStarts,
      dueAt,
      status: deadlineStatus(dueAt, input.now),
      scheduleNote,
      sealedCounselNote: null,
    });
  });
}
