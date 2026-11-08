// Printable incident report. Reads IncidentState and computeDeadlines.
// Privileged chat is copied only when counsel opts in and this client already
// has that channel. Safety codes, invite material, and raw keys are never copied.

import type {
  ChannelIntegrity,
  ChannelView,
  Evidence,
  IncidentState,
  MemberView,
  ScopeItem,
  Task,
  TimelineItem,
} from "@/lib/client/types";
import {
  applicabilityLabel,
  clockStatusLabel,
  compareDeadlines,
  HAVEN_LEGAL_DISCLAIMER,
  showsConfirmedCountdown,
  triggerLabel,
} from "@/lib/legal/display";
import { formatLegalInstant } from "@/lib/legal/calendar";
import { COUNSEL_REVIEW_WARNING, computeDeadlines, nextCountdown, type ComputedDeadline } from "@/lib/legal";
import { localTimeZone } from "@/lib/time";
import { CHANNELS, canRead } from "@/spacetimedb/src/shared/policy";
import { incidentAccess } from "@/lib/report/access";
import { formatReportStamp } from "@/lib/report/format";
import { boardEntries, entryOwners } from "@/components/incidents/board";

export const PRIVILEGED_WATERMARK = "PRIVILEGED / CONFIDENTIAL";

export interface ReportOptions {
  now: Date | null;
  includePrivileged: boolean;
  demo: boolean;
  buildSha: string | null;
}

export interface ReportDetermination {
  label: string;
  recorded: boolean;
  at: string;
  by: string;
  basis: string;
}

export interface ReportTimelineEntry {
  id: string;
  /** Epoch milliseconds of occurredAt, for ordering. 0 when the instant is unusable. */
  at: number;
  occurredAt: string;
  phase: string;
  csf: string;
  text: string;
  author: string;
  /** Role label of the signing member, from the verified roster. Null when the author is unknown. */
  authorRole: string | null;
  /** True when the signing member is the commander. Only the commander's "Decision: " lines are decisions. */
  byCommander: boolean;
  /**
   * Board standing, by the status board's own rules: "decision" is a commander decision that no later
   * commander entry replaced; "proposed" is a "Decision: " line from anyone else. Null for other entries.
   */
  board: "decision" | "proposed" | null;
  signedAt: string | null;
  serverAt: string;
  amendment: string | null;
  verdict: string | null;
}

export interface ReportTimelineGroup {
  phase: string;
  entries: ReportTimelineEntry[];
}

export interface ReportSystem {
  id: string;
  name: string;
  status: string;
  asset: string;
  data: string;
  records: string;
  residents: string;
  euResidents: string | null;
  notes: string | null;
}

export interface ReportTask {
  id: string;
  title: string;
  status: string;
  owner: string;
  due: string;
}

export interface ReportEvidence {
  id: string;
  label: string;
  sha256: string;
  custodian: string;
  location: string;
  recordedAt: string;
}

export interface ReportDeadline {
  id: string;
  name: string;
  jurisdiction: string;
  applicability: string;
  trigger: string;
  due: string;
  countdown: string;
  status: string;
  citation: string;
  sourceUrl: string | null;
  recorded: string | null;
  explanation: string;
  urgent: boolean;
}

export interface ReportMember {
  name: string;
  role: string;
  state: string;
  fingerprint: string;
  joinedAt: string;
  admittedAt: string;
  revokedAt: string | null;
}

export interface ReportChannelAttestation {
  channel: string;
  result: string;
  eventsChecked: number;
  head: string;
  pinned: string;
  checkpoint: string;
  failures: string[];
}

export interface ReportIntegrity {
  summary: string;
  checkedAt: string;
  commanderFingerprint: string;
  build: string;
  rosterFailures: string[];
  channels: ReportChannelAttestation[];
}

export interface ReportMessage {
  author: string;
  at: string;
  text: string;
  verdict: string | null;
}

export interface ReportPrivileged {
  offered: boolean;
  included: boolean;
  watermark: string | null;
  note: string;
  messages: ReportMessage[];
}

export interface IncidentReport {
  title: string;
  incidentId: string;
  exportedAt: string | null;
  connectionNote: string | null;
  severity: string;
  phase: string;
  summary: string;
  discovery: ReportDetermination;
  materiality: ReportDetermination;
  timeline: ReportTimelineGroup[];
  timelineEmpty: string | null;
  systems: ReportSystem[];
  systemsEmpty: string | null;
  tasks: ReportTask[];
  tasksEmpty: string | null;
  evidence: ReportEvidence[];
  evidenceEmpty: string | null;
  deadlines: ReportDeadline[] | null;
  deadlinesEmpty: string | null;
  disclaimer: string;
  counselWarning: string;
  roster: ReportMember[];
  rosterEmpty: string | null;
  integrity: ReportIntegrity;
  privileged: ReportPrivileged;
  demoNote: string | null;
}

const PHASES = [
  "preparation",
  "detection_analysis",
  "containment",
  "eradication",
  "recovery",
  "post_incident",
] as const;

const PHASE_LABELS: Record<string, string> = {
  preparation: "Preparation",
  detection_analysis: "Detection and analysis",
  containment: "Containment",
  eradication: "Eradication",
  recovery: "Recovery",
  post_incident: "Post-incident",
};

const ROLE_LABELS: Record<string, string> = {
  commander: "Commander",
  counsel: "Counsel",
  technical: "Technical",
  executive: "Executive",
};

const ROLE_ORDER = ["commander", "counsel", "technical", "executive"];

const SCOPE_LABELS: Record<string, string> = {
  unknown: "Unknown",
  suspected: "Suspected",
  encrypted: "Encrypted",
  exfiltrated: "Exfiltrated",
  contained: "Contained",
  eradicated: "Eradicated",
  restored: "Restored",
};

const ASSET_LABELS: Record<string, string> = {
  endpoint: "Endpoint",
  server: "Server",
  database: "Database",
  saas: "SaaS",
  backup: "Backup",
  network: "Network",
  other: "Other",
};

const DATA_LABELS: Record<string, string> = {
  ssn: "SSN",
  drivers_license: "Driver license",
  financial_account: "Financial account",
  payment_card: "Payment card",
  phi: "PHI",
  credentials: "Credentials",
  biometric: "Biometric",
  employee_hr: "Employee HR",
  privileged_legal: "Privileged legal",
  trade_secret: "Trade secret",
  other_pii: "Other personal data",
};

const TASK_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

const MEMBER_LABELS: Record<string, string> = {
  pending: "Pending",
  active: "Active",
  revoked: "Revoked",
};

const RECORDED_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  not_applicable: "Marked not applicable",
};

const FAILURE_LABELS: Record<string, string> = {
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

export function buildIncidentReport(state: IncidentState, options: ReportOptions): IncidentReport | null {
  if (incidentAccess(state).phase !== "ready" || !state.incident || !state.me) return null;
  const incident = state.incident;
  const clock = asDate(options.now);
  const deadlines = clock ? computeDeadlines(state, clock) : null;
  const urgentId = deadlines ? nextCountdown(deadlines)?.rule.id ?? null : null;

  return {
    title: incident.title.trim() || "Untitled incident",
    incidentId: incident.id,
    exportedAt: clock ? formatReportStamp(clock) : null,
    connectionNote: connectionNote(state),
    severity: state.status?.severity ?? "Not recorded",
    phase: state.status ? label(PHASE_LABELS, state.status.phase) : "Not recorded",
    summary: state.status
      ? state.status.summary.trim() || "No summary has been recorded."
      : "No status has been recorded.",
    discovery: determination("Discovery", state.discovery),
    materiality: determination("Materiality", state.materiality),
    ...timeline(state.timeline),
    ...systems(state.scope),
    ...tasks(state.tasks, state.members),
    ...evidence(state.evidence),
    deadlines: deadlines ? deadlines.slice().sort(compareDeadlines).map((deadline) => deadlineRow(deadline, state.members, clock, urgentId)) : null,
    deadlinesEmpty: deadlines ? (deadlines.length === 0 ? "No deadline rules are available for this record." : null) : "Notice clocks open with the browser clock.",
    disclaimer: HAVEN_LEGAL_DISCLAIMER,
    counselWarning: COUNSEL_REVIEW_WARNING,
    ...roster(state.members),
    integrity: integrity(state, options),
    privileged: privileged(state, options.includePrivileged),
    demoNote: options.demo ? demoNote(state) : null,
  };
}

function determination(
  labelText: string,
  value: IncidentState["discovery"],
): ReportDetermination {
  if (!value) {
    return { label: labelText, recorded: false, at: "Not recorded", by: "Not recorded", basis: "Not recorded" };
  }
  return {
    label: labelText,
    recorded: true,
    at: stamp(value.determinedAt) ?? "Unusable time",
    by: value.by.displayName.trim() || "Unknown author",
    basis: value.basis.trim() || "No basis recorded",
  };
}

function timeline(items: readonly TimelineItem[]): { timeline: ReportTimelineGroup[]; timelineEmpty: string | null } {
  if (items.length === 0) return { timeline: [], timelineEmpty: "No timeline entries are on the record." };
  // The first entry by seq owns an id; sets hold items, so a reused id never borrows another entry's standing.
  const byId = entryOwners(items);
  const board = boardEntries(items);
  const decided = new Set(board.decisions.map((entry) => entry.item));
  const proposed = new Set(board.proposed.map((entry) => entry.item));
  const groups = new Map<string, ReportTimelineEntry[]>();
  for (const item of items) {
    const phase = item.entry.phase;
    const list = groups.get(phase) ?? [];
    const owner = item.entry.amends ? byId.get(item.entry.amends) : undefined;
    const target = owner && owner !== item && owner.seq < item.seq ? owner : undefined;
    list.push({
      // Entry ids are author-chosen and can repeat; the server seq makes the key unique.
      id: `${item.entry.entryId}-${item.seq.toString()}`,
      at: epoch(item.entry.occurredAt),
      occurredAt: stamp(item.entry.occurredAt) ?? "Unusable time",
      phase: label(PHASE_LABELS, phase),
      csf: item.entry.csf,
      text: item.entry.text,
      author: item.by?.displayName.trim() || "Unknown author",
      authorRole: item.by ? label(ROLE_LABELS, item.by.role) : null,
      byCommander: item.by?.role === "commander",
      board: decided.has(item) ? "decision" : proposed.has(item) ? "proposed" : null,
      signedAt: stamp(item.sentAt),
      serverAt: stamp(item.at) ?? "Unusable time",
      amendment: item.entry.amends
        ? target
          ? `Amends the entry from ${stamp(target.entry.occurredAt) ?? "an unusable time"}.`
          : "Amends an earlier entry."
        : item.amendedBy.length > 0
          ? "A later entry amends this one."
          : null,
      verdict: verdictLine(item.verdict.ok, item.verdict.failures, item.verdict.warnings),
    });
    groups.set(phase, list);
  }
  const ordered: ReportTimelineGroup[] = [];
  for (const phase of PHASES) {
    const entries = groups.get(phase);
    if (entries && entries.length > 0) ordered.push({ phase: label(PHASE_LABELS, phase), entries });
  }
  for (const [phase, entries] of groups) {
    if ((PHASES as readonly string[]).includes(phase)) continue;
    ordered.push({ phase: label(PHASE_LABELS, phase), entries });
  }
  return { timeline: ordered, timelineEmpty: null };
}

function systems(items: readonly ScopeItem[]): { systems: ReportSystem[]; systemsEmpty: string | null } {
  if (items.length === 0) return { systems: [], systemsEmpty: "No affected systems are on the record." };
  return {
    systems: items.map((item) => ({
      id: item.itemId,
      name: item.latest.system,
      status: label(SCOPE_LABELS, item.latest.status),
      asset: label(ASSET_LABELS, item.latest.assetType),
      data: item.latest.dataTypes.length > 0 ? item.latest.dataTypes.map((type) => label(DATA_LABELS, type)).join(", ") : "No data types recorded",
      records: typeof item.latest.recordCount === "number" ? item.latest.recordCount.toLocaleString("en-US") : "Not recorded",
      residents:
        item.latest.affected.length > 0
          ? item.latest.affected.map((row) => `${row.state} ${row.count.toLocaleString("en-US")}`).join(", ")
          : "No resident list recorded",
      euResidents: typeof item.latest.euResidents === "number" ? item.latest.euResidents.toLocaleString("en-US") : null,
      notes: item.latest.notes.trim() || null,
    })),
    systemsEmpty: null,
  };
}

function tasks(items: readonly Task[], members: readonly MemberView[]): { tasks: ReportTask[]; tasksEmpty: string | null } {
  if (items.length === 0) return { tasks: [], tasksEmpty: "No response tasks are on the record." };
  return {
    tasks: items.map((task) => ({
      id: task.taskId,
      title: task.latest.title,
      status: label(TASK_LABELS, task.latest.status),
      owner: personName(members, task.latest.assignee),
      due: task.latest.dueAt ? formatReportStamp(task.latest.dueAt) ?? "No due time recorded" : "No due time recorded",
    })),
    tasksEmpty: null,
  };
}

function evidence(items: readonly Evidence[]): { evidence: ReportEvidence[]; evidenceEmpty: string | null } {
  if (items.length === 0) return { evidence: [], evidenceEmpty: "No evidence records are on the record." };
  return {
    evidence: items.map((item) => ({
      id: item.body.evidenceId,
      label: item.body.label,
      sha256: item.body.sha256,
      custodian: item.body.custodian.trim() || "No custodian recorded",
      location: item.body.location.trim() || "No location recorded",
      recordedAt: stamp(item.at) ?? "Unusable time",
    })),
    evidenceEmpty: null,
  };
}

function deadlineRow(
  deadline: ComputedDeadline,
  members: readonly MemberView[],
  now: Date | null,
  urgentId: string | null,
): ReportDeadline {
  const confirmed = showsConfirmedCountdown(deadline);
  const recorded = deadline.recorded;
  return {
    id: deadline.rule.id,
    name: deadline.rule.name,
    jurisdiction: deadline.rule.jurisdiction,
    applicability: applicabilityLabel(deadline.applicability),
    trigger: triggerLabel(deadline.rule),
    due: confirmed && deadline.dueAt
      ? formatLegalInstant(deadline.dueAt, localTimeZone())
      : "No confirmed deadline",
    countdown: confirmed && deadline.dueAt && now ? remaining(deadline.dueAt, now) : "No confirmed countdown",
    status: clockStatusLabel(deadline),
    citation: deadline.rule.citation,
    sourceUrl: publicHttpUrl(deadline.rule.sourceUrl),
    recorded: recorded
      ? `${label(RECORDED_LABELS, recorded.status)} · ${recorded.owner ? personName(members, recorded.owner) : "No owner recorded"}${
          recorded.note.trim() ? ` · ${recorded.note.trim()}` : ""
        }. A recorded mark does not change the computed deadline.`
      : null,
    explanation: deadline.explanation,
    urgent: confirmed && deadline.rule.id === urgentId,
  };
}

function roster(members: readonly MemberView[]): { roster: ReportMember[]; rosterEmpty: string | null } {
  if (members.length === 0) return { roster: [], rosterEmpty: "No team roles are on the record." };
  const ordered = members.slice().sort((a, b) => {
    const role = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (role !== 0) return role;
    return a.displayName.localeCompare(b.displayName);
  });
  return {
    roster: ordered.map((member) => ({
      name: member.displayName.trim() || "Unnamed member",
      role: label(ROLE_LABELS, member.role),
      state: label(MEMBER_LABELS, member.state),
      fingerprint: member.fingerprint.trim() || "No fingerprint on this record",
      joinedAt: stamp(member.joinedAt) ?? "Not recorded",
      admittedAt: stamp(member.admittedAt) ?? "Not recorded",
      revokedAt: stamp(member.revokedAt),
    })),
    rosterEmpty: null,
  };
}

function integrity(state: IncidentState, options: ReportOptions): ReportIntegrity {
  const report = state.integrity;
  const checked = asDate(report.checkedAt);
  const channels = CHANNELS.flatMap((kind) => {
    const channel = report.channels[kind];
    return channel ? [attest(kind, channel, options.demo)] : [];
  });
  return {
    summary: integritySummary(report.ok, options.demo, channels.length),
    checkedAt: checked ? formatReportStamp(report.checkedAt) ?? "Verification time is not recorded." : "Verification time is not recorded.",
    commanderFingerprint: state.incident?.commander.fingerprint.trim() || "Commander fingerprint is not on this record.",
    build: options.buildSha ? `Build ${options.buildSha}` : "Build hash is not recorded for this deployment.",
    rosterFailures: report.rosterFailures.map((failure) => `Roster check failed for ${failure.identity}. ${failure.reason}`),
    channels,
  };
}

function demoNote(state: IncidentState): string {
  const verified = CHANNELS.some((kind) => state.integrity.channels[kind]?.latestCheckpoint?.verified === true);
  const base = "Demo data. Chain heads in this copy are placeholders. Signatures are not verified.";
  return verified ? base : `${base} This report does not claim a cryptographic checkpoint.`;
}

function integritySummary(ok: boolean, demo: boolean, channelCount: number): string {
  const scope = channelCount === 0 ? "No channel heads are available to this client." : "Heads below are only for channels this client can read.";
  if (demo) {
    return ok
      ? `Demo sequence check passed. Signatures are not verified. ${scope}`
      : `Demo sequence check found a problem. Signatures are not verified. ${scope}`;
  }
  return ok
    ? `Client verification passed for the channels this role can read. ${scope}`
    : `Client verification failed for at least one channel this role can read. ${scope}`;
}

function attest(kind: string, channel: ChannelIntegrity, demo: boolean): ReportChannelAttestation {
  const head = channel.head;
  let headLine = "No chain head is recorded for this channel.";
  if (head) {
    if (demo && /^0{64}$/.test(head.hashHex)) {
      headLine = `Sequence ${head.seq.toString()}. Head hash ${head.hashHex}. This is a demo placeholder, not a computed chain hash.`;
    } else if (demo) {
      headLine = `Sequence ${head.seq.toString()}. Head hash ${head.hashHex}. Demo mode did not verify this hash.`;
    } else {
      headLine = `Sequence ${head.seq.toString()}. Head hash ${head.hashHex}.`;
    }
  }
  const pinned = demo
    ? "Pinned-head comparison is not a cryptographic check in this demo."
    : channel.pinnedOk
      ? "The head matches the head pinned in this browser."
      : "The head does not match the head pinned in this browser.";
  const failures = channel.failures.map((failure) => {
    const reason = label(FAILURE_LABELS, failure.reason);
    const detail = failure.detail?.trim();
    return detail ? `Seq ${failure.seq.toString()}: ${reason}. ${detail}` : `Seq ${failure.seq.toString()}: ${reason}.`;
  });
  if (channel.waitingForKeys) failures.push("Some events are waiting for keys, so this check is incomplete.");
  return {
    channel: kind.startsWith("#") ? kind : `#${kind}`,
    result: channel.ok ? "Check passed" : "Check failed",
    eventsChecked: channel.eventsChecked,
    head: headLine,
    pinned,
    checkpoint: checkpointLine(channel),
    failures,
  };
}

function checkpointLine(channel: ChannelIntegrity): string {
  const point = channel.latestCheckpoint;
  if (!point || point.verified !== true) {
    if (point && point.verified === false) {
      return "A checkpoint was presented for this channel and did not verify. It is not a cryptographic checkpoint.";
    }
    return "No verified checkpoint is recorded for this channel.";
  }
  const hash = typeof point.hashHex === "string" ? point.hashHex.trim() : "";
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return "A checkpoint was marked verified, but this client has no checkpoint hash to print.";
  }
  return `Verified checkpoint at sequence ${point.seq.toString()}. Hash ${hash}.`;
}

function privileged(state: IncidentState, includeRequested: boolean): ReportPrivileged {
  const counsel = state.me?.state === "active" && state.me.role === "counsel" && canRead("counsel", "privileged");
  const channel = counsel ? state.channels.find((item): item is ChannelView => item.kind === "privileged") : undefined;
  if (includeRequested && channel) {
    const waiting = channel.waitingForKeys
      ? " Some events are still waiting for keys and are not included."
      : "";
    return {
      offered: true,
      included: true,
      watermark: PRIVILEGED_WATERMARK,
      note: `This report includes attorney-client privileged messages from the privileged channel.${waiting}`,
      messages: channel.messages.map((message) => ({
        author: message.author?.displayName.trim() || "Unknown author",
        at: stamp(message.sentAt) ?? "Unusable time",
        text: message.text,
        verdict: verdictLine(message.verdict.ok, message.verdict.failures, message.verdict.warnings),
      })),
    };
  }
  if (includeRequested && counsel && !channel) {
    return {
      offered: false,
      included: false,
      watermark: null,
      note: "Privileged content was not included. This client does not have the privileged channel.",
      messages: [],
    };
  }
  if (includeRequested && !counsel) {
    return {
      offered: false,
      included: false,
      watermark: null,
      note: "Attorney-client privileged messages stay out of this report. Only counsel can include them, and only from a channel this client can read.",
      messages: [],
    };
  }
  return {
    offered: Boolean(channel),
    included: false,
    watermark: null,
    note: "Attorney-client privileged messages are excluded. Counsel can include them when this client can already read that channel.",
    messages: [],
  };
}

function connectionNote(state: IncidentState): string | null {
  if (state.connection === "offline") return "The connection was offline. This copy uses the last update held in this tab.";
  if (state.connection === "error") return cleanNote(state.error);
  return null;
}

function cleanNote(error: string | undefined): string | null {
  const message = error?.trim() ?? "";
  if (!message || message.length > 240 || /[\r\n]/.test(message)) return "The incident client reported a connection error.";
  return message;
}

function remaining(due: Date, now: Date): string {
  const delta = due.getTime() - now.getTime();
  const minutes = Math.floor(Math.abs(delta) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const body = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
  return delta < 0 ? `${body} overdue` : `${body} remaining`;
}

function personName(members: readonly { identity: string; displayName: string }[], identity: string | undefined): string {
  if (!identity) return "Unassigned";
  return members.find((member) => member.identity === identity)?.displayName.trim() || "Unknown member";
}

function verdictLine(ok: boolean, failures: readonly string[], warnings: readonly string[]): string | null {
  if (!ok && failures.length > 0) return `Check failed: ${failures.map((reason) => label(FAILURE_LABELS, reason)).join(", ")}.`;
  if (warnings.length > 0) return `Warning: ${warnings.join(", ")}.`;
  return null;
}

function publicHttpUrl(value: string): string | null {
  if (!value.startsWith("http://") && !value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function asDate(value: Date | null | undefined): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  return null;
}

function stamp(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return asDate(value) ? formatReportStamp(value) : null;
  return formatReportStamp(value);
}

function epoch(value: Date | string | null | undefined): number {
  if (value == null) return 0;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function label(table: Record<string, string>, value: string): string {
  return table[value] ?? value;
}
