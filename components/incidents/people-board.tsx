"use client";

import { ImHereButton, PagingStatus } from "@/components/incidents/paging-status";
import { PagePicker } from "@/components/incidents/page-picker";
import { AccessControls } from "@/components/incidents/access-controls";
import { memberStateLabel, ROLE_LABELS } from "@/components/incidents/labels";
import { linkVerifiedLabel } from "@/components/incidents/room-controls";
import { useIncident } from "@/hooks/use-incident";
import { isMockIncidentClient } from "@/lib/client";
import { LocalTime } from "@/components/local-time";

export function PeopleBoard() {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const commander = state.me?.role === "commander" && state.me.state === "active";

  return (
    <div className="grid min-w-0 gap-8">
      <div>
        <h2 className="text-xl font-medium tracking-tight">People and access</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          {state.me ? `You are in this room as ${ROLE_LABELS[state.me.role]}. ` : ""}
          Roles come from the invite and the commander&apos;s admission.
        </p>
      </div>
      <ImHereButton />
      {commander ? (
        <>
          <PagePicker />
          <PagingStatus />
        </>
      ) : null}
      <ul className="divide-y divide-line border-y border-line">
        {state.members.map((member) => (
          <li key={member.identity} className="min-w-0 py-4">
            <p className="break-words text-sm text-foreground">
              {member.displayName}
              <span className="text-muted"> · {ROLE_LABELS[member.role]}</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {memberStateLabel(member.state)}
              {member.online ? " · Online" : ""}
              <LocalTime value={member.joinedAt} prefix=" · joined " />
            </p>
            <p className="mt-2 break-all font-mono text-[11px] text-muted" title={member.fingerprint}>
              {member.fingerprint}
              {mock ? " · Demo fingerprint" : ""}
            </p>
            {member.verified ? (
              <p className="mt-2 text-xs text-verified">Admission certificate checked</p>
            ) : mock ? (
              <p className="mt-2 text-xs text-muted">Demo roster. Certificates are not checked.</p>
            ) : (
              <p className="mt-2 text-xs text-muted">Certificate not checked</p>
            )}
            {member.state === "pending" ? (
              <p className={`mt-2 text-xs ${member.linkVerified === false ? "text-alert" : "text-muted"}`}>
                {linkVerifiedLabel(member.linkVerified)}
                {mock && member.linkVerified === true
                  ? ". Demo token matched. This is not a cryptographic link check."
                  : ""}
              </p>
            ) : null}
            {member.safetyCode ? (
              <p className="mt-2 break-words font-mono text-[11px] text-muted">
                Safety code {member.safetyCode}
                {mock ? " · Demo code" : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {commander ? (
        <AccessControls />
      ) : (
        <p className="text-sm text-muted">Invites and admission are limited to the commander.</p>
      )}
    </div>
  );
}
