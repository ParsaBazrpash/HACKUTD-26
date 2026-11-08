/**
 * Legal-engine types. Owned by `lib/legal`.
 * The engine reads `IncidentState` and does not import the pre-contract model.
 */

export const COUNSEL_REVIEW_WARNING =
  "Example rules for demonstration. Verify with counsel for each matter.";

/** Whether the recorded facts bring a rule onto this incident. */
export type Applicability = "applies" | "check" | "no";

/**
 * Clock position. `needs_counsel` and `not_in_effect` never carry a countdown.
 * `due_soon` is a six-hour display threshold, not a statutory period.
 */
export type ClockStatus =
  | "not_applicable"
  | "not_in_effect"
  | "needs_counsel"
  | "not_started"
  | "invalid_trigger"
  | "future_trigger"
  | "scheduled"
  | "due_soon"
  | "elapsed";

export interface LegalRule {
  id: string;
  name: string;
  jurisdiction: string;
  citation: string;
  sourceUrl: string;
  /** When the recorded profile and scope bring this rule onto the incident. */
  appliesWhen: string;
  /** Protocol event that starts the clock. */
  trigger: string;
  /** How the due instant is calculated when a countdown runs. */
  calculation: string;
  /** Zone used for civil dates. Null when the deadline is a pure elapsed duration. */
  timeZone: string | null;
}

/** Workflow mark from `deadline.update`. It does not rewrite the computed instant. */
export interface RecordedDeadline {
  status: "open" | "in_progress" | "done" | "not_applicable";
  owner?: string;
  note: string;
  at: Date;
}

export interface ComputedDeadline {
  rule: LegalRule;
  applicability: Applicability;
  clockStatus: ClockStatus;
  startedAt: Date | null;
  dueAt: Date | null;
  explanation: string;
  counselReview: string;
  recorded: RecordedDeadline | null;
}
