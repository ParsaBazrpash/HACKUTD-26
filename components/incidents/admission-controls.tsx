"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { ROLE_LABELS } from "@/components/incidents/labels";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { MemberView } from "@/lib/client/types";
import { canAdmitNow, linkVerifiedLabel } from "@/components/incidents/room-controls";

const DECLINE_REASON = "Admission declined.";

const iconButtonClass =
  "grid size-9 place-items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-40";

export function AdmissionControls({ members, me }: { members: MemberView[]; me: MemberView }) {
  const mock = isMockIncidentClient();
  const pending = members.filter((member) => member.state === "pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const commander = me.role === "commander" && me.state === "active";
  if (!commander) return null;

  async function admit(member: MemberView) {
    const id = member.memberId.toString();
    if (!canAdmitNow(me, member, confirmed[id] === true)) return;
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await getIncidentClient().admitMember(member.memberId);
      setNotice(`Admitted ${member.displayName}.`);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function decline(member: MemberView) {
    if (member.state !== "pending") return;
    const id = member.memberId.toString();
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await getIncidentClient().revokeMember(member.memberId, DECLINE_REASON);
      setNotice(`Declined ${member.displayName}.`);
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
      {notice ? (
        <p role="status" className="mt-3 text-sm text-verified">
          {notice}
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
            const confirmedCode = confirmed[id] === true;
            const enabled = canAdmitNow(me, member, confirmedCode);
            return (
              <li key={id} className="rounded-xl border border-line bg-panel-raised px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm text-foreground">
                    {member.displayName}
                    <span className="text-muted"> · {ROLE_LABELS[member.role]}</span>
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={!enabled || busyId === id}
                      aria-label={`Admit ${member.displayName}`}
                      onClick={() => void admit(member)}
                      className={`${iconButtonClass} bg-signal text-signal-ink hover:bg-signal-hover`}
                    >
                      <Check aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === id}
                      aria-label={`Reject ${member.displayName}`}
                      onClick={() => void decline(member)}
                      className={`${iconButtonClass} border border-line text-muted hover:border-alert hover:text-alert`}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </div>
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
                <label className="mt-3 flex items-start gap-2 text-sm text-foreground" htmlFor={`confirm-${id}`}>
                  <input
                    id={`confirm-${id}`}
                    type="checkbox"
                    checked={confirmedCode}
                    onChange={(event) => setConfirmed((prev) => ({ ...prev, [id]: event.target.checked }))}
                    className="mt-1 h-4 w-4"
                  />
                  <span>I confirmed this safety code with {member.displayName} by voice or in person.</span>
                </label>
                {enabled ? null : (
                  <p className="mt-2 text-xs text-muted">
                    The check stays off until the link is verified and you confirm the safety code.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
