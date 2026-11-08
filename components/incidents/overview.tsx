"use client";

import Link from "next/link";
import { Activity, Ban, Calendar, ClipboardList, Crosshair, Hash, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CHANNEL_LABELS } from "@/components/incidents/labels";
import { MessageComposer } from "@/components/incidents/message-composer";
import { authorizedChatChannels, canCompose, isChatChannel } from "@/components/incidents/room-controls";
import { incidentSectionHref } from "@/components/incidents/sections";
import { SafeText } from "@/components/incidents/safe-text";
import { StatusForm } from "@/components/incidents/status-form";
import { exposedScope, failureLabel, formatLead, listIntegrityFindings, taskCounts } from "@/components/incidents/situation";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { isMockIncidentClient } from "@/lib/client";
import type { ChannelMessage, IncidentState } from "@/lib/client/types";
import { computeDeadlines, nextCountdown } from "@/lib/legal";
import type { ClockStatus } from "@/lib/legal";
import { formatTimestamp } from "@/lib/time";

const linkClass =
  "shrink-0 text-sm text-signal hover:text-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

const panelClass = "min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5";

const CHANNEL_BLURB = {
  command: "Coordination for everyone in the room.",
  privileged: "Privileged communication. Attorney-client privileged and confidential.",
  technical: "Forensics and containment.",
} as const;

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-4 py-4">
      <dt className="flex items-center gap-2 text-[10px] font-medium tracking-[0.14em] text-muted">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className={`mt-3 break-words text-3xl font-medium tracking-tight ${tone ?? "text-foreground"}`}>{value}</dd>
      <dd className="mt-1 break-words text-xs leading-5 text-muted">{hint}</dd>
    </div>
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
        id: `timeline-${entry.entry.entryId}`,
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

function RecentActivity({ incidentId }: { incidentId: string }) {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const items = activityItems(state, mock);

  return (
    <section className={panelClass} aria-labelledby="activity-heading">
      <div className="flex items-start justify-between gap-3">
        <h2 id="activity-heading" className="text-base font-semibold tracking-tight">
          Recent Activity
        </h2>
        <Link href={incidentSectionHref(incidentId, "timeline")} className={linkClass}>
          View timeline <span aria-hidden="true">→</span>
        </Link>
      </div>
      <p className="mt-1 text-sm leading-6 text-muted">
        Key events and updates for this incident. #record is the structured event log.
      </p>
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
                  <time className="shrink-0 text-xs text-muted">{formatTimestamp(item.at)}</time>
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

function ChannelPreview() {
  const state = useIncident();
  const channels = authorizedChatChannels(state.me?.role, state.me?.state, state.channels);
  const compose =
    channels.find((channel) => channel.kind === "command" && canCompose(state.me?.role, state.me?.state, channel.kind)) ??
    channels.find((channel) => canCompose(state.me?.role, state.me?.state, channel.kind));

  if (channels.length === 0) {
    return <p className="mt-4 text-sm text-muted">No chat channel is open for this role.</p>;
  }

  return (
    <div>
      <ul className="mt-4 space-y-4">
        {channels.map((channel) => {
          const live = channel.messages.length > 0 && channel.messages.every((message) => message.verdict.ok);
          return (
            <li key={channel.kind} className="flex min-w-0 items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-muted">
                <Hash aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{CHANNEL_LABELS[channel.kind]}</p>
                <p className="text-xs leading-5 text-muted">{CHANNEL_BLURB[channel.kind]}</p>
                {channel.waitingForKeys ? <p className="mt-1 text-xs text-muted">Waiting for channel keys.</p> : null}
              </div>
              <span
                aria-hidden="true"
                className={`mt-1.5 size-2 shrink-0 rounded-full ${live ? "bg-signal" : "bg-muted/50"}`}
              />
            </li>
          );
        })}
      </ul>
      {compose ? <MessageComposer channel={compose.kind} compact /> : null}
    </div>
  );
}

export function IncidentOverview() {
  const state = useIncident();
  const now = useBrowserNow();
  const incident = state.incident;
  if (!incident) return null;

  const exposed = exposedScope(state.scope);
  const counts = taskCounts(state.tasks);
  const deadlines = now === null ? null : computeDeadlines(state, new Date(now));
  const urgent = deadlines ? nextCountdown(deadlines) : null;
  const urgentLead = urgent?.dueAt && now !== null ? formatLead(urgent.dueAt.getTime() - now) : null;
  const urgentTone = urgentStatusTone(urgent?.clockStatus);

  return (
    <div className="min-w-0">
      <h2 className="sr-only">Overview</h2>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat icon={Layers} label="AFFECTED" value={String(state.scope.length)} hint="Systems on the record" />
        <Stat
          icon={Crosshair}
          label="BLAST RADIUS"
          value={String(exposed.length)}
          hint="Still suspected, encrypted, or exfiltrated"
          tone={exposed.length > 0 ? "text-signal" : undefined}
        />
        <Stat icon={ClipboardList} label="OPEN TASKS" value={String(counts.open)} hint="Tasks not started" />
        <Stat icon={Activity} label="IN PROGRESS" value={String(counts.inProgress)} hint="Tasks underway" />
        <Stat
          icon={Ban}
          label="BLOCKED"
          value={String(counts.blocked)}
          hint="Tasks that cannot move"
          tone={counts.blocked > 0 ? "text-alert" : undefined}
        />
        <Stat
          icon={Calendar}
          label="NEXT DEADLINE"
          value={urgent ? urgentLead ?? "Scheduled" : "None"}
          hint={urgent ? urgent.rule.citation : "No clock has a due time"}
          tone={urgentTone}
        />
      </dl>

      <div className="mt-3 grid items-start gap-3 lg:grid-cols-3">
        <section className={panelClass} aria-labelledby="situation-heading">
          <h2 id="situation-heading" className="text-base font-semibold tracking-tight">
            Situation Update
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">Update the incident status for all participants.</p>
          <div className="mt-4">
            <StatusForm />
          </div>
        </section>

        <RecentActivity incidentId={incident.id} />

        <section className={panelClass} aria-labelledby="channels-heading">
          <div className="flex items-start justify-between gap-3">
            <h2 id="channels-heading" className="text-base font-semibold tracking-tight">
              Secure Channels
            </h2>
            <Link href={incidentSectionHref(incident.id, "channels")} className={linkClass}>
              All channels <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted">Only channels open for your role are shown.</p>
          <ChannelPreview />
        </section>
      </div>
    </div>
  );
}

function urgentStatusTone(status: ClockStatus | undefined): string | undefined {
  if (status === "elapsed") return "text-alert";
  if (status === "due_soon") return "text-signal";
  return undefined;
}
