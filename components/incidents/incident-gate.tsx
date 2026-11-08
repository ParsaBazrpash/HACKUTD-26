"use client";

import type { ReactNode } from "react";
import type { IncidentState } from "@/lib/client/types";
import { incidentAccess } from "@/lib/report";

export function IncidentGate({ state, children }: { state: IncidentState; children: ReactNode }) {
  const access = incidentAccess(state);
  if (access.phase === "loading") return <p className="text-sm text-muted">{access.message}</p>;
  if (access.phase === "error") {
    return (
      <p role="alert" className="text-sm text-alert">
        {access.message}
      </p>
    );
  }
  if (access.phase === "denied") return <p className="text-sm leading-6 text-muted">{access.message}</p>;
  return children;
}
