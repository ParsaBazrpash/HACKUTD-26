import type { Applicability, ClockStatus, ComputedDeadline, LegalRule } from "@/lib/legal/types";

/** Shown on the legal page and the printable report. HAVEN computes clocks. It does not decide the law. */
export const HAVEN_LEGAL_DISCLAIMER =
  "HAVEN supports the legal response. It does not determine legal obligations on its own. These results are computed from the incident record. They are not an independent legal determination.";

/** A countdown is shown only when the engine marked the rule as applying and produced a running or elapsed instant. */
export function showsConfirmedCountdown(deadline: ComputedDeadline): boolean {
  return (
    deadline.applicability === "applies" &&
    deadline.dueAt instanceof Date &&
    Number.isFinite(deadline.dueAt.getTime()) &&
    (deadline.clockStatus === "scheduled" || deadline.clockStatus === "due_soon" || deadline.clockStatus === "elapsed")
  );
}

export function isCounselReview(deadline: ComputedDeadline): boolean {
  if (showsConfirmedCountdown(deadline)) return false;
  return deadline.applicability === "check" || deadline.clockStatus === "needs_counsel";
}

export function applicabilityLabel(value: Applicability): string {
  if (value === "applies") return "Applies";
  if (value === "check") return "Review with counsel";
  return "Not on this record";
}

const CLOCK_LABELS: Record<ClockStatus, string> = {
  not_applicable: "Not on this record",
  not_in_effect: "Not in effect",
  needs_counsel: "Review with counsel",
  not_started: "Clock not started",
  invalid_trigger: "Trigger unusable",
  future_trigger: "Trigger is in the future",
  scheduled: "Countdown running",
  due_soon: "Inside six hours",
  elapsed: "Window passed",
};

/** Pending applicability and materiality questions stay on "Review with counsel" instead of a countdown. */
export function clockStatusLabel(deadline: ComputedDeadline): string {
  if (isCounselReview(deadline)) return "Review with counsel";
  return CLOCK_LABELS[deadline.clockStatus];
}

export function triggerLabel(rule: LegalRule): string {
  if (rule.trigger.startsWith("legal.discovery")) return "Discovery";
  if (rule.trigger.startsWith("legal.materiality")) return "Materiality determination";
  if (rule.trigger.startsWith("None")) return "No triggering event";
  if (rule.trigger.startsWith("deadline.update")) return "Recorded deadline mark";
  return "Recorded trigger";
}

/** Lower numbers are more urgent. Counsel review is never ranked as a running clock. */
export function deadlineRank(deadline: ComputedDeadline): number {
  if (showsConfirmedCountdown(deadline)) {
    if (deadline.clockStatus === "elapsed") return 0;
    if (deadline.clockStatus === "due_soon") return 1;
    return 2;
  }
  if (
    deadline.clockStatus === "not_started" ||
    deadline.clockStatus === "future_trigger" ||
    deadline.clockStatus === "invalid_trigger"
  ) {
    return 4;
  }
  if (isCounselReview(deadline)) return 5;
  if (deadline.clockStatus === "not_in_effect") return 7;
  return 8;
}

export function compareDeadlines(a: ComputedDeadline, b: ComputedDeadline): number {
  const rank = deadlineRank(a) - deadlineRank(b);
  if (rank !== 0) return rank;
  const aDue = a.dueAt instanceof Date && Number.isFinite(a.dueAt.getTime()) ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt instanceof Date && Number.isFinite(b.dueAt.getTime()) ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return a.rule.id.localeCompare(b.rule.id);
}
