"use client";

import { useState } from "react";
import { ROLE_LABELS } from "@/components/incidents/labels";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { MemberView } from "@/lib/client/types";
import { admitEnabled, linkVerifiedLabel } from "@/components/incidents/room-controls";

const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function AdmissionControls({ members, me }: { members: MemberView[]; me: MemberView }) {
  const mock = isMockIncidentClient();
  const pending = members.filter((member) => member.state === "pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [admittedName, setAdmittedName] = useState<string | null>(null);
  const commander = me.role === "commander" && me.state === "active";
  if (!commander) return null;

  async function admit(member: MemberView) {
    if (!admitEnabled(me, member)) return;
    const id = member.memberId.toString();
    setBusyId(id);
    setError(null);
    setAdmittedName(null);
    try {
      await getIncidentClient().admitMember(member.memberId);
      setAdmittedName(member.displayName);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-labelledby="admission-heading">
      <h2 id="admission-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        WAITING FOR ADMISSION
      </h2>
      {admittedName ? (
        <p role="status" className="mt-3 text-sm text-verified">
          Admitted {admittedName}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-alert">
          {error}
        </p>
      ) : null}
      {pending.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No one is waiting for admission.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {pending.map((member) => {
            const id = member.memberId.toString();
            const enabled = admitEnabled(me, member);
            return (
              <li key={id} className="rounded-xl border border-line bg-panel-raised px-4 py-3">
                <p className="text-sm text-foreground">
                  {member.displayName}
                  <span className="text-muted"> · {ROLE_LABELS[member.role]}</span>
                </p>
                <p translate="no" className="mt-2 font-mono text-xs text-muted">
                  Safety code {member.safetyCode ?? "unavailable"}
                </p>
                <p translate="no" className="mt-1 break-all font-mono text-[11px] text-muted">
                  Fingerprint {member.fingerprint}
                </p>
                <p
                  className={`mt-2 text-xs ${
                    member.linkVerified === true
                      ? "text-verified"
                      : member.linkVerified === false
                        ? "text-alert"
                        : "text-muted"
                  }`}
                >
                  {linkVerifiedLabel(member.linkVerified)}
                </p>
                {mock && member.linkVerified === true ? (
                  <p className="mt-1 text-xs text-muted">
                    Demo token matched. This is not a cryptographic link check.
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={!enabled || busyId === id}
                  onClick={() => void admit(member)}
                  className={`${primaryButtonClass} mt-3`}
                >
                  {busyId === id ? "Admitting…" : "Admit"}
                </button>
                {enabled ? null : (
                  <p className="mt-2 text-xs text-muted">Admit stays off until the link is verified.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
