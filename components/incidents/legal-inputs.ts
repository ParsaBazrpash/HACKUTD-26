// Input helpers for the Legal page. Pure functions, so the rules are tested
// without a browser. Every draft still goes through the frozen protocol schema.

import { DEADLINE_STATUSES, DiscoveryBodySchema, type DiscoveryBody } from "@/lib/protocol/events";
import type { MemberView } from "@/lib/client/types";
import { draftDeadline, type DraftResult } from "@/components/incidents/record-actions";
import type { DeadlineBody } from "@/lib/protocol/events";

export type DeterminationKind = "legal.discovery" | "legal.materiality";

/** A device clock can run a little fast. Anything later than this is a typo or a wrong zone. */
export const FUTURE_SKEW_MS = 5 * 60_000;
/** Older than this is almost always a wrong year. It is refused rather than starting overdue clocks. */
export const MAX_LOOKBACK_MS = 366 * 24 * 3_600_000;
export const BASIS_MIN = 12;
export const BASIS_MAX = 1000;

export const DETERMINATION_COPY: Record<
  DeterminationKind,
  { title: string; question: string; help: string; basisLabel: string; saved: string }
> = {
  "legal.discovery": {
    title: "Discovery",
    question: "When did the team determine a breach occurred?",
    help: "Starts the Texas and HIPAA clocks. Use the moment the facts were in hand, not when the room opened.",
    basisLabel: "What made it a breach at that moment?",
    saved: "Discovery recorded.",
  },
  "legal.materiality": {
    title: "Materiality",
    question: "When did the company decide the incident is material?",
    help: "Starts the SEC Form 8-K clock (four business days). Only a public company records this.",
    basisLabel: "Who decided, and on what facts?",
    saved: "Materiality recorded.",
  },
};

/** Starting points for the basis. Each one fills the box and stays editable. */
export const BASIS_PRESETS: Record<DeterminationKind, readonly { label: string; text: string }[]> = {
  "legal.discovery": [
    { label: "Ransom note", text: "Ransom note found on encrypted systems, and logs confirm attacker access." },
    { label: "Export in logs", text: "Logs show a bulk export of personal data before encryption." },
    { label: "Forensics confirmed", text: "The forensics firm confirmed unauthorized access to systems holding personal data." },
    { label: "Told by a third party", text: "A vendor or law enforcement told us our data was taken." },
  ],
  "legal.materiality": [
    { label: "Disclosure committee", text: "The disclosure committee concluded the incident is material after reviewing operational and financial impact." },
    { label: "Operations halted", text: "Material because core operations were halted and recovery cost is significant." },
  ],
};

/** Starting points for a deadline note, keyed by the status being recorded. */
export const NOTE_PRESETS: Record<(typeof DEADLINE_STATUSES)[number], readonly string[]> = {
  open: ["Waiting on the final resident count.", "Waiting on counsel's breach determination."],
  in_progress: ["Notice letter drafted, in counsel review.", "Mailing vendor engaged."],
  done: ["Notice sent. Copy and mailing proof filed as evidence.", "Filed on the regulator's portal. Confirmation saved."],
  not_applicable: ["Counsel determined notice is not required.", "Data was encrypted and the key was not taken."],
};

export const STATUS_LABELS: Record<(typeof DEADLINE_STATUSES)[number], string> = {
  open: "To do",
  in_progress: "Drafting",
  done: "Sent",
  not_applicable: "Not required",
};

/** Value for `<input type="datetime-local" step="1">`, in the browser's zone, to the second. */
export function toLocalSecondsValue(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(
    value.getMinutes(),
  )}:${pad(value.getSeconds())}`;
}

/** Reads a datetime-local value as wall time in the browser's zone. */
export function parseLocalInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rollovers such as February 30.
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return date;
}

/** The same instant in the zones the clocks use, so a wrong zone shows before saving. */
export function zoneEcho(at: Date): string {
  const read = (zone: string, label: string) =>
    `${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    }).format(at)} ${label}`;
  return `${read("America/Chicago", "Central")} · ${read("America/New_York", "Eastern")}`;
}

export interface DeterminationInput {
  kind: DeterminationKind;
  value: string;
  basis: string;
  now: number;
  /** Discovery on the record. Materiality cannot come before it. */
  discoveryAt?: Date | null;
}

export function draftDetermination(input: DeterminationInput): DraftResult<DiscoveryBody> {
  const at = parseLocalInput(input.value);
  if (!at) return { ok: false, reason: "Enter a full date and time." };
  if (at.getTime() > input.now + FUTURE_SKEW_MS) {
    return { ok: false, reason: "That time is in the future. Check the date and your time zone." };
  }
  if (at.getTime() < input.now - MAX_LOOKBACK_MS) {
    return { ok: false, reason: "That time is more than a year ago. Check the year." };
  }
  if (
    input.kind === "legal.materiality" &&
    input.discoveryAt instanceof Date &&
    Number.isFinite(input.discoveryAt.getTime()) &&
    at.getTime() < input.discoveryAt.getTime()
  ) {
    return { ok: false, reason: "Materiality cannot be earlier than discovery." };
  }
  const basis = input.basis.trim();
  if (basis.length < BASIS_MIN) {
    return { ok: false, reason: "Say briefly why. A legal clock needs a recorded basis." };
  }
  if (basis.length > BASIS_MAX) return { ok: false, reason: `The basis is limited to ${BASIS_MAX} characters.` };
  const parsed = DiscoveryBodySchema.safeParse({ determinedAt: at.toISOString(), basis });
  if (!parsed.success) return { ok: false, reason: "That update does not match the incident record." };
  return { ok: true, body: parsed.data };
}

export interface DeadlineMarkInput {
  ruleId: string;
  status: string;
  owner: string;
  note: string;
}

/** A closing mark (sent or not required) must say why, so the record explains itself. */
export function draftDeadlineMark(input: DeadlineMarkInput): DraftResult<DeadlineBody> {
  if ((input.status === "done" || input.status === "not_applicable") && input.note.trim().length < 4) {
    return {
      ok: false,
      reason: input.status === "done" ? "Add a note on how notice was sent." : "Add a note on why notice is not required.",
    };
  }
  return draftDeadline(input);
}

/**
 * Owners for a deadline: active commander and counsel, who can act on it.
 * The current owner stays listed even if their role or state changed, so a
 * re-save does not silently drop them.
 */
export function deadlineOwners(members: readonly MemberView[], current?: string): MemberView[] {
  const list = members.filter(
    (member) => member.state === "active" && (member.role === "commander" || member.role === "counsel"),
  );
  if (current && !list.some((member) => member.identity === current)) {
    const kept = members.find((member) => member.identity === current);
    if (kept) list.push(kept);
  }
  return list;
}
