// Cover copy for the printable report. Facts come from the built report.
// A page is not a signed timeline entry, so it is never given a signature or a CSF tag.

import type { PageView } from "@/lib/client/types";
import type { IncidentReport, ReportTimelineEntry } from "@/lib/report/build";
import { formatReportStamp, reportClock, reportPill, reportSigned } from "@/lib/report/format";

const ROLE_LABELS: Record<string, string> = {
  commander: "Commander",
  counsel: "Counsel",
  technical: "Technical",
  executive: "Executive",
};

const PLACEHOLDER_SUMMARIES = new Set(["No status has been recorded.", "No summary has been recorded."]);

export interface CoverAction {
  id: string;
  at: number;
  when: string;
  title: string;
  detail: string | null;
  signature: string;
  note: string | null;
  alert: string | null;
}

export interface CoverDecision {
  id: string;
  at: number;
  title: string;
  meta: string;
}

export function incidentStanding(phase: string): "Open" | "Closed" {
  return phase === "Post-incident" ? "Closed" : "Open";
}

export function commanderName(report: IncidentReport, fallback: string | null): string {
  const named = report.roster.find((member) => member.role === "Commander" && member.state === "Active");
  if (named) return named.name;
  const direct = fallback?.trim();
  return direct || "Not recorded";
}

export function integrityLabel(report: IncidentReport): { label: "Checked" | "Failed"; ok: boolean } {
  const failed =
    report.integrity.rosterFailures.length > 0 ||
    report.integrity.channels.some((channel) => channel.result !== "Check passed") ||
    /fail|problem/i.test(report.integrity.summary);
  return failed ? { label: "Failed", ok: false } : { label: "Checked", ok: true };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? "";
  return `${parts[0].charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export function executiveBullets(report: IncidentReport): string[] {
  const bullets: string[] = [];
  if (!PLACEHOLDER_SUMMARIES.has(report.summary)) bullets.push(withPeriod(report.summary));
  const standing = incidentStanding(report.phase) === "Open" ? "open" : "closed";
  let sentence = `Incident is ${standing}`;
  if (report.phase !== "Not recorded") sentence += ` and in the ${report.phase.toLowerCase()} phase`;
  const decision = latestDecision(report);
  if (decision) sentence += `; ${clause(decision)}`;
  bullets.push(withPeriod(sentence));
  return bullets;
}

export function coverActions(report: IncidentReport, pages: readonly PageView[], signer: string): CoverAction[] {
  const entries = report.timeline.flatMap((group) => group.entries);
  const actions = entries.map((entry) => actionFromEntry(entry));
  const seen = new Set(entries.map((entry) => entry.text.trim().toLowerCase()));
  for (const page of pages) {
    const role = ROLE_LABELS[page.role] ?? page.role;
    const title = `Paged ${page.displayName.trim() || "Unnamed member"} (${role})`;
    if (seen.has(title.toLowerCase())) continue;
    const stamp = formatReportStamp(page.updatedAt) ?? "Unusable time";
    actions.push({
      id: `page-${page.pageId}`,
      at: page.updatedAt.getTime(),
      when: reportPill(stamp),
      title,
      detail: null,
      signature: `${signer} requested this page · ${reportSigned(stamp)} · ${pageStanding(page)}`,
      note: null,
      alert: null,
    });
  }
  actions.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return actions;
}

/**
 * Standing commander decisions only, by the status board's rules (built into `entry.board`): a
 * "Decision: " line from anyone else is a proposal, and a decision the commander later replaced is
 * not shown. The role comes from the signing member's roster row, never from a display name.
 */
export function coverDecisions(report: IncidentReport): CoverDecision[] {
  const decisions: CoverDecision[] = [];
  for (const group of report.timeline) {
    for (const entry of group.entries) {
      if (entry.board !== "decision" || !entry.byCommander || !entry.text.startsWith("Decision: ")) continue;
      const title = entry.text.slice("Decision: ".length).trim();
      const role = entry.authorRole;
      const who = role ? `${initials(entry.author)}, ${role}` : initials(entry.author);
      const when = reportClock(entry.signedAt ?? entry.occurredAt);
      decisions.push({ id: entry.id, at: entry.at, title, meta: `${who} · ${when}` });
    }
  }
  decisions.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return decisions;
}

function actionFromEntry(entry: ReportTimelineEntry): CoverAction {
  const decision = entry.board === "decision";
  // Decided by who wrote it, not by standing: a non-commander line stays a proposal even after a
  // later entry replaced it.
  const proposal = !decision && !entry.byCommander && entry.text.startsWith("Decision: ");
  const signed = entry.signedAt ?? entry.occurredAt;
  const server =
    entry.serverAt !== signed && entry.serverAt !== entry.occurredAt ? `Server ${reportClock(entry.serverAt)}` : null;
  // A "Decision: " line from anyone but the commander is a proposal, as on the status board.
  const proposedTitle = `Proposed: ${entry.text.slice("Decision: ".length).trim()}`;
  return {
    id: entry.id,
    at: entry.at,
    when: reportPill(entry.occurredAt),
    title: decision ? entry.phase : proposal ? proposedTitle : entry.text,
    detail: decision ? entry.text : proposal ? `Proposed by ${entry.author}${entry.authorRole ? `, ${entry.authorRole}` : ""}. Not decided by the commander.` : null,
    signature: `${entry.author} signed ${reportSigned(signed)} · ${entry.csf}`,
    note: [entry.amendment, server].filter(Boolean).join(" ") || null,
    alert: entry.verdict,
  };
}

function latestDecision(report: IncidentReport): string | null {
  const decisions = coverDecisions(report);
  const last = decisions[decisions.length - 1];
  return last?.title ?? null;
}

function clause(decision: string): string {
  const trimmed = decision.trim().replace(/[.]+$/, "");
  if (!trimmed) return "a decision has been recorded";
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)} has been decided`;
}

function withPeriod(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function pageStanding(page: PageView): string {
  if (page.joined) return "Joined the room";
  switch (page.status) {
    case "requested":
      return "Requested";
    case "calling":
      return "Calling";
    case "ringing":
      return "Ringing";
    case "acknowledged":
      return page.carrierReported ? "Acknowledged by phone" : "Acknowledged, not yet confirmed by the carrier";
    case "no_answer":
      return "No answer";
    case "busy":
      return "Busy";
    case "failed":
      return "Failed";
  }
}
