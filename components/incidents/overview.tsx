"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { attentionFor } from "@/components/incidents/attention";
import { CHANNEL_LABELS, phaseLabel } from "@/components/incidents/labels";
import { ReachableStrip } from "@/components/incidents/paging-status";
import { isChatChannel } from "@/components/incidents/room-controls";
import { canAuthorRecord } from "@/components/incidents/record-actions";
import { incidentSectionHref } from "@/components/incidents/sections";
import { SafeText } from "@/components/incidents/safe-text";
import { StatusForm } from "@/components/incidents/status-form";
import { exposedScope, failureLabel, formatLead, listIntegrityFindings, taskCounts } from "@/components/incidents/situation";
import { secondaryButtonClass } from "@/components/incidents/form-ui";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { isMockIncidentClient } from "@/lib/client";
import type { ChannelMessage, IncidentState } from "@/lib/client/types";
import { computeDeadlines, nextCountdown } from "@/lib/legal";
import { LocalTime } from "@/components/local-time";

const linkClass =
  "shrink-0 text-sm text-signal hover:text-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

const panelClass = "min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5";

const RECENT_LIMIT = 4;

function Stat({ label, value, hint, tone, href }: { label: string; value: string; hint: string; tone?: string; href: string }) {
  return (
    <Link
      href={href}
      className="block min-w-0 rounded-xl border border-line bg-panel px-4 py-4 transition-colors hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <span className="block text-[10px] font-medium tracking-[0.14em] text-muted">{label}</span>
      <span className={`mt-2 block break-words text-3xl font-medium tracking-tight ${tone ?? "text-foreground"}`}>{value}</span>
      <span className="mt-1 block break-words text-xs leading-5 text-muted">{hint}</span>
    </Link>
  );
}

type ActivityTone = "good" | "neutral" | "alert";

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  meta?: string;
  at: Date;
  tone: ActivityTone;
};

function latestMessage(state: IncidentState): { kind: "command" | "privileged" | "technical"; message: ChannelMessage } | null {
  let found: { kind: "command" | "privileged" | "technical"; message: ChannelMessage } | null = null;
  for (const channel of state.channels) {
    if (!isChatChannel(channel.kind)) continue;
    for (const message of channel.messages) {
      if (!found || message.sentAt.getTime() >= found.message.sentAt.getTime()) {
        found = { kind: channel.kind, message };
      }
    }
  }
  return found;
}

function activityItems(state: IncidentState, mock: boolean): ActivityItem[] {
  const incident = state.incident;
  if (!incident) return [];
  const items: ActivityItem[] = [];
  const message = latestMessage(state);
  if (message) {
    const author = message.message.author?.displayName ?? "unknown";
    const failed = !message.message.verdict.ok;
    items.push({
      id: `message-${message.message.messageId}`,
      title: failed ? "Secure channel check failed" : "Secure channel message",
      detail: message.message.text,
      meta: `Message in ${CHANNEL_LABELS[message.kind]} by ${author}`,
      at: message.message.sentAt,
      tone: failed ? "alert" : "good",
    });
  } else {
    const entry = state.timeline[state.timeline.length - 1];
    if (entry) {
      items.push({
        id: `timeline-${entry.entry.entryId}-${entry.seq.toString()}`,
        title: entry.verdict.ok ? "Timeline entry" : "Timeline check failed",
        detail: entry.entry.text,
        at: entry.sentAt ?? entry.at,
        tone: entry.verdict.ok ? "good" : "alert",
      });
    }
  }

  if (state.integrity.ok) {
    items.push({
      id: "integrity",
      title: "Integrity check passed",
      detail: mock
        ? "Demo sequence check passed. Signatures are not verified."
        : "Signatures and the hash chain checked.",
      at: state.integrity.checkedAt,
      tone: "good",
    });
  } else {
    const finding = listIntegrityFindings(state.integrity)[0];
    const detail =
      finding?.kind === "event"
        ? `Integrity failure on #${finding.channel}. ${failureLabel(finding.reason)}.`
        : finding?.kind === "roster"
          ? `Roster check failed. ${finding.reason}.`
          : "Integrity check failed.";
    items.push({
      id: "integrity",
      title: "Integrity check failed",
      detail,
      at: state.integrity.checkedAt,
      tone: "alert",
    });
  }

  const opener = incident.commander.displayName.trim();
  const severity = state.status?.severity ?? "Open";
  items.push({
    id: "opened",
    title: "Incident opened",
    detail: opener ? `${severity} incident opened by ${opener}.` : `${severity} incident opened.`,
    at: incident.createdAt,
    tone: "neutral",
  });

  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function dotClass(tone: ActivityTone): string {
  if (tone === "alert") return "bg-alert";
  if (tone === "good") return "bg-signal";
  return "border border-muted bg-background";
}

function NeedsAttention({ incidentId }: { incidentId: string }) {
  const state = useIncident();
  const now = useBrowserNow();
  const { items } = attentionFor(state, now);

  return (
    <section className={panelClass} aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="text-base font-semibold tracking-tight">
        Needs attention
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted">
          <CircleCheck aria-hidden="true" className="size-4 text-verified" />
          Nothing needs you right now.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={incidentSectionHref(incidentId, item.slug)}
                className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-start gap-3 py-2.5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2.5 rounded-full ${item.tone === "alert" ? "bg-alert" : "bg-signal"}`}
                />
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium text-foreground">{item.title}</span>
                  <span className="block break-words text-sm text-muted">
                    <SafeText text={item.detail} />
                  </span>
                </span>
                <span aria-hidden="true" className="text-sm text-muted">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LatestUpdate() {
  const state = useIncident();
  const [editing, setEditing] = useState(false);
  const canSet = canAuthorRecord(state.me?.role, state.me?.state, "status.set");
  const status = state.status;

  return (
    <section className={panelClass} aria-labelledby="situation-heading">
      <div className="flex items-start justify-between gap-3">
        <h2 id="situation-heading" className="text-base font-semibold tracking-tight">
          Latest update
        </h2>
        {canSet && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className={`${secondaryButtonClass} min-h-9 px-3 py-1`}>
            Change status
          </button>
        ) : null}
      </div>
      {editing && canSet ? (
        <div className="mt-4">
          <StatusForm onSaved={() => setEditing(false)} />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="mt-3 text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Cancel
          </button>
        </div>
      ) : status ? (
        <>
          <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-foreground">
            {status.summary ? <SafeText text={status.summary} /> : "No summary written yet."}
          </p>
          <p className="mt-3 text-xs text-muted">
            {status.severity} · {phaseLabel(status.phase)} · by {status.by?.displayName || "unknown"} ·{" "}
            <LocalTime value={status.at} />
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {canSet ? "No status yet. Set severity and phase so everyone starts from the same picture." : "The commander has not set a status yet."}
        </p>
      )}
    </section>
  );
}

function RecentActivity({ incidentId }: { incidentId: string }) {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const items = activityItems(state, mock).slice(0, RECENT_LIMIT);

  return (
    <section className={panelClass} aria-labelledby="activity-heading">
      <div className="flex items-start justify-between gap-3">
        <h2 id="activity-heading" className="text-base font-semibold tracking-tight">
          Recent activity
        </h2>
        <Link href={incidentSectionHref(incidentId, "timeline")} className={linkClass}>
          Timeline <span aria-hidden="true">→</span>
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No activity yet.</p>
      ) : (
        <ol className="mt-4">
          {items.map((item, index) => (
            <li key={item.id} className="relative grid grid-cols-[0.75rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
              {index < items.length - 1 ? (
                <span aria-hidden="true" className="absolute bottom-0 left-[0.3rem] top-3 w-px bg-line" />
              ) : null}
              <span aria-hidden="true" className={`relative z-10 mt-1.5 size-2.5 rounded-full ${dotClass(item.tone)}`} />
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <time
                    className="shrink-0 text-xs text-muted"
                    dateTime={Number.isNaN(item.at.getTime()) ? undefined : item.at.toISOString()}
                  >
                    <LocalTime value={item.at} />
                  </time>
                </div>
                <p className="mt-0.5 line-clamp-2 break-words text-sm leading-6 text-muted">
                  <SafeText text={item.detail} />
                </p>
                {item.meta ? <p className="mt-0.5 break-words text-xs text-muted">{item.meta}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function IncidentOverview() {
  const state = useIncident();
  const now = useBrowserNow();
  const incident = state.incident;
  if (!incident) return null;

  const exposed = exposedScope(state.scope);
  const counts = taskCounts(state.tasks);
  const active = counts.open + counts.inProgress;
  const deadlines = now === null ? null : computeDeadlines(state, new Date(now));
  const urgent = deadlines ? nextCountdown(deadlines) : null;
  const urgentLead = urgent?.dueAt && now !== null ? formatLead(urgent.dueAt.getTime() - now) : null;
  const inRoom = state.members.filter((member) => member.state === "active").length;
  const id = incident.id;

  return (
    <div className="grid min-w-0 gap-3">
      <h2 className="sr-only">Overview</h2>
      <NeedsAttention incidentId={id} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          href={incidentSectionHref(id, "systems")}
          label="AFFECTED SYSTEMS"
          value={String(state.scope.length)}
          hint={exposed.length > 0 ? `${exposed.length} still suspected, encrypted, or exfiltrated` : "None still exposed"}
          tone={exposed.length > 0 ? "text-signal" : undefined}
        />
        <Stat
          href={incidentSectionHref(id, "tasks")}
          label="ACTIVE TASKS"
          value={String(active)}
          hint={counts.blocked > 0 ? `${counts.blocked} blocked, ${counts.done} done` : `${counts.done} done`}
          tone={counts.blocked > 0 ? "text-alert" : undefined}
        />
        <Stat
          href={incidentSectionHref(id, "legal")}
          label="NEXT DEADLINE"
          value={urgent ? urgentLead ?? "Scheduled" : "None"}
          hint={urgent ? urgent.rule.citation : "No clock has a due time"}
          tone={urgentStatusTone(urgent?.clockStatus)}
        />
        <Stat
          href={incidentSectionHref(id, "people")}
          label="IN THE ROOM"
          value={String(inRoom)}
          hint={inRoom === 1 ? "Active member" : "Active members"}
        />
      </div>

      <ReachableStrip />

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <LatestUpdate />
        <RecentActivity incidentId={id} />
      </div>
    </div>
  );
}

function urgentStatusTone(status: string | undefined): string | undefined {
  if (status === "elapsed") return "text-alert";
  if (status === "due_soon") return "text-signal";
  return undefined;
}
