"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { IncidentGate } from "@/components/incidents/incident-gate";
import { ReportSheet } from "@/components/incidents/report-sheet";
import { useLocalClock } from "@/components/local-time";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { isMockIncidentClient } from "@/lib/client";
import { buildIncidentReport } from "@/lib/report";

const exportButtonClass =
  "inline-flex min-h-10 items-center gap-2 rounded-full bg-signal px-4 text-sm font-medium text-signal-ink hover:bg-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function ReportView() {
  const state = useIncident();
  const now = useBrowserNow();
  const clockReady = useLocalClock();
  const [includePrivileged, setIncludePrivileged] = useState(false);
  const report = !clockReady
    ? null
    : now === null
      ? buildIncidentReport(state, { now: null, includePrivileged, demo: isMockIncidentClient(), buildSha: readBuildSha() })
      : buildIncidentReport(state, {
          now: new Date(now),
          includePrivileged,
          demo: isMockIncidentClient(),
          buildSha: readBuildSha(),
        });

  return (
    <IncidentGate state={state}>
      {report ? (
        <div className="min-w-0">
          <div className="no-print flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">Incident Report</h2>
              <p className="mt-2 text-sm text-muted">A formal record of the incident and response.</p>
            </div>
            <button type="button" onClick={() => window.print()} className={exportButtonClass}>
              <Download aria-hidden="true" className="size-4" />
              Export PDF
            </button>
          </div>
          {report.privileged.offered ? (
            <label className="no-print mt-6 flex max-w-xl items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-signal"
                checked={includePrivileged}
                onChange={(event) => setIncludePrivileged(event.target.checked)}
              />
              <span>
                Include attorney-client privileged messages
                <span className="mt-1 block text-muted">
                  This adds a PRIVILEGED / CONFIDENTIAL watermark. Only messages from the privileged channel already open in this client are added.
                </span>
              </span>
            </label>
          ) : null}
          <div className="overflow-x-auto print:overflow-visible">
            <ReportSheet report={report} pages={state.pages} commander={state.incident?.commander.displayName ?? null} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Opening the incident…</p>
      )}
    </IncidentGate>
  );
}

function readBuildSha(): string | null {
  const value = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim() ?? "";
  if (!/^[0-9a-f]{7,64}$/i.test(value)) return null;
  return value.toLowerCase();
}
