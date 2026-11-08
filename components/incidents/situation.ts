import type {
  ChannelMessage,
  FailureReason,
  IntegrityReport,
  Verdict,
  WarningReason,
} from "@/lib/client/types";

const EXPOSED = new Set(["suspected", "encrypted", "exfiltrated"]);

export const SCOPE_GROUP_ORDER = [
  "exfiltrated",
  "encrypted",
  "suspected",
  "unknown",
  "contained",
  "eradicated",
  "restored",
] as const;

const FAILURE_LABELS: Record<FailureReason, string> = {
  gap: "sequence gap",
  chain_broken: "chain break",
  unknown_author: "unknown author",
  revoked_author: "revoked author",
  bad_signature: "bad signature",
  cannot_decrypt: "cannot decrypt",
  invalid_payload: "invalid payload",
  unknown_kind: "unknown kind",
  not_permitted: "not permitted",
  replay: "replay",
  stale_epoch: "stale epoch",
  history_rewritten: "history rewritten",
};

const WARNING_LABELS: Record<WarningReason, string> = {
  clock_drift: "clock drift",
  waiting_for_keys: "waiting for keys",
};

export function failureLabel(reason: string): string {
  return FAILURE_LABELS[reason as FailureReason] ?? reason;
}

export function warningLabel(reason: string): string {
  return WARNING_LABELS[reason as WarningReason] ?? reason;
}

export function describeVerdict(verdict: Verdict): string | null {
  if (verdict.failures.length > 0) {
    return `Check failed: ${verdict.failures.map((reason) => failureLabel(reason)).join(", ")}.`;
  }
  if (verdict.warnings.length > 0) {
    return `Warning: ${verdict.warnings.map((reason) => warningLabel(reason)).join(", ")}.`;
  }
  return null;
}

export type IntegrityFinding =
  | { kind: "event"; channel: string; seq: string; reason: FailureReason; detail?: string }
  | { kind: "roster"; identity: string; reason: string };

/** Every integrity failure, including ones the fold refused to apply. */
export function listIntegrityFindings(report: IntegrityReport): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const [channel, integrity] of Object.entries(report.channels)) {
    if (!integrity) continue;
    for (const failure of integrity.failures) {
      findings.push({
        kind: "event",
        channel,
        seq: failure.seq.toString(),
        reason: failure.reason,
        ...(failure.detail ? { detail: failure.detail } : {}),
      });
    }
  }
  for (const failure of report.rosterFailures) {
    findings.push({ kind: "roster", identity: failure.identity, reason: failure.reason });
  }
  return findings;
}

export function isExposedStatus(status: string): boolean {
  return EXPOSED.has(status);
}

export function exposedScope<T extends { latest: { status: string } }>(items: readonly T[]): T[] {
  return items.filter((item) => isExposedStatus(item.latest.status));
}

export function groupScope<T extends { latest: { status: string } }>(
  items: readonly T[],
): { status: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const list = buckets.get(item.latest.status) ?? [];
    list.push(item);
    buckets.set(item.latest.status, list);
  }
  const seen = new Set<string>();
  const groups: { status: string; items: T[] }[] = [];
  for (const status of SCOPE_GROUP_ORDER) {
    const grouped = buckets.get(status);
    if (!grouped || grouped.length === 0) continue;
    seen.add(status);
    groups.push({ status, items: grouped });
  }
  for (const [status, grouped] of buckets) {
    if (seen.has(status)) continue;
    groups.push({ status, items: grouped });
  }
  return groups;
}

export function taskCounts(tasks: readonly { latest: { status: string } }[]): {
  open: number;
  inProgress: number;
  blocked: number;
  done: number;
} {
  let open = 0;
  let inProgress = 0;
  let blocked = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.latest.status === "open") open += 1;
    else if (task.latest.status === "in_progress") inProgress += 1;
    else if (task.latest.status === "blocked") blocked += 1;
    else if (task.latest.status === "done") done += 1;
  }
  return { open, inProgress, blocked, done };
}

export function mostUrgentDeadline<T extends { dueAt: string | null }>(deadlines: readonly T[]): T | null {
  const scheduled = deadlines.filter((deadline): deadline is T & { dueAt: string } => {
    if (!deadline.dueAt) return false;
    return !Number.isNaN(Date.parse(deadline.dueAt));
  });
  scheduled.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return scheduled[0] ?? null;
}

/**
 * Recent chat, plus any older message that failed a check.
 * A display limit must not hide a suspicious event.
 */
export function selectMessages(messages: readonly ChannelMessage[], limit?: number): ChannelMessage[] {
  if (!limit || messages.length <= limit) return [...messages];
  const recent = messages.slice(-limit);
  const shown = new Set(recent.map((message) => message.messageId));
  const flagged = messages.filter(
    (message) => !shown.has(message.messageId) && (!message.verdict.ok || message.verdict.warnings.length > 0),
  );
  return [...flagged, ...recent].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
}

export function formatSince(ms: number): string {
  if (ms < 0) return "Detection time is ahead of this browser";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days}d ${hours}h since detection`;
  if (hours > 0) return `${hours}h ${rest}m since detection`;
  return `${rest}m since detection`;
}

export function formatLead(ms: number): string {
  const overdue = ms < 0;
  const minutes = Math.floor(Math.abs(ms) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const body = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
  return overdue ? `${body} overdue` : `${body} left`;
}

export function memberName(
  members: readonly { identity: string; displayName: string }[],
  identity: string | undefined,
): string {
  if (!identity) return "Unassigned";
  return members.find((member) => member.identity === identity)?.displayName ?? "Unknown member";
}
