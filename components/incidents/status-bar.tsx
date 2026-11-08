"use client";

import type { ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { connectionLabel, phaseLabel, ROLE_LABELS } from "@/components/incidents/labels";
import { isMockIncidentClient } from "@/lib/client";
import type { IncidentState } from "@/lib/client/types";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium tracking-[0.16em] text-muted">{label}</p>
      <div className="mt-1.5 text-sm text-foreground">{children}</div>
    </div>
  );
}

function severityBadgeClass(severity: string | undefined): string {
  if (severity === "SEV1") return "border-alert text-alert";
  if (severity === "SEV2") return "border-signal text-signal";
  return "border-line text-foreground";
}

export function StatusBar({ state }: { state: IncidentState }) {
  const mock = isMockIncidentClient();
  const severity = state.status?.severity;

  return (
    <section
      aria-label="Incident status"
      className="flex flex-wrap items-start gap-x-6 gap-y-4 lg:border-l lg:border-line lg:pl-8"
    >
      <Fact label="SEVERITY">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${severityBadgeClass(severity)}`}
        >
          {severity ?? "Unset"}
        </span>
      </Fact>
      <Fact label="PHASE">{state.status ? phaseLabel(state.status.phase) : "Unset"}</Fact>
      <Fact label="ROLE">{state.me ? ROLE_LABELS[state.me.role] : "Unknown"}</Fact>
      <Fact label="INTEGRITY">
        {state.integrity.ok ? (
          <span className="inline-flex items-center gap-1.5 text-verified">
            <CircleCheck aria-hidden="true" className="size-4" />
            Checked
          </span>
        ) : (
          <span className="text-alert">Failed</span>
        )}
      </Fact>
      <Fact label="CONNECTION">{connectionLabel(state.connection, mock)}</Fact>
    </section>
  );
}
