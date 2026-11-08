"use client";

import { TimelineForm } from "@/components/incidents/timeline-form";
import { TimelineList } from "@/components/incidents/timeline-list";
import { useIncident } from "@/hooks/use-incident";

export function TimelineBoard() {
  const state = useIncident();
  return (
    <div className="grid min-w-0 gap-8">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Timeline</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          #record is the structured event log. It is not a chat channel. Entries keep their phase, CSF tag, signed
          time, and server time.
        </p>
      </div>
      <TimelineList items={state.timeline} detailed />
      <TimelineForm />
    </div>
  );
}
