"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormStatus } from "@/components/incidents/form-ui";
import { IncidentGate } from "@/components/incidents/incident-gate";
import { DeadlineStatusForm, DeterminationForm, LegalWriteNote, ProfileForm } from "@/components/incidents/legal-forms";
import { STATUS_LABELS } from "@/components/incidents/legal-inputs";
import { SafeText } from "@/components/incidents/safe-text";
import { memberName } from "@/components/incidents/situation";
import { LocalTime, useLocalClock } from "@/components/local-time";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import type { IncidentState } from "@/lib/client/types";
import {
  CIVIL_ZONE,
  COUNSEL_REVIEW_WARNING,
  HAVEN_LEGAL_DISCLAIMER,
  compareDeadlines,
  computeDeadlines,
  endOfNthCalendarDay,
  formatLegalInstant,
  isCounselReview,
  nextCountdown,
  showsConfirmedCountdown,
  type ComputedDeadline,
} from "@/lib/legal";
import { localTimeZone } from "@/lib/time";

const DAY_MS = 24 * 3_600_000;

/** Who receives each notice, in plain words. */
const RECIPIENT: Record<string, string> = {
  "sec-8k-105": "SEC, Form 8-K",
  "hipaa-404": "Affected patients",
  "hipaa-408": "HHS Office for Civil Rights",
  "hipaa-406": "Local media",
  "tx-521-ind": "Affected individuals",
  "tx-521-ag": "Texas Attorney General",
};

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
  const params = useParams<{ incidentId: string }>();
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  if (!state.incident) return <p className="text-sm text-muted">Opening the incident…</p>;

  const deadlines = now === null ? null : computeDeadlines(state, new Date(now)).slice().sort(compareDeadlines);
  const next = deadlines ? nextCountdown(deadlines) : null;
  const active = deadlines?.filter((row) => row.applicability !== "no") ?? [];
  const ruledOut = deadlines?.filter((row) => row.applicability === "no") ?? [];
  const discoveryAt = validDate(state.discovery?.determinedAt);
  const systemsHref = `/incidents/${encodeURIComponent(params.incidentId ?? "")}/systems`;

  return (
    <div className="grid min-w-0 gap-8">
      <header>
        <h2 className="text-xl font-medium tracking-tight">Legal deadlines</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Texas and HIPAA notice clocks, computed from the signed record. Each one starts when discovery is recorded.
        </p>
      </header>

      {state.connection === "offline" ? (
        <p className="text-sm text-muted">The connection dropped. Showing the last update held in this tab.</p>
      ) : null}
      {state.connection === "error" && state.error ? (
        <p role="alert" className="text-sm text-alert">
          {state.error}
        </p>
      ) : null}

      <NextDeadline next={next} now={now} discoveryAt={discoveryAt} />

      {deadlines && discoveryAt && now !== null ? <ClockMap deadlines={active} start={discoveryAt} now={now} /> : null}

      <section aria-labelledby="notices-heading">
        <h3 id="notices-heading" className="text-sm font-medium">
          Notices on this incident
        </h3>
        {deadlines === null ? (
          <p className="mt-3 text-sm text-muted">Notice clocks open with the browser clock.</p>
        ) : active.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No notice is on this incident yet. Record what was exposed on Affected Systems.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
            {active.map((deadline) => (
              <NoticeRow
                key={deadline.rule.id}
                deadline={deadline}
                urgent={deadline.rule.id === next?.rule.id}
                now={now}
                members={state.members}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="facts-heading" className="grid gap-4">
        <div>
          <h3 id="facts-heading" className="text-sm font-medium">
            Facts behind the clocks
          </h3>
          <p className="mt-1 text-sm text-muted">Change a fact here and every clock above recomputes.</p>
        </div>
        <LegalWriteNote />
        <FormStatus message={savedMessage} />
        <div className="grid gap-4 lg:grid-cols-2">
          <FactCard title="Discovery">
            <Recorded entry={state.discovery} empty="Not recorded. No clock is running." />
            <DeterminationForm
              key={`discovery-${state.discovery?.determinedAt.toISOString() ?? "none"}-${state.discovery?.basis ?? ""}`}
              kind="legal.discovery"
              determinedAt={state.discovery?.determinedAt}
              basis={state.discovery?.basis}
              onSaved={setSavedMessage}
            />
          </FactCard>
          <div className="grid gap-4">
            <FactCard title="Organization">
              <ProfileForm onSaved={setSavedMessage} />
            </FactCard>
            <FactCard title="Exposure on record">
              <ExposureFacts state={state} />
              <Link href={systemsHref} className="mt-3 inline-block text-sm text-signal underline decoration-signal/40 underline-offset-2">
                Edit on Affected Systems
              </Link>
            </FactCard>
          </div>
          {state.profile.publicCompany || state.materiality ? (
            <FactCard title="Materiality">
              <Recorded entry={state.materiality} empty="Not recorded. Form 8-K has not started." />
              <DeterminationForm
                key={`materiality-${state.materiality?.determinedAt.toISOString() ?? "none"}-${state.materiality?.basis ?? ""}`}
                kind="legal.materiality"
                determinedAt={state.materiality?.determinedAt}
                basis={state.materiality?.basis}
                onSaved={setSavedMessage}
              />
            </FactCard>
          ) : null}
        </div>
      </section>

      {ruledOut.length > 0 ? (
        <details className="group rounded-2xl border border-line px-4 py-3">
          <summary className="cursor-pointer text-sm text-muted marker:text-muted">
            Checked and ruled out ({ruledOut.length})
          </summary>
          <ul className="mt-3 grid gap-3">
            {ruledOut.map((deadline) => (
              <li key={deadline.rule.id} className="text-sm">
                <span className="text-foreground">{deadline.rule.name}</span>
                <span className="text-muted">
                  {" · "}
                  <SafeText text={deadline.explanation} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className="max-w-3xl border-t border-line pt-4 text-xs leading-5 text-muted">
        <p>{HAVEN_LEGAL_DISCLAIMER}</p>
        <p className="mt-1">{COUNSEL_REVIEW_WARNING}</p>
      </footer>
    </div>
  );
}

function NextDeadline({ next, now, discoveryAt }: { next: ComputedDeadline | null; now: number | null; discoveryAt: Date | null }) {
  const clockReady = useLocalClock();
  if (!next || !next.dueAt || now === null) {
    return (
      <section aria-label="Next deadline" className="rounded-2xl border border-line bg-panel px-5 py-5">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">NEXT DEADLINE</p>
        <p className="mt-3 text-lg text-foreground">{discoveryAt ? "No clock is running" : "Clocks start at discovery"}</p>
        <p className="mt-1 text-sm text-muted">
          {discoveryAt
            ? "Every notice on this incident is sent, ruled out, or waiting on counsel."
            : "Record when the team determined a breach occurred, below, to start the Texas and HIPAA clocks."}
        </p>
      </section>
    );
  }
  const delta = next.dueAt.getTime() - now;
  const overdue = delta < 0;
  const elapsedSince = discoveryAt ? now - discoveryAt.getTime() : null;
  return (
    <section
      aria-label="Next deadline"
      className={`grid gap-4 rounded-2xl border bg-panel px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end ${
        overdue ? "border-alert" : "border-signal"
      }`}
    >
      <div className="min-w-0">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">NEXT DEADLINE</p>
        <p className="mt-3 text-lg font-medium text-foreground">{next.rule.name}</p>
        <p className="mt-1 text-sm text-muted">
          {RECIPIENT[next.rule.id] ?? next.rule.jurisdiction}
          {clockReady ? ` · due ${formatLegalInstant(next.dueAt, localTimeZone())}` : ""}
        </p>
      </div>
      <div className="sm:text-right">
        <p className={`font-mono text-3xl tracking-tight sm:text-4xl ${overdue ? "text-alert" : "text-signal"}`}>{countdown(Math.abs(delta))}</p>
        <p className="mt-1 text-sm text-muted">
          {overdue ? "overdue" : "left"}
          {elapsedSince !== null && elapsedSince >= 0 ? ` · day ${Math.floor(elapsedSince / DAY_MS) + 1} since discovery` : ""}
        </p>
      </div>
    </section>
  );
}

/** One line from discovery to the last due date. Each notice is a marker; the today line moves along it. */
function ClockMap({ deadlines, start, now }: { deadlines: readonly ComputedDeadline[]; start: Date; now: number }) {
  const markers = deadlines.flatMap((row) => {
    if (showsConfirmedCountdown(row) && row.dueAt) {
      const done = row.recorded?.status === "done" || row.recorded?.status === "not_applicable";
      return [{ id: row.rule.id, at: row.dueAt.getTime(), label: shortName(row), kind: done ? "done" : row.clockStatus === "elapsed" ? "late" : "live" }];
    }
    if (row.rule.id === "state-check-ca") {
      return [{ id: row.rule.id, at: endOfNthCalendarDay(start, 30, CIVIL_ZONE).getTime(), label: "California, if no delay applies", kind: "counsel" }];
    }
    return [];
  });
  if (markers.length === 0) return null;
  const begin = start.getTime();
  const end = Math.max(...markers.map((marker) => marker.at), now, begin + 30 * DAY_MS);
  const span = end - begin || 1;
  const place = (at: number) => `${Math.min(100, Math.max(0, ((at - begin) / span) * 100))}%`;
  const groups = new Map<number, typeof markers>();
  for (const marker of markers) {
    // Due instants are the last millisecond of a civil day, so floor gives the statutory day count.
    const day = Math.floor((marker.at - begin) / DAY_MS);
    groups.set(day, [...(groups.get(day) ?? []), marker]);
  }
  const days = [...groups.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <section aria-labelledby="map-heading" className="rounded-2xl border border-line bg-panel px-5 py-5">
      <h3 id="map-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        THE CLOCK FROM DISCOVERY
      </h3>
      <div className="relative mx-2 mt-8 h-1 rounded-full bg-line" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-signal/60" style={{ width: place(now) }} />
        <span className="absolute -top-1.5 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-signal bg-background" style={{ left: "0%" }} />
        {markers.map((marker) => (
          <span
            key={marker.id}
            className={`absolute -top-1.5 h-4 w-4 -translate-x-1/2 rounded-full border-2 ${markerTone(marker.kind)}`}
            style={{ left: place(marker.at) }}
          />
        ))}
        <span className="absolute -top-4 h-9 w-px -translate-x-1/2 bg-foreground" style={{ left: place(now) }} />
        <span className="absolute -top-8 -translate-x-1/2 font-mono text-[10px] tracking-[0.14em] text-foreground" style={{ left: place(now) }}>
          NOW
        </span>
      </div>
      <ol className="mt-6 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <li className="flex gap-3">
          <span className="w-14 shrink-0 font-mono text-xs text-muted">Day 0</span>
          <span className="text-foreground">Discovery recorded</span>
        </li>
        {days.map(([day, group]) => (
          <li key={day} className="flex gap-3">
            <span className="w-14 shrink-0 font-mono text-xs text-muted">Day {day}</span>
            <span className="min-w-0 text-foreground">
              {group.map((marker, index) => (
                <span key={marker.id} className={marker.kind === "counsel" ? "text-muted" : marker.kind === "done" ? "text-muted line-through" : ""}>
                  {index > 0 ? ", " : ""}
                  {marker.label}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NoticeRow({
  deadline,
  urgent,
  now,
  members,
}: {
  deadline: ComputedDeadline;
  urgent: boolean;
  now: number | null;
  members: IncidentState["members"];
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const clockReady = useLocalClock();
  const confirmed = showsConfirmedCountdown(deadline);
  const review = isCounselReview(deadline);
  const delta = confirmed && deadline.dueAt && now !== null ? deadline.dueAt.getTime() - now : null;
  const source = officialUrl(deadline.rule.sourceUrl);
  const mark = deadline.recorded;
  const when =
    delta !== null
      ? delta < 0
        ? `${countdown(-delta)} overdue`
        : `${countdown(delta)} left`
      : review
        ? "Counsel decides"
        : deadline.clockStatus === "not_started"
          ? "Starts at discovery"
          : "No countdown";

  return (
    <li className="min-w-0">
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-4 hover:bg-panel-raised sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${dotTone(deadline, urgent)}`} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{deadline.rule.name}</span>
            <span className="block text-xs text-muted">
              {RECIPIENT[deadline.rule.id] ?? deadline.rule.jurisdiction}
              {confirmed && deadline.dueAt && clockReady ? ` · due ${formatLegalInstant(deadline.dueAt, localTimeZone())}` : ""}
            </span>
          </span>
          <span
            className={`col-start-2 font-mono text-xs sm:col-start-auto sm:text-right ${
              delta !== null && delta < 0 ? "text-alert" : delta !== null ? "text-foreground" : "text-muted"
            }`}
          >
            {when}
          </span>
          <span className="col-start-2 text-xs text-muted sm:col-start-auto sm:w-40 sm:text-right">
            {mark ? `${STATUS_LABELS[mark.status]} · ${memberName(members, mark.owner)}` : "Unassigned"}
          </span>
        </summary>
        <div className="grid gap-5 border-t border-line px-4 py-4 sm:grid-cols-2">
          <div className="min-w-0 text-sm">
            <p className="leading-6 text-muted">
              <SafeText text={deadline.explanation} />
            </p>
            {mark?.note ? (
              <p className="mt-3 leading-6 text-foreground">
                Note: <SafeText text={mark.note} />
              </p>
            ) : null}
            {deadline.startedAt ? (
              <p className="mt-3 text-muted">
                Started <LocalTime value={deadline.startedAt} />
              </p>
            ) : null}
            <p className="mt-3 text-muted">
              {deadline.rule.citation}
              {source ? (
                <>
                  {" · "}
                  <a href={source} rel="noopener noreferrer" target="_blank" className="text-signal underline decoration-signal/40 underline-offset-2">
                    Read the rule
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <div className="min-w-0">
            <FormStatus message={saved} />
            <DeadlineStatusForm
              key={`${deadline.rule.id}-${mark?.status ?? "none"}-${mark?.owner ?? ""}-${mark?.note ?? ""}`}
              ruleId={deadline.rule.id}
              ruleName={deadline.rule.name}
              status={mark?.status}
              owner={mark?.owner}
              note={mark?.note}
              onSaved={setSaved}
            />
          </div>
        </div>
      </details>
    </li>
  );
}

function FactCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel px-4 py-4">
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="mt-3 grid gap-4">{children}</div>
    </div>
  );
}

function Recorded({ entry, empty }: { entry: IncidentState["discovery"]; empty: string }) {
  if (!entry) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="text-sm">
      <p className="text-foreground">
        <LocalTime value={entry.determinedAt} />
        {` · ${entry.by.displayName}`}
      </p>
      {entry.basis ? (
        <p className="mt-1 break-words leading-6 text-muted">
          <SafeText text={entry.basis} />
        </p>
      ) : null}
    </div>
  );
}

/** The counts the engine read, next to the line each rule uses. */
function ExposureFacts({ state }: { state: IncidentState }) {
  const open = new Set(["suspected", "exfiltrated", "encrypted"]);
  let texas = 0;
  let california = 0;
  let phi = 0;
  let phiUnknown = false;
  const others = new Map<string, number>();
  for (const item of state.scope ?? []) {
    const body = item?.latest;
    if (!body || !open.has(body.status)) continue;
    for (const resident of body.affected ?? []) {
      if (!resident || !Number.isFinite(resident.count)) continue;
      if (resident.state === "TX") texas += resident.count;
      else if (resident.state === "CA") california += resident.count;
      else others.set(resident.state, (others.get(resident.state) ?? 0) + resident.count);
    }
    if (body.dataTypes?.includes("phi")) {
      if (typeof body.recordCount === "number" && Number.isFinite(body.recordCount)) phi += body.recordCount;
      else phiUnknown = true;
    }
  }
  const rows: [string, string, string][] = [
    ["Texas residents", texas.toLocaleString("en-US"), texas >= 250 ? "Attorney General notice (250+)" : "Under the 250 line"],
    ["California residents", california.toLocaleString("en-US"), california > 0 ? "California 30-day rule, counsel" : "None recorded"],
    ["PHI records", phiUnknown ? (phi > 0 ? `${phi.toLocaleString("en-US")}+` : "Unknown") : phi.toLocaleString("en-US"), phi >= 500 ? "HHS notice (500+)" : phiUnknown ? "A system has no count" : "Under the 500 line"],
  ];
  if (others.size > 0) {
    rows.push(["Other states", [...others.keys()].sort().join(", "), "Counsel checks each state"]);
  }
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([label, value, line]) => (
        <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line pb-2">
          <dt className="text-muted">{label}</dt>
          <dd className="text-right font-mono text-foreground">{value}</dd>
          <dd className="col-span-2 text-xs text-muted">{line}</dd>
        </div>
      ))}
    </dl>
  );
}

function shortName(row: ComputedDeadline): string {
  const names: Record<string, string> = {
    "sec-8k-105": "SEC 8-K",
    "hipaa-404": "HIPAA patients",
    "hipaa-408": "HHS",
    "hipaa-406": "Media",
    "tx-521-ind": "Texas individuals",
    "tx-521-ag": "Texas AG",
  };
  return names[row.rule.id] ?? row.rule.name;
}

function markerTone(kind: string): string {
  if (kind === "late") return "border-alert bg-alert";
  if (kind === "done") return "border-verified bg-verified";
  if (kind === "counsel") return "border-muted border-dashed bg-background";
  return "border-signal bg-signal";
}

function dotTone(deadline: ComputedDeadline, urgent: boolean): string {
  const status = deadline.recorded?.status;
  if (status === "done" || status === "not_applicable") return "bg-verified";
  if (deadline.clockStatus === "elapsed") return "bg-alert";
  if (urgent) return "bg-signal";
  if (showsConfirmedCountdown(deadline)) return "bg-foreground";
  return "border border-muted";
}

/** Days and hours once a deadline is more than a day away; hours and minutes inside a day. */
function countdown(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function validDate(value: Date | undefined): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
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
