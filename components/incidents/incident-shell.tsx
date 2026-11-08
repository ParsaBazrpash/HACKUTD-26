"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { DemoBanner } from "@/components/incidents/demo-banner";
import { PasskeyLockCard } from "@/components/security/passkey-lock-card";
import { ROLE_LABELS } from "@/components/incidents/labels";
import { SectionNav } from "@/components/incidents/section-nav";
import { SafeText } from "@/components/incidents/safe-text";
import { listIntegrityFindings, failureLabel } from "@/components/incidents/situation";
import { StatusBar } from "@/components/incidents/status-bar";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { IncidentClient, IncidentState } from "@/lib/client/types";
import { formatTimestamp } from "@/lib/time";

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
      <div>
        <p role="alert" className="text-sm text-alert">
          {openError}
        </p>
        <BackLink />
      </div>
    );
  }

  if (state.me?.state === "revoked") {
    return (
      <div>
        <DemoBanner />
        <p className="mt-6 font-mono text-[11px] tracking-[0.18em] text-alert">ACCESS</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Your access to this incident was revoked.</h1>
        <BackLink />
      </div>
    );
  }

  if (state.connection === "error" && state.incident?.id !== incidentId) {
    return (
      <div className="grid gap-4">
        <PasskeyLockCard when="locked" />
        <p role="alert" className="text-sm text-alert">
          {state.error ?? "The incident client could not open this incident."}
        </p>
        <BackLink />
      </div>
    );
  }

  if (state.connection === "connecting" || state.incident?.id !== incidentId) {
    return <p className="text-sm text-muted">Opening the incident…</p>;
  }

  if (state.me?.state === "pending") return <Pending state={state} />;
  if (state.me?.state !== "active" || !state.incident) {
    return <p className="text-sm text-muted">Opening the incident…</p>;
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
    <div>
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
  const incident = state.incident;
  if (!incident) return <p className="text-sm text-muted">No incident is open in this tab.</p>;
  const findings = listIntegrityFindings(state.integrity);

  return (
    <div className="min-w-0">
      <DemoBanner />
      <p className="mt-6 font-mono text-[11px] tracking-[0.18em] text-muted">COMMAND CENTER</p>
      <h1 className="mt-3 break-words text-3xl font-medium tracking-tight sm:text-4xl">
        <SafeText text={incident.title || "Untitled incident"} />
      </h1>
      <p className="mt-2 text-sm text-muted">Opened {formatTimestamp(incident.createdAt)}</p>
      {state.status?.summary ? (
        <p className="mt-4 max-w-3xl break-words text-sm leading-6 text-muted">
          <SafeText text={state.status.summary} />
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted">No status has been recorded.</p>
      )}
      <StatusBar state={state} />
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
      <SectionNav incidentId={incidentId} />
      <p className="no-print mt-3 text-xs leading-5 text-muted">
        Actions follow your role. Every submit is checked again by the incident client.
      </p>
      <div className="mt-8 min-w-0">{children}</div>
    </div>
  );
}
