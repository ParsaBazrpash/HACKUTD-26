"use client";

import { CircleAlert, CircleCheck, CircleMinus, Shield } from "lucide-react";
import { AdmissionControls } from "@/components/incidents/admission-controls";
import { InviteControls } from "@/components/incidents/invite-controls";
import { useIncident } from "@/hooks/use-incident";
import { isMockIncidentClient } from "@/lib/client";
import type { IncidentState, MemberView } from "@/lib/client/types";

type CheckTone = "ok" | "muted" | "alert";

type CheckRow = {
  label: string;
  detail: string;
  tone: CheckTone;
};

function certificateRow(members: readonly MemberView[], mock: boolean, rosterFailures: number): CheckRow {
  if (mock) {
    return { label: "Admission certificate", detail: "Demo roster. Certificates are not checked.", tone: "ok" };
  }
  const active = members.filter((member) => member.state === "active");
  if (active.length === 0) {
    return { label: "Admission certificate", detail: "No active members yet.", tone: "muted" };
  }
  const unverified = active.filter((member) => !member.verified).length;
  if (unverified === 0 && rosterFailures === 0) {
    return { label: "Admission certificate", detail: "Verified for all active members", tone: "ok" };
  }
  if (rosterFailures > 0) {
    return { label: "Admission certificate", detail: "Roster check failed", tone: "alert" };
  }
  const detail =
    unverified === 1 ? "1 active member is not checked" : `${unverified} active members are not checked`;
  return { label: "Admission certificate", detail, tone: "alert" };
}

function safetyRow(members: readonly MemberView[], mock: boolean): CheckRow {
  const pending = members.filter((member) => member.state === "pending").length;
  if (pending > 0) {
    const detail =
      pending === 1 ? "1 person is waiting on a voice check" : `${pending} people are waiting on a voice check`;
    return { label: "Safety code", detail, tone: "muted" };
  }
  if (mock) {
    return { label: "Safety code", detail: "Demo codes. They are not derived from keys.", tone: "ok" };
  }
  return { label: "Safety code", detail: "Compared by voice before admission", tone: "ok" };
}

function connectionRow(connection: IncidentState["connection"], mock: boolean): CheckRow {
  if (mock && connection === "ready") return { label: "Connection", detail: "Demo session", tone: "ok" };
  if (connection === "ready") return { label: "Connection", detail: "Encrypted session", tone: "ok" };
  if (connection === "connecting") return { label: "Connection", detail: "Connecting", tone: "muted" };
  if (connection === "offline") return { label: "Connection", detail: "Offline", tone: "alert" };
  return { label: "Connection", detail: "Connection error", tone: "alert" };
}

export function RoomAccessCard() {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const rows = [
    certificateRow(state.members, mock, state.integrity.rosterFailures.length),
    safetyRow(state.members, mock),
    connectionRow(state.connection, mock),
  ];

  return (
    <section className="rounded-xl border border-line bg-panel p-5" aria-labelledby="access-checks-heading">
      <div className="flex items-start gap-3">
        <Shield aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />
        <div className="min-w-0">
          <h2 id="access-checks-heading" className="text-base font-semibold tracking-tight">
            Access controls
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">Verification and security checks for room access.</p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((row) => {
          const Icon = row.tone === "alert" ? CircleAlert : row.tone === "ok" ? CircleCheck : CircleMinus;
          const iconClass = row.tone === "alert" ? "text-alert" : row.tone === "ok" ? "text-verified" : "text-muted";
          return (
            <li key={row.label} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="inline-flex items-center gap-2 text-sm text-foreground">
                <Icon aria-hidden="true" className={`size-4 shrink-0 ${iconClass}`} />
                {row.label}
              </span>
              <span className="text-sm text-muted sm:text-right">{row.detail}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AccessControls({ showAdmission = true }: { showAdmission?: boolean }) {
  const state = useIncident();
  if (!state.me || state.me.role !== "commander" || state.me.state !== "active") return null;
  const pending = state.members.some((member) => member.state === "pending");
  return (
    <div className="grid gap-4">
      {showAdmission && pending ? <AdmissionControls members={state.members} me={state.me} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <InviteControls />
        <RoomAccessCard />
      </div>
    </div>
  );
}
