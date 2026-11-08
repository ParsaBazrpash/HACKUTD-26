"use client";

import type { ReactNode } from "react";
import { IntegrityMark } from "@/components/ui/integrity-mark";
import { connectionLabel, phaseLabel, ROLE_LABELS } from "@/components/incidents/labels";
import { formatLead, formatSince } from "@/components/incidents/situation";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { isMockIncidentClient } from "@/lib/client";
import type { IncidentState } from "@/lib/client/types";
import { computeDeadlines, nextCountdown } from "@/lib/legal";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] tracking-[0.16em] text-muted">{label}</p>
      <div className="mt-1 break-words text-sm text-foreground">{children}</div>
    </div>
  );
}

export function StatusBar({ state }: { state: IncidentState }) {
  const now = useBrowserNow();
  const mock = isMockIncidentClient();
  const incident = state.incident;
  const detected = incident ? incident.createdAt.getTime() : Number.NaN;
  const elapsed = now === null || Number.isNaN(detected) ? null : now - detected;
  const deadlines = now === null || !incident ? null : computeDeadlines(state, new Date(now));
  const urgent = deadlines ? nextCountdown(deadlines) : null;
  const urgentLead = urgent?.dueAt && now !== null ? formatLead(urgent.dueAt.getTime() - now) : null;
  const waiting = state.members.filter((member) => member.state === "pending").length;
  const severity = state.status?.severity;

  return (
    <section
      aria-label="Incident status"
      className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-4"
    >
      <Fact label="SEVERITY">
        <span className={severity === "SEV1" ? "text-alert" : severity === "SEV2" ? "text-signal" : undefined}>
          {severity ?? "Unset"}
        </span>
      </Fact>
      <Fact label="PHASE">{state.status ? phaseLabel(state.status.phase) : "Unset"}</Fact>
      <Fact label="ROLE">{state.me ? ROLE_LABELS[state.me.role] : "Unknown"}</Fact>
      <Fact label="ELAPSED">
        {elapsed === null ? "Opens with the browser clock" : formatSince(elapsed)}
      </Fact>
      <Fact label="NEXT DEADLINE">
        {deadlines === null ? (
          "Opens with the browser clock"
        ) : urgent ? (
          <span className={urgentLead?.endsWith("overdue") ? "text-alert" : undefined}>
            {urgent.rule.citation}
            {urgentLead ? ` · ${urgentLead}` : ""}
          </span>
        ) : (
          "None scheduled"
        )}
      </Fact>
      <Fact label="ROOM">
        {state.members.length} in the room
        {waiting > 0 ? ` · ${waiting} waiting` : ""}
      </Fact>
      <Fact label="INTEGRITY">
        <IntegrityMark report={state.integrity} mock={mock} />
      </Fact>
      <Fact label="CONNECTION">{connectionLabel(state.connection, mock)}</Fact>
    </section>
  );
}
