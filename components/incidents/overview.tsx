"use client";

import Link from "next/link";
import { AccessControls } from "@/components/incidents/access-controls";
import { ChannelsBoard } from "@/components/incidents/channels-board";
import { scopeStatusLabel } from "@/components/incidents/labels";
import { incidentSectionHref } from "@/components/incidents/sections";
import { SafeText } from "@/components/incidents/safe-text";
import { StatusForm } from "@/components/incidents/status-form";
import {
  exposedScope,
  formatLead,
  mostUrgentDeadline,
  taskCounts,
} from "@/components/incidents/situation";
import { TimelineList } from "@/components/incidents/timeline-list";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { projectLegalDeadlines } from "@/lib/legal";
import type { LegalDeadlineStatus } from "@/lib/legal";

const linkClass =
  "text-sm text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 bg-panel px-4 py-3">
      <dt className="font-mono text-[11px] tracking-[0.16em] text-muted">{label}</dt>
      <dd className={`mt-1 break-words text-2xl font-medium tracking-tight ${tone ?? "text-foreground"}`}>{value}</dd>
      <dd className="mt-1 break-words text-xs leading-5 text-muted">{hint}</dd>
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
  const awareness = (state.discovery?.determinedAt ?? incident.createdAt).toISOString();
  const deadlines =
    now === null
      ? null
      : projectLegalDeadlines({
          incidentId: incident.id,
          awarenessAt: awareness,
          now: new Date(now),
          materialityDeterminedAt: state.materiality?.determinedAt.toISOString() ?? null,
        });
  const urgent = deadlines ? mostUrgentDeadline(deadlines) : null;
  const urgentLead = urgent?.dueAt && now !== null ? formatLead(Date.parse(urgent.dueAt) - now) : null;
  const urgentTone = urgentStatusTone(urgent?.status);
  const recent = [...state.timeline].reverse().slice(0, 5);

  return (
    <div className="min-w-0">
      <h2 className="sr-only">Overview</h2>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
        <Stat label="AFFECTED" value={String(state.scope.length)} hint="Systems on the record" />
        <Stat
          label="BLAST RADIUS"
          value={String(exposed.length)}
          hint="Still suspected, encrypted, or exfiltrated"
          tone={exposed.length > 0 ? "text-signal" : undefined}
        />
        <Stat label="OPEN" value={String(counts.open)} hint="Tasks not started" />
        <Stat label="IN PROGRESS" value={String(counts.inProgress)} hint="Tasks underway" />
        <Stat
          label="BLOCKED"
          value={String(counts.blocked)}
          hint="Tasks that cannot move"
          tone={counts.blocked > 0 ? "text-alert" : undefined}
        />
        <Stat
          label="NEXT DEADLINE"
          value={urgent ? urgentLead ?? "Scheduled" : "None"}
          hint={urgent ? urgent.citation : "No clock has a due time"}
          tone={urgentTone}
        />
      </dl>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-3">
        <section className="min-w-0" aria-labelledby="situation-heading">
          <h2 id="situation-heading" className="text-xl font-medium tracking-tight">
            Situation
          </h2>
          <div className="mt-4">
            <StatusForm />
          </div>
          <div className="mt-8">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium">Blast radius</h3>
              <Link href={incidentSectionHref(incident.id, "systems")} className={linkClass}>
                Affected systems
              </Link>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">
              {exposed.length} still exposed of {state.scope.length} affected systems.
            </p>
            {exposed.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No system is currently suspected, encrypted, or exfiltrated.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {exposed.map((item) => (
                  <li key={item.itemId} className="flex min-w-0 items-baseline justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0 break-words text-foreground">
                      <SafeText text={item.latest.system} />
                    </span>
                    <span className="shrink-0 text-muted">{scopeStatusLabel(item.latest.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="min-w-0" aria-labelledby="activity-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="activity-heading" className="text-xl font-medium tracking-tight">
              Recent activity
            </h2>
            <Link href={incidentSectionHref(incident.id, "timeline")} className={linkClass}>
              Timeline
            </Link>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">
            #record is the structured event log. It is not a chat channel.
          </p>
          <div className="mt-4">
            <TimelineList items={recent} detailed={false} />
          </div>
        </section>

        <section className="min-w-0" aria-labelledby="channels-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="channels-heading" className="text-xl font-medium tracking-tight">
              Secure channels
            </h2>
            <Link href={incidentSectionHref(incident.id, "channels")} className={linkClass}>
              All channels
            </Link>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">Only channels open for your role are shown.</p>
          <div className="mt-4">
            <ChannelsBoard limit={4} />
          </div>
        </section>
      </div>

      <div className="mt-10">
        <AccessControls />
      </div>
    </div>
  );
}

function urgentStatusTone(status: LegalDeadlineStatus | undefined): string | undefined {
  if (status === "elapsed") return "text-alert";
  if (status === "due") return "text-signal";
  return undefined;
}
