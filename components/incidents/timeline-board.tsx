"use client";

import { ImportPanel } from "@/components/incidents/import-panel";
import { TimelineForm } from "@/components/incidents/timeline-form";
import { TimelineList } from "@/components/incidents/timeline-list";
import { useIncident } from "@/hooks/use-incident";

export function TimelineBoard() {
  const state = useIncident();
  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Timeline</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          #record is the structured event log. Entries preserve phase, CSF tag, signed time, and server time.
        </p>
      </div>
      <ImportPanel />
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
        <TimelineForm />
        <TimelineList items={state.timeline} detailed />
      </div>
    </div>
  );
}
