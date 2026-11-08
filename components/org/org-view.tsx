"use client";

import { DemoBanner } from "@/components/incidents/demo-banner";
import { CreateOrgForm } from "@/components/org/create-org-form";
import { EnrollLinkPanel } from "@/components/org/enroll-link-panel";
import { RosterBoard } from "@/components/org/roster-board";
import { useIncident } from "@/hooks/use-incident";

export function OrgView() {
  const state = useIncident();
  const { org } = state;
  return (
    <div className="grid gap-5">
      <DemoBanner />
      {state.connection === "error" ? (
        <p role="alert" className="text-sm text-alert">
          {state.error ?? "Could not connect."}
        </p>
      ) : null}
      {org === null && state.connection !== "connecting" ? <CreateOrgForm /> : null}
      {org ? (
        <>
          <section className="no-print rounded-2xl border border-line bg-panel px-4 py-4" aria-label="Org">
            <p className="text-lg font-medium">{org.name}</p>
            <p className="mt-2 text-xs text-muted">Admin fingerprint</p>
            <p translate="no" className="break-all font-mono text-xs">
              {org.adminFingerprint}
            </p>
          </section>
          {org.myRole === "admin" ? (
            <>
              <EnrollLinkPanel />
              <RosterBoard roster={state.roster} pages={state.pages} adminFingerprint={org.adminFingerprint} />
            </>
          ) : (
            <p className="text-sm leading-6 text-muted">Only the org admin can manage the roster.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
