"use client";

import { useSyncExternalStore } from "react";
import { DemoBanner } from "@/components/incidents/demo-banner";
import { BreakGlassCard } from "@/components/org/break-glass-card";
import { CreateOrgForm } from "@/components/org/create-org-form";
import { EnrollLinkPanel } from "@/components/org/enroll-link-panel";
import { LeaveOrg } from "@/components/org/leave-org";
import { RosterBoard } from "@/components/org/roster-board";
import { useIncident } from "@/hooks/use-incident";

const noopSubscribe = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

function useOrigin(): string {
  return useSyncExternalStore(noopSubscribe, clientOrigin, serverOrigin);
}

export function OrgView() {
  const origin = useOrigin();
  const state = useIncident();
  const { org } = state;
  const waiting = org === null ? state.roster.find((member) => member.state === "pending" || member.state === "active") : undefined;
  return (
    <div className="grid gap-5">
      <DemoBanner />
      {state.connection === "error" ? (
        <p role="alert" className="text-sm text-alert">
          {state.error ?? "Could not connect."}
        </p>
      ) : null}
      {org === null && state.connection !== "connecting" ? (
        <>
          {waiting ? (
            <section className="grid gap-3 rounded-2xl border border-line bg-panel px-4 py-4" aria-label="Your enrollment">
              <p className="text-sm font-medium">{waiting.displayName}</p>
              <LeaveOrg
                confirmText={waiting.displayName}
                detail="You have an enrollment that is not active yet. Leave it, or create a new org below."
              />
            </section>
          ) : null}
          <CreateOrgForm />
        </>
      ) : null}
      {org ? (
        <>
          <section className="no-print rounded-2xl border border-line bg-panel px-4 py-4" aria-label="Org">
            <p className="text-lg font-medium">{org.name}</p>
            <p className="mt-2 text-xs text-muted">Admin fingerprint</p>
            <p translate="no" className="break-all font-mono text-xs">
              {org.adminFingerprint}
            </p>
            <div className="mt-4 border-t border-line pt-4">
              <LeaveOrg
                confirmText={org.name}
                detail="Leave this org on this device. After you leave, you can create a new one. If you are the admin, everyone else stays on the roster, but nobody can approve people, revoke them, or make enrollment links."
              />
            </div>
          </section>
          {org.myRole === "admin" ? (
            <>
              <EnrollLinkPanel />
              <RosterBoard roster={state.roster} pages={state.pages} adminFingerprint={org.adminFingerprint} />
            </>
          ) : (
            <p className="text-sm leading-6 text-muted">Only the org admin can manage the roster.</p>
          )}
          {origin ? (
            <BreakGlassCard orgName={org.name} address={origin} adminFingerprint={org.adminFingerprint} instructions={false} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
