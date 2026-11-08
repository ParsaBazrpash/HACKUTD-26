"use client";

import { HourClock } from "@/components/incidents/hour-clock";
import { SafeText } from "@/components/incidents/safe-text";
import { memberName, mostUrgentDeadline } from "@/components/incidents/situation";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { describeClockStart, projectLegalDeadlines } from "@/lib/legal";
import type { LegalDeadline, LegalDeadlineStatus } from "@/lib/legal";
import { formatTimestamp } from "@/lib/time";

const statusCopy: Record<LegalDeadlineStatus, string> = {
  upcoming: "Inside the window",
  due: "Inside six hours",
  elapsed: "Window passed",
  unscheduled: "Not scheduled",
};

function tone(status: LegalDeadlineStatus): string {
  if (status === "elapsed") return "text-alert";
  if (status === "due") return "text-signal";
  if (status === "upcoming") return "text-verified";
  return "text-muted";
}

const profileRows = [
  ["publicCompany", "Public company"],
  ["hipaaCoveredEntity", "HIPAA covered entity"],
  ["nydfsRegulated", "NYDFS regulated"],
  ["defenseContractor", "Defense contractor"],
  ["bank", "Bank"],
  ["euDataSubjects", "EU data subjects"],
] as const;

export function LegalBoard() {
  const state = useIncident();
  const now = useBrowserNow();
  const incident = state.incident;
  if (!incident) return null;
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
  const updates = Object.values(state.deadlineUpdates);

  return (
    <div className="grid min-w-0 gap-8">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Legal deadlines</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Planning clocks for demonstration. Counsel decides whether a duty applies. Verify each matter with counsel.
        </p>
      </div>
      <HourClock startedAt={awareness} />
      <section aria-labelledby="profile-heading">
        <h3 id="profile-heading" className="text-sm font-medium">
          Organization profile
        </h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {profileRows.map(([key, label]) => (
            <li key={key} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm">
              <span className="text-muted">{label}</span>
              <span>{state.profile[key] ? "Yes" : "No"}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="discovery-heading">
        <h3 id="discovery-heading" className="text-sm font-medium">
          Recorded determinations
        </h3>
        <div className="mt-3 grid gap-4">
          <Determination
            label="Discovery"
            at={state.discovery?.determinedAt}
            by={state.discovery?.by.displayName}
            basis={state.discovery?.basis}
            empty="No discovery time is on the record. Clocks below use when the incident was opened."
          />
          <Determination
            label="Materiality"
            at={state.materiality?.determinedAt}
            by={state.materiality?.by.displayName}
            basis={state.materiality?.basis}
            empty="No materiality determination is on the record."
          />
        </div>
      </section>
      <section aria-labelledby="clocks-heading">
        <h3 id="clocks-heading" className="text-sm font-medium">
          Notice clocks
        </h3>
        {deadlines === null ? (
          <p className="mt-3 text-sm text-muted">Notice clocks open with the browser clock.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {deadlines.map((deadline) => (
              <DeadlineRow key={deadline.id} deadline={deadline} urgent={deadline.id === urgent?.id} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="updates-heading">
        <h3 id="updates-heading" className="text-sm font-medium">
          Recorded deadline updates
        </h3>
        {updates.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No deadline update is on the record.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {updates.map((update) => (
              <li key={update.body.ruleId} className="min-w-0 py-4">
                <p className="font-mono text-xs text-muted">{update.body.ruleId}</p>
                <p className="mt-1 text-sm text-foreground">
                  {update.body.status} · {memberName(state.members, update.body.owner)}
                </p>
                {update.body.note ? (
                  <p className="mt-2 break-words text-sm leading-6 text-muted">
                    <SafeText text={update.body.note} />
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Determination({
  label,
  at,
  by,
  basis,
  empty,
}: {
  label: string;
  at?: Date;
  by?: string;
  basis?: string;
  empty: string;
}) {
  if (!at) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div>
      <p className="text-sm text-foreground">
        {label} · {formatTimestamp(at)}
        {by ? ` · ${by}` : ""}
      </p>
      {basis ? (
        <p className="mt-2 break-words text-sm leading-6 text-muted">
          <SafeText text={basis} />
        </p>
      ) : null}
    </div>
  );
}

function DeadlineRow({ deadline, urgent }: { deadline: LegalDeadline; urgent: boolean }) {
  return (
    <li className="grid min-w-0 gap-2 py-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div>
        <p className={`font-mono text-xs ${tone(deadline.status)}`}>{statusCopy[deadline.status]}</p>
        <p className="mt-1 text-sm text-muted">{deadline.dueAt ? formatTimestamp(deadline.dueAt) : "No due time"}</p>
        {urgent ? <p className="mt-2 text-xs text-signal">Most urgent</p> : null}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{deadline.citation}</p>
        <p className="mt-1 break-words text-sm leading-6 text-muted">{deadline.obligation}</p>
        <p className="mt-2 text-sm text-muted">Starts at {describeClockStart(deadline.clockStarts)}.</p>
        {deadline.scheduleNote ? <p className="mt-2 break-words text-sm text-foreground">{deadline.scheduleNote}</p> : null}
      </div>
    </li>
  );
}
