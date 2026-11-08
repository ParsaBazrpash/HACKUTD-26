"use client";

import { useState, type ReactNode } from "react";
import { FormStatus } from "@/components/incidents/form-ui";
import { HourClock } from "@/components/incidents/hour-clock";
import { IncidentGate } from "@/components/incidents/incident-gate";
import { DeadlineStatusForm, DeterminationForm, LegalWriteNote } from "@/components/incidents/legal-forms";
import { SafeText } from "@/components/incidents/safe-text";
import { memberName } from "@/components/incidents/situation";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import type { IncidentState } from "@/lib/client/types";
import {
  COUNSEL_REVIEW_WARNING,
  HAVEN_LEGAL_DISCLAIMER,
  clockStatusLabel,
  compareDeadlines,
  computeDeadlines,
  formatLegalInstant,
  isCounselReview,
  nextCountdown,
  showsConfirmedCountdown,
  triggerLabel,
  type Applicability,
  type ClockStatus,
  type ComputedDeadline,
} from "@/lib/legal";
import { LocalTime, useLocalClock } from "@/components/local-time";
import { formatDuration, localTimeZone } from "@/lib/time";

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
  return (
    <IncidentGate state={state}>
      <LegalReady state={state} />
    </IncidentGate>
  );
}

function LegalReady({ state }: { state: IncidentState }) {
  const now = useBrowserNow();
  const [discoverySaved, setDiscoverySaved] = useState<string | null>(null);
  const [materialitySaved, setMaterialitySaved] = useState<string | null>(null);
  const incident = state.incident;
  if (!incident) return <p className="text-sm text-muted">Opening the incident…</p>;
  const discoveryAt = state.discovery?.determinedAt;
  const startedAt = discoveryAt && Number.isFinite(discoveryAt.getTime()) ? discoveryAt.toISOString() : null;
  const deadlines = now === null ? null : computeDeadlines(state, new Date(now)).slice().sort(compareDeadlines);
  const urgentId = deadlines ? nextCountdown(deadlines)?.rule.id ?? null : null;
  const running = deadlines?.filter((deadline) => showsConfirmedCountdown(deadline)) ?? [];
  const review = deadlines?.filter((deadline) => isCounselReview(deadline)) ?? [];
  const resting = deadlines?.filter((deadline) => !showsConfirmedCountdown(deadline) && !isCounselReview(deadline)) ?? [];

  return (
    <div className="grid min-w-0 gap-8">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Legal deadlines</h2>
        <div className="mt-4 max-w-3xl rounded-2xl border border-line bg-panel px-4 py-4">
          <p className="text-sm leading-6 text-foreground">{HAVEN_LEGAL_DISCLAIMER}</p>
          <p className="mt-2 text-sm leading-6 text-muted">{COUNSEL_REVIEW_WARNING}</p>
        </div>
        {deadlines ? (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            {running.length === 1 ? "1 confirmed countdown is running." : `${running.length} confirmed countdowns are running.`}{" "}
            {review.length === 1
              ? "1 rule is marked Review with counsel and has no countdown."
              : `${review.length} rules are marked Review with counsel and have no countdown.`}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">Notice clocks open with the browser clock.</p>
        )}
      </div>

      {state.connection === "offline" ? (
        <p className="text-sm text-muted">The connection dropped. Showing the last update held in this tab.</p>
      ) : null}
      {state.connection === "error" && state.error ? (
        <p role="alert" className="text-sm text-alert">
          {state.error}
        </p>
      ) : null}

      <HourClock startedAt={startedAt} />
      <LegalWriteNote />

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

      <section aria-labelledby="discovery-heading" className="grid gap-6">
        <h3 id="discovery-heading" className="text-sm font-medium">
          Recorded determinations
        </h3>
        <div className="grid gap-6 lg:grid-cols-2">
          <Determination
            label="Discovery"
            at={state.discovery?.determinedAt}
            by={state.discovery?.by.displayName}
            basis={state.discovery?.basis}
            empty="No discovery time is on the record. Clocks that start at discovery are not running."
          >
            <FormStatus message={discoverySaved} />
            <DeterminationForm
              key={`discovery-${state.discovery?.determinedAt.toISOString() ?? "none"}-${state.discovery?.basis ?? ""}`}
              kind="legal.discovery"
              determinedAt={state.discovery?.determinedAt}
              basis={state.discovery?.basis}
              onSaved={setDiscoverySaved}
            />
          </Determination>
          <Determination
            label="Materiality"
            at={state.materiality?.determinedAt}
            by={state.materiality?.by.displayName}
            basis={state.materiality?.basis}
            empty="No materiality determination is on the record. Form 8-K does not start until one is recorded."
          >
            <FormStatus message={materialitySaved} />
            <DeterminationForm
              key={`materiality-${state.materiality?.determinedAt.toISOString() ?? "none"}-${state.materiality?.basis ?? ""}`}
              kind="legal.materiality"
              determinedAt={state.materiality?.determinedAt}
              basis={state.materiality?.basis}
              onSaved={setMaterialitySaved}
            />
          </Determination>
        </div>
      </section>

      <section aria-labelledby="clocks-heading" className="grid gap-8">
        <h3 id="clocks-heading" className="text-sm font-medium">
          Notice clocks
        </h3>
        {deadlines === null ? (
          <p className="text-sm text-muted">Notice clocks open with the browser clock.</p>
        ) : deadlines.length === 0 ? (
          <p className="text-sm text-muted">No deadline rules are available for this record.</p>
        ) : (
          <>
            <DeadlineGroup
              title="Confirmed countdowns"
              empty="No confirmed countdown is running."
              deadlines={running}
              urgentId={urgentId}
              now={now}
              members={state.members}
            />
            <DeadlineGroup
              title="Review with counsel"
              empty="No rule is waiting on a counsel decision."
              deadlines={review}
              urgentId={null}
              now={now}
              members={state.members}
            />
            <DeadlineGroup
              title="Not running"
              empty="Every rule on this record is running or marked for counsel."
              deadlines={resting}
              urgentId={null}
              now={now}
              members={state.members}
            />
          </>
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
  children,
}: {
  label: string;
  at?: Date;
  by?: string;
  basis?: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel px-4 py-4">
      <h4 className="text-sm font-medium">{label}</h4>
      {at ? (
        <>
          <p className="mt-2 text-sm text-foreground">
            <LocalTime value={at} />
            {by ? ` · ${by}` : ""}
          </p>
          {basis ? (
            <p className="mt-2 break-words text-sm leading-6 text-muted">
              <SafeText text={basis} />
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">No basis recorded.</p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted">{empty}</p>
      )}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function DeadlineGroup({
  title,
  empty,
  deadlines,
  urgentId,
  now,
  members,
}: {
  title: string;
  empty: string;
  deadlines: readonly ComputedDeadline[];
  urgentId: string | null;
  now: number | null;
  members: { identity: string; displayName: string }[];
}) {
  return (
    <div>
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      {deadlines.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-3 grid gap-4">
          {deadlines.map((deadline) => (
            <DeadlineCard
              key={deadline.rule.id}
              deadline={deadline}
              urgent={deadline.rule.id === urgentId}
              now={now}
              members={members}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DeadlineCard({
  deadline,
  urgent,
  now,
  members,
}: {
  deadline: ComputedDeadline;
  urgent: boolean;
  now: number | null;
  members: { identity: string; displayName: string }[];
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const clockReady = useLocalClock();
  const confirmed = showsConfirmedCountdown(deadline);
  const review = isCounselReview(deadline);
  const frame = urgent
    ? deadline.clockStatus === "elapsed"
      ? "border-alert bg-panel"
      : "border-signal bg-panel"
    : review
      ? "border-signal/40 bg-panel"
      : "border-line";
  const source = officialUrl(deadline.rule.sourceUrl);
  const delta = confirmed && deadline.dueAt && now !== null ? deadline.dueAt.getTime() - now : null;
  const due = confirmed && deadline.dueAt
    ? clockReady
      ? formatLegalInstant(deadline.dueAt, localTimeZone())
      : ""
    : "No confirmed deadline";

  return (
    <li className={`min-w-0 rounded-2xl border px-4 py-4 ${frame}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={applicabilityTone(deadline.applicability)}>{deadline.applicability === "check" ? "Review with counsel" : applicabilityWord(deadline.applicability)}</Badge>
        <Badge tone={statusTone(deadline.clockStatus, review)}>{clockStatusLabel(deadline)}</Badge>
        {urgent ? <Badge tone={deadline.clockStatus === "elapsed" ? "alert" : "signal"}>Most urgent</Badge> : null}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          {delta === null ? (
            <p className="text-sm text-muted">No confirmed countdown</p>
          ) : (
            <p className={`font-mono text-2xl tracking-tight sm:text-3xl ${deadline.clockStatus === "elapsed" ? "text-alert" : "text-foreground"}`}>
              <span className="block break-all">{formatDuration(Math.abs(delta))}</span>
              <span className="mt-1 block text-sm text-muted">{delta < 0 ? "overdue" : "remaining"}</span>
            </p>
          )}
          <p className="mt-2 break-words text-sm text-muted">{due}</p>
        </div>
        <div className="min-w-0">
          <h4 className="text-base font-medium text-foreground">{deadline.rule.name}</h4>
          <p className="mt-1 text-sm text-muted">{deadline.rule.jurisdiction}</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-muted">Trigger</dt>
              <dd>{triggerLabel(deadline.rule)}</dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-muted">Citation</dt>
              <dd className="break-words">{deadline.rule.citation}</dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <dt className="text-muted">Official link</dt>
              <dd className="min-w-0">
                {source ? (
                  <a
                    href={source}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="break-all text-signal underline decoration-signal/40 underline-offset-2"
                  >
                    {source}
                  </a>
                ) : (
                  "No official link is recorded for this rule."
                )}
              </dd>
            </div>
          </dl>
          {deadline.startedAt ? (
            <p className="mt-3 text-sm text-muted">
              Started <LocalTime value={deadline.startedAt} />
            </p>
          ) : null}
          <p className="mt-3 break-words text-sm leading-6 text-muted">
            <SafeText text={deadline.explanation} />
          </p>
          {deadline.recorded ? (
            <p className="mt-3 break-words text-sm text-foreground">
              Recorded {recordedWord(deadline.recorded.status)} · {memberName(members, deadline.recorded.owner)}
              {deadline.recorded.note ? (
                <>
                  {" · "}
                  <SafeText text={deadline.recorded.note} />
                </>
              ) : null}
              . A recorded mark does not change the computed deadline.
            </p>
          ) : null}
          {deadline.applicability === "applies" || deadline.applicability === "check" ? (
            <>
              <FormStatus message={saved} />
              <DeadlineStatusForm
                key={`${deadline.rule.id}-${deadline.recorded?.status ?? "none"}-${deadline.recorded?.owner ?? ""}-${deadline.recorded?.note ?? ""}`}
                ruleId={deadline.rule.id}
                ruleName={deadline.rule.name}
                status={deadline.recorded?.status}
                owner={deadline.recorded?.owner}
                note={deadline.recorded?.note}
                onSaved={setSaved}
              />
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Badge({ children, tone }: { children: string; tone: "alert" | "signal" | "muted" | "verified" }) {
  const color = {
    alert: "border-alert text-alert",
    signal: "border-signal text-signal",
    verified: "border-verified text-verified",
    muted: "border-line text-muted",
  }[tone];
  return <span className={`inline-flex min-h-7 items-center rounded-md border px-2 text-xs ${color}`}>{children}</span>;
}

function applicabilityWord(value: Applicability): string {
  if (value === "applies") return "Applies";
  if (value === "check") return "Review with counsel";
  return "Not on this record";
}

function applicabilityTone(value: Applicability): "signal" | "muted" | "verified" {
  if (value === "applies") return "verified";
  if (value === "check") return "signal";
  return "muted";
}

function statusTone(status: ClockStatus, review: boolean): "alert" | "signal" | "muted" | "verified" {
  if (status === "elapsed") return "alert";
  if (review || status === "due_soon" || status === "not_in_effect") return "signal";
  if (status === "scheduled") return "verified";
  return "muted";
}

function recordedWord(status: string): string {
  if (status === "in_progress") return "in progress";
  if (status === "not_applicable") return "not applicable";
  if (status === "done") return "done";
  if (status === "open") return "open";
  return status;
}

function officialUrl(value: string): string | null {
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
