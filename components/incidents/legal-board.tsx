"use client";

import { HourClock } from "@/components/incidents/hour-clock";
import { SafeText } from "@/components/incidents/safe-text";
import { memberName } from "@/components/incidents/situation";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { COUNSEL_REVIEW_WARNING, computeDeadlines, formatLegalInstant, nextCountdown } from "@/lib/legal";
import type { ClockStatus, ComputedDeadline } from "@/lib/legal";
import { formatTimestamp } from "@/lib/time";

const clockCopy: Record<ClockStatus, string> = {
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

function tone(status: ClockStatus): string {
  if (status === "elapsed") return "text-alert";
  if (status === "due_soon" || status === "needs_counsel" || status === "not_in_effect") return "text-signal";
  if (status === "scheduled") return "text-verified";
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
  const discoveryAt = state.discovery?.determinedAt;
  const startedAt = discoveryAt && Number.isFinite(discoveryAt.getTime()) ? discoveryAt.toISOString() : null;
  const deadlines = now === null ? null : computeDeadlines(state, new Date(now));
  const urgent = deadlines ? nextCountdown(deadlines) : null;
  const running = deadlines?.filter((deadline) => deadline.dueAt && (deadline.clockStatus === "scheduled" || deadline.clockStatus === "due_soon" || deadline.clockStatus === "elapsed")).length ?? 0;
  const reviews = deadlines?.filter((deadline) => deadline.applicability === "check" || deadline.clockStatus === "not_in_effect").length ?? 0;

  return (
    <div className="grid min-w-0 gap-8">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Legal deadlines</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{COUNSEL_REVIEW_WARNING}</p>
        {deadlines ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {running === 1 ? "1 countdown is running." : `${running} countdowns are running.`}{" "}
            {reviews === 1 ? "1 rule needs counsel review before a date is used." : `${reviews} rules need counsel review before a date is used.`}
          </p>
        ) : null}
      </div>
      <HourClock startedAt={startedAt} />
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
            empty="No discovery time is on the record. Clocks that start at discovery are not running."
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
              <DeadlineRow
                key={deadline.rule.id}
                deadline={deadline}
                urgent={deadline.rule.id === urgent?.rule.id}
                members={state.members}
              />
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

function DeadlineRow({
  deadline,
  urgent,
  members,
}: {
  deadline: ComputedDeadline;
  urgent: boolean;
  members: { identity: string; displayName: string }[];
}) {
  const due = deadline.dueAt
    ? deadline.rule.timeZone
      ? formatLegalInstant(deadline.dueAt, deadline.rule.timeZone)
      : formatTimestamp(deadline.dueAt)
    : "No due time";
  const source = deadline.rule.sourceUrl.startsWith("https://") ? deadline.rule.sourceUrl : null;
  return (
    <li className="grid min-w-0 gap-2 py-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div>
        <p className={`font-mono text-xs ${tone(deadline.clockStatus)}`}>{clockCopy[deadline.clockStatus]}</p>
        <p className="mt-1 text-sm text-muted">{due}</p>
        {urgent ? <p className="mt-2 text-xs text-signal">Most urgent</p> : null}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{deadline.rule.name}</p>
        <p className="mt-1 text-sm text-muted">{deadline.rule.jurisdiction}</p>
        {source ? (
          <a
            href={source}
            rel="noopener noreferrer"
            target="_blank"
            className="mt-1 inline-block break-all text-sm text-signal underline decoration-signal/40 underline-offset-2"
          >
            {deadline.rule.citation}
          </a>
        ) : (
          <p className="mt-1 break-words text-sm text-muted">{deadline.rule.citation}</p>
        )}
        <p className="mt-2 break-words text-sm leading-6 text-muted">
          <SafeText text={deadline.explanation} />
        </p>
        <p className="mt-2 break-words text-sm leading-6 text-muted">
          <SafeText text={deadline.counselReview} />
        </p>
        {deadline.recorded ? (
          <p className="mt-2 break-words text-sm text-foreground">
            Recorded {deadline.recorded.status} · {memberName(members, deadline.recorded.owner)}
            {deadline.recorded.note ? (
              <>
                {" · "}
                <SafeText text={deadline.recorded.note} />
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}
