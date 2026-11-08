"use client";

import { AdmissionControls } from "@/components/incidents/admission-controls";
import { InviteControls } from "@/components/incidents/invite-controls";
import { useIncident } from "@/hooks/use-incident";

export function AccessControls() {
  const state = useIncident();
  if (!state.me || state.me.role !== "commander" || state.me.state !== "active") return null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <InviteControls />
      <AdmissionControls members={state.members} me={state.me} />
    </div>
  );
}
