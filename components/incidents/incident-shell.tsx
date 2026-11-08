"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, ListChecks, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebarCollapsed } from "@/components/incidents/use-sidebar-collapsed";
import { attentionFor } from "@/components/incidents/attention";
import { HavenMark } from "@/components/shell/site-header";
import { DemoBanner } from "@/components/incidents/demo-banner";
import { PasskeyLockCard } from "@/components/security/passkey-lock-card";
import { connectionLabel, phaseLabel, ROLE_LABELS } from "@/components/incidents/labels";
import { SectionNav } from "@/components/incidents/section-nav";
import { SafeText } from "@/components/incidents/safe-text";
import { listIntegrityFindings, failureLabel, formatSince } from "@/components/incidents/situation";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { IncidentClient, IncidentState } from "@/lib/client/types";
import { formatLocalTimestamp } from "@/lib/time";

const padded = "mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-8";

function BackLink() {
  return (
    <Link
      href="/incidents"
      className="mt-6 inline-flex text-sm text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      Back to incidents
    </Link>
  );
}

export function IncidentShell({ incidentId, children }: { incidentId: string; children: ReactNode }) {
  const state = useIncident();
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let client: IncidentClient;
    try {
      client = getIncidentClient();
    } catch (cause) {
      const message = clientErrorMessage(cause);
      queueMicrotask(() => {
        if (!cancelled) setOpenError(message);
      });
      return () => {
        cancelled = true;
      };
    }
    if (client.getState().incident?.id === incidentId) return;
    void client.openIncident(incidentId).catch((cause: unknown) => {
      if (!cancelled) setOpenError(clientErrorMessage(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  if (openError) {
    return (
      <div className={padded}>
        <p role="alert" className="text-sm text-alert">
          {openError}
        </p>
        <BackLink />
      </div>
    );
  }

  if (state.me?.state === "revoked") {
    return (
      <div className={padded}>
        <DemoBanner />
        <p className="mt-6 font-mono text-[11px] tracking-[0.18em] text-alert">ACCESS</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Your access to this incident was revoked.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
          Those keys stay revoked. To come back, ask the commander for a new invite link and open it here. You join again under new keys and the commander approves you as a new member.
        </p>
        <BackLink />
      </div>
    );
  }

  if (state.connection === "error" && state.incident?.id !== incidentId) {
    return (
      <div className={`${padded} grid gap-4`}>
        <PasskeyLockCard when="locked" />
        <p role="alert" className="text-sm text-alert">
          {state.error ?? "The incident client could not open this incident."}
        </p>
        <BackLink />
      </div>
    );
  }

  if (state.connection === "connecting" || state.incident?.id !== incidentId) {
    return <p className={`${padded} text-sm text-muted`}>Opening the incident…</p>;
  }

  if (state.me?.state === "pending") return <Pending state={state} />;
  if (state.me?.state !== "active" || !state.incident) {
    return <p className={`${padded} text-sm text-muted`}>Opening the incident…</p>;
  }

  return (
    <Room state={state} incidentId={incidentId}>
      {children}
    </Room>
  );
}

function Pending({ state }: { state: IncidentState }) {
  const role = state.me ? ROLE_LABELS[state.me.role] : "Member";
  const mock = isMockIncidentClient();
  return (
    <div className={padded}>
      <DemoBanner />
      <p className="mt-6 font-mono text-[11px] tracking-[0.18em] text-muted">WAITING</p>
      <h1 className="mt-3 text-3xl font-medium tracking-tight">Waiting for the commander.</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted">
        Your role is {role}. It came from the invite. The commander admits you into the room.
      </p>
      {state.me?.safetyCode ? (
        <p className="mt-4 font-mono text-sm text-foreground">
          Safety code {state.me.safetyCode}
          {mock ? ". Demo code. It was not derived from a key." : ""}
        </p>
      ) : null}
      <BackLink />
    </div>
  );
}

function Room({
  state,
  incidentId,
  children,
}: {
  state: IncidentState;
  incidentId: string;
  children: ReactNode;
}) {
  const now = useBrowserNow();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const incident = state.incident;
  if (!incident) return <p className="text-sm text-muted">No incident is open in this tab.</p>;
  const findings = listIntegrityFindings(state.integrity);
  const detected = incident.createdAt.getTime();
  const elapsed = now === null || Number.isNaN(detected) ? null : now - detected;
  const severity = state.status?.severity;
  const { badges } = attentionFor(state, now);
  const mock = isMockIncidentClient();

  return (
    <div
      id="incident-room"
      data-collapsed={collapsed ? "true" : "false"}
      className={`group/room min-w-0 lg:grid lg:min-h-dvh ${
        collapsed ? "lg:grid-cols-[4.25rem_minmax(0,1fr)]" : "lg:grid-cols-[15rem_minmax(0,1fr)]"
      }`}
    >
      <aside id="incident-sidebar" className="no-print min-w-0 border-line px-4 pt-4 sm:px-8 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-8 lg:overflow-y-auto lg:border-r lg:bg-panel/40 lg:px-3 lg:py-6">
        <div className={`mb-3 flex items-center justify-between gap-3 lg:mb-0 ${collapsed ? "lg:flex-col lg:gap-4" : "lg:px-3"}`}>
          <Link
            href="/"
            className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
          >
            {collapsed ? (
              <>
                <span className="lg:hidden">
                  <HavenMark />
                </span>
                <span className="hidden lg:block">
                  <svg aria-hidden="true" viewBox="0 0 36 14" className="h-3 w-9 text-signal">
                    <path d="M2 12 18 2l16 10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
                  </svg>
                  <span className="sr-only">HAVEN</span>
                </span>
              </>
            ) : (
              <HavenMark />
            )}
          </Link>
          <Link href="/incidents" className={`${quietLinkClass} lg:hidden`}>
            All incidents
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls="incident-sidebar"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden size-8 place-items-center rounded-lg text-muted hover:bg-panel-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:grid"
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-4" /> : <PanelLeftClose aria-hidden="true" className="size-4" />}
            <span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          </button>
        </div>
        <SectionNav incidentId={incidentId} badges={badges} />
        {collapsed ? (
          <div className="mt-auto hidden justify-center border-t border-line pt-4 lg:flex">
            <Link
              href="/incidents"
              title="All incidents"
              className="grid size-9 place-items-center rounded-lg text-muted hover:bg-panel-raised hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <ListChecks aria-hidden="true" className="size-4" />
              <span className="sr-only">All incidents</span>
            </Link>
          </div>
        ) : (
          <div className="mt-auto hidden space-y-3 border-t border-line px-3 pt-4 text-xs text-muted lg:block">
            <p>
              <span className="text-foreground">{state.me ? ROLE_LABELS[state.me.role] : "Member"}</span>
              <span aria-hidden="true"> · </span>
              {connectionLabel(state.connection, mock)}
            </p>
            <div className="flex gap-4">
              <Link href="/incidents" className={quietLinkClass}>
                All incidents
              </Link>
              <Link href="/org" className={quietLinkClass}>
                Org
              </Link>
            </div>
          </div>
        )}
      </aside>

      <div className="min-w-0 px-4 pb-10 pt-5 sm:px-8 lg:pt-8">
        <DemoBanner />
        <header className="mt-2 min-w-0">
          <h1 className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-mono text-sm font-medium ${severityBadgeClass(severity)}`}
            >
              {severity ?? "Open"}
            </span>
            <span className="min-w-0 break-words">
              {incident.title ? <SafeText text={incident.title} /> : "Untitled incident"}
            </span>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className="text-foreground">{state.status ? phaseLabel(state.status.phase) : "No phase yet"}</span>
            <span aria-hidden="true">·</span>
            {now === null || elapsed === null ? (
              <span>Opened</span>
            ) : (
              <span>
                Opened {formatLocalTimestamp(incident.createdAt)}, {formatSince(elapsed)}
              </span>
            )}
            <span aria-hidden="true">·</span>
            {state.integrity.ok ? (
              <span className="inline-flex items-center gap-1 text-verified">
                <CircleCheck aria-hidden="true" className="size-3.5" />
                {mock ? "Demo check passed" : "Integrity checked"}
              </span>
            ) : (
              <span className="text-alert">Integrity failed</span>
            )}
            <span className="lg:hidden">
              <span aria-hidden="true">· </span>
              {state.me ? ROLE_LABELS[state.me.role] : "Member"}
            </span>
          </p>
        </header>
        {state.connection === "offline" ? (
          <p className="mt-4 text-sm text-muted">The connection dropped. Showing the last update held in this tab.</p>
        ) : null}
        {state.connection === "error" && state.error ? (
          <p role="alert" className="mt-4 text-sm text-alert">
            {state.error}
          </p>
        ) : null}
        {findings.length > 0 ? (
          <ul className="mt-4 space-y-2" aria-label="Integrity findings">
            {findings.map((finding) =>
              finding.kind === "event" ? (
                <li
                  key={`${finding.channel}-${finding.seq}-${finding.reason}`}
                  className="break-words text-sm text-alert"
                >
                  Integrity failure: #{finding.channel} seq {finding.seq}. {failureLabel(finding.reason)}
                  {finding.detail ? `. ${finding.detail}` : "."}
                </li>
              ) : (
                <li key={`roster-${finding.identity}`} className="break-all text-sm text-alert">
                  Roster check failed for {finding.identity}. {finding.reason}
                </li>
              ),
            )}
          </ul>
        ) : null}
        <div className="mt-6 min-w-0">{children}</div>
      </div>
    </div>
  );
}

const quietLinkClass =
  "text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:text-xs";

function severityBadgeClass(severity: string | undefined): string {
  if (severity === "SEV1") return "border-alert text-alert";
  if (severity === "SEV2") return "border-signal text-signal";
  return "border-line text-foreground";
}
