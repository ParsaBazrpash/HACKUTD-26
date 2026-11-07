"use client";

import Link from "next/link";
import { HourClock } from "@/components/incidents/hour-clock";
import { FixtureSlot } from "@/components/ui/fixture-slot";
import { IntegrityMark } from "@/components/ui/integrity-mark";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncidentSnapshot } from "@/hooks/use-incident-data";
import { projectLegalDeadlines } from "@/lib/legal";
import { formatTimestamp } from "@/lib/time";
import {
  ASSET_KIND_LABELS,
  CHANNEL_KIND_LABELS,
  INCIDENT_STATUS_LABELS,
  ROLE_LABELS,
  TASK_STATUS_LABELS,
} from "@/types/common";
import type { LegalDeadlineStatus } from "@/types/legal";

function deadlineClass(status: LegalDeadlineStatus): string {
  if (status === "elapsed") return "text-alert";
  if (status === "due") return "text-signal";
  if (status === "upcoming") return "text-verified";
  return "text-muted";
}

const deadlineLabels: Record<LegalDeadlineStatus, string> = {
  upcoming: "Inside the window",
  due: "Inside six hours",
  elapsed: "Window passed",
  unscheduled: "Not scheduled",
};

function NoticeClocks({
  incidentId,
  awarenessAt,
}: {
  incidentId: string;
  awarenessAt: string;
}) {
  const browserNow = useBrowserNow();
  const deadlines =
    browserNow === null
      ? null
      : projectLegalDeadlines({
          incidentId,
          awarenessAt,
          now: new Date(browserNow),
        });

  return (
    <section className="mt-8" aria-labelledby="clocks-heading">
      <h2 id="clocks-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        NOTICE CLOCKS
      </h2>
      {deadlines === null ? (
        <p className="mt-3 text-sm text-muted">Notice clocks open with the browser clock.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {deadlines.map((deadline) => (
            <li key={deadline.id} className="grid gap-2 py-4 sm:grid-cols-[11rem_1fr]">
              <div>
                <p className={`font-mono text-xs ${deadlineClass(deadline.status)}`}>
                  {deadlineLabels[deadline.status]}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {deadline.dueAt ? formatTimestamp(deadline.dueAt) : "No due time"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-legal">{deadline.citation}</p>
                <p className="mt-1 text-sm leading-6 text-muted">{deadline.obligation}</p>
                {deadline.scheduleNote ? (
                  <p className="mt-2 text-sm text-foreground">{deadline.scheduleNote}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function IncidentDetail({ incidentId }: { incidentId: string }) {
  const { snapshot, error, mode } = useIncidentSnapshot(incidentId);

  if (error || mode === "unavailable") {
    return (
      <p role="alert" className="text-sm text-alert">
        {error ?? "The incident client is unavailable."}
      </p>
    );
  }

  if (mode === "spacetimedb") {
    return (
      <p className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
        SpacetimeDB is selected, and the module is not connected. This incident was not requested.
      </p>
    );
  }

  if (snapshot === null) {
    return (
      <div>
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">UNKNOWN SHELL</p>
        <h1 className="mt-3 font-mono text-3xl tracking-tight">{incidentId}</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-muted">
          No shell with that id is loaded on this client.
        </p>
        <Link
          href="/incidents"
          className="mt-6 inline-flex text-sm text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          Back to incidents
        </Link>
      </div>
    );
  }

  const { incident } = snapshot;

  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.18em] text-signal">SEALED SHELL</p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-3xl tracking-tight sm:text-4xl">{incident.id}</h1>
          <p className="mt-2 text-sm text-muted">
            <span className="text-foreground">{INCIDENT_STATUS_LABELS[incident.status]}</span>
            {" · "}
            {formatTimestamp(incident.startedAt)}
          </p>
        </div>
        <Link
          href={`/join?incident=${incident.id}`}
          className="inline-flex items-center justify-center rounded-full border border-line bg-panel px-4 py-2 text-sm font-medium hover:border-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          Join this room
        </Link>
      </div>

      <p className="mt-6 rounded-xl border border-line bg-panel-raised px-4 py-3 text-sm leading-6 text-muted">
        Decryption is not implemented. This screen shows the shell, not the incident narrative.
        Fixture slots are labels. Integrity has not been checked in the browser.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <HourClock startedAt={incident.startedAt} />
        <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-labelledby="members-heading">
          <h2 id="members-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
            MEMBERS
          </h2>
          <ul className="mt-4 space-y-3">
            {snapshot.members.map((member) => (
              <li key={member.id} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  <span className="block">{ROLE_LABELS[member.role]}</span>
                  <span className="font-mono text-[11px] text-muted">{member.id}</span>
                </span>
                <IntegrityMark integrity={member.integrity} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <NoticeClocks incidentId={incident.id} awarenessAt={incident.startedAt} />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line px-5 py-4" aria-labelledby="channels-heading">
          <h2 id="channels-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
            CHANNELS
          </h2>
          <ul className="mt-4 space-y-3">
            {snapshot.channels.map((channel) => (
              <li key={channel.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{CHANNEL_KIND_LABELS[channel.kind]}</span>
                <FixtureSlot />
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-line px-5 py-4" aria-labelledby="events-heading">
          <h2 id="events-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
            EVENTS
          </h2>
          {snapshot.events.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No sealed events on this shell.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {snapshot.events.map((event) => (
                <li key={event.id} className="text-sm">
                  <span className="block text-muted">{formatTimestamp(event.createdAt)}</span>
                  <span className="mt-1 flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px]">{event.authorMemberId}</span>
                    <span className="flex items-center gap-3">
                      <FixtureSlot />
                      <IntegrityMark integrity={event.integrity} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-line px-5 py-4" aria-labelledby="tasks-heading">
          <h2 id="tasks-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
            TASKS
          </h2>
          <ul className="mt-4 space-y-3">
            {snapshot.tasks.map((task) => (
              <li key={task.id} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  <span className="block">{TASK_STATUS_LABELS[task.status]}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {task.assigneeMemberId ?? "Unassigned"}
                    {task.dueAt ? ` · ${formatTimestamp(task.dueAt)}` : ""}
                  </span>
                </span>
                <FixtureSlot />
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-line px-5 py-4" aria-labelledby="assets-heading">
          <h2 id="assets-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
            AFFECTED ASSETS
          </h2>
          <ul className="mt-4 space-y-3">
            {snapshot.assets.map((asset) => (
              <li key={asset.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{ASSET_KIND_LABELS[asset.kind]}</span>
                <span className="flex items-center gap-3">
                  <FixtureSlot />
                  <IntegrityMark integrity={asset.integrity} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
