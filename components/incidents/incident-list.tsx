"use client";

import Link from "next/link";
import { useIncidentList } from "@/hooks/use-incident-data";
import { formatTimestamp } from "@/lib/time";
import { CHANNEL_KIND_LABELS, INCIDENT_STATUS_LABELS } from "@/types/common";
import type { IncidentStatus } from "@/types/common";

function statusClass(status: IncidentStatus): string {
  if (status === "active") return "text-signal";
  if (status === "contained") return "text-verified";
  return "text-muted";
}

export function IncidentList() {
  const { incidents, client, error, mode } = useIncidentList();

  if (error || mode === "unavailable") {
    return (
      <p role="alert" className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-alert">
        {error ?? "The incident client is unavailable."}
      </p>
    );
  }

  if (mode === "spacetimedb") {
    return (
      <p className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
        SpacetimeDB is selected, and the module is not connected. No incident data was requested.
      </p>
    );
  }

  return (
    <div>
      <p className="rounded-xl border border-line bg-panel-raised px-4 py-3 text-sm text-muted">
        In-memory prototype. Nothing on this page is subscribed to SpacetimeDB, and no narrative is stored.
      </p>
      {incidents.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No shells are loaded on this client.</p>
      ) : (
        <ul className="mt-6 border-t border-line">
          {incidents.map((incident) => {
            const snapshot = client?.getSnapshot(incident.id);
            const channels = snapshot?.channels.map((channel) => CHANNEL_KIND_LABELS[channel.kind]) ?? [];
            return (
              <li key={incident.id} className="border-b border-line">
                <Link
                  href={`/incidents/${incident.id}`}
                  className="grid gap-2 px-1 py-4 transition-colors hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:grid-cols-[7.5rem_10rem_1fr_auto] sm:items-center"
                >
                  <span className={`font-mono text-xs tracking-[0.14em] uppercase ${statusClass(incident.status)}`}>
                    {INCIDENT_STATUS_LABELS[incident.status]}
                  </span>
                  <span className="font-mono text-sm">{incident.id}</span>
                  <span className="text-sm text-muted">
                    {formatTimestamp(incident.startedAt)}
                    <span className="mt-1 block text-foreground sm:mt-0 sm:ml-3 sm:inline">
                      {channels.join(" · ")}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {snapshot?.members.length ?? 0} members
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
