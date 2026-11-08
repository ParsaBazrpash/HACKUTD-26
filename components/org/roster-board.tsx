"use client";

import { useState } from "react";
import { FormError, FormStatus, fieldClass, primaryButtonClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import { ROLE_LABELS } from "@/components/incidents/labels";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { PageView, RosterMember } from "@/lib/client/types";
import { LocalTime } from "@/components/local-time";
import { MAX_ORG_REASON } from "@/spacetimedb/src/shared/org";

type PickRole = "counsel" | "technical" | "executive";

const STATE_LABEL: Record<RosterMember["state"], string> = {
  pending: "Waiting for approval",
  active: "Approved",
  revoked: "Revoked",
};

const PAGE_LABEL: Record<PageView["status"], string> = {
  requested: "Requested",
  calling: "Calling",
  ringing: "Ringing",
  acknowledged: "Acknowledged",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Failed",
};

function latestPages(pages: PageView[]): Map<bigint, PageView> {
  const map = new Map<bigint, PageView>();
  for (const page of pages) {
    const prior = map.get(page.orgMemberId);
    if (!prior || prior.updatedAt <= page.updatedAt) map.set(page.orgMemberId, page);
  }
  return map;
}

function KeyChangedAlert() {
  return (
    <p role="alert" className="text-sm text-alert">
      This person&apos;s key changed. Confirm with them in person before you trust it.
    </p>
  );
}

function PendingCard({ member, onDone }: { member: RosterMember; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "approve" | "decline") {
    setBusy(true);
    setError(null);
    try {
      if (kind === "approve") {
        await getIncidentClient().approveMember(member.orgMemberId);
        onDone(`Approved ${member.displayName}.`);
      } else {
        await getIncidentClient().revokeOrgMember(member.orgMemberId, "Enrollment declined.");
        onDone(`Declined ${member.displayName}.`);
      }
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-3 rounded-xl border border-signal px-4 py-3">
      <div>
        <p className="text-sm font-medium">{member.displayName}</p>
        <p className="text-xs text-muted">
          Enrolled <LocalTime value={member.enrolledAt} />
        </p>
      </div>
      <div>
        <p className="text-xs text-muted">Safety code</p>
        <p translate="no" className="font-mono text-2xl tracking-widest">
          {member.safetyCode}
        </p>
        <p translate="no" className="mt-1 break-all font-mono text-xs text-muted">
          {member.fingerprint}
        </p>
      </div>
      {member.keyChanged ? <KeyChangedAlert /> : null}
      <p className="text-sm leading-6 text-muted">
        Approve only after they read this code to you on a call or in person.
      </p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void act("approve")} className={primaryButtonClass}>
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => void act("decline")} className={secondaryButtonClass}>
          Decline
        </button>
      </div>
    </li>
  );
}

function RevokeControl({ member, onDone }: { member: RosterMember; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await getIncidentClient().revokeOrgMember(member.orgMemberId, reason.trim());
      setOpen(false);
      setReason("");
      onDone(`Revoked ${member.displayName}.`);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Revoke
      </button>
    );
  }
  return (
    <div className="grid w-full gap-2">
      <label className="grid gap-1 text-sm" htmlFor={`revoke-${member.orgMemberId}`}>
        Reason for revoking {member.displayName}
        <input
          id={`revoke-${member.orgMemberId}`}
          value={reason}
          maxLength={MAX_ORG_REASON}
          onChange={(event) => setReason(event.target.value)}
          className={fieldClass}
        />
      </label>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !reason.trim()} onClick={() => void revoke()} className={primaryButtonClass}>
          Revoke access
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClass}>
          Keep
        </button>
      </div>
    </div>
  );
}

export function RosterBoard({
  roster,
  pages,
  adminFingerprint,
}: {
  roster: RosterMember[];
  pages: PageView[];
  adminFingerprint: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<bigint>>(new Set());
  const [roles, setRoles] = useState<Record<string, PickRole>>({});
  const [busy, setBusy] = useState(false);
  const pending = roster.filter((member) => member.state === "pending");
  const byMember = latestPages(pages);

  function toggle(id: bigint) {
    setPicked((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function callOne(member: RosterMember) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await getIncidentClient().page([member.orgMemberId]);
      setNotice(`Paging ${member.displayName}.`);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function run(kind: "add" | "page") {
    if (picked.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const eligible = new Set(roster.filter((m) => m.state === "active" && !m.keyChanged).map((m) => m.orgMemberId));
    const ids = [...picked].filter((id) => eligible.has(id));
    if (ids.length === 0) {
      setBusy(false);
      return;
    }
    try {
      const client = getIncidentClient();
      if (kind === "add") {
        await client.addFromRoster(ids.map((id) => ({ orgMemberId: id, role: roles[id.toString()] ?? "technical" })));
        setNotice(`Added ${ids.length} to the incident.`);
      } else {
        await client.page(ids);
        setNotice(`Paging ${ids.length}.`);
      }
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="no-print grid gap-4 rounded-2xl border border-line bg-panel px-4 py-4" aria-labelledby="roster-heading">
      <h2 id="roster-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        ROSTER
      </h2>
      {pending.length > 0 ? (
        <ul className="grid gap-3" aria-label="Waiting for approval">
          {pending.map((member) => (
            <PendingCard key={member.orgMemberId.toString()} member={member} onDone={setNotice} />
          ))}
        </ul>
      ) : null}
      <ul className="grid gap-3" aria-label="Org members">
        {roster
          .filter((member) => member.state !== "pending")
          .map((member) => {
            const id = member.orgMemberId.toString();
            const page = byMember.get(member.orgMemberId);
            const active = member.state === "active";
            const pickable = active && !member.keyChanged;
            const isAdmin = member.fingerprint === adminFingerprint;
            return (
              <li key={id} className="grid gap-2 rounded-xl border border-line px-4 py-3">
                <div className="flex items-start gap-3">
                  {pickable ? (
                    <input
                      type="checkbox"
                      id={`pick-${id}`}
                      checked={picked.has(member.orgMemberId)}
                      onChange={() => toggle(member.orgMemberId)}
                      aria-label={`Pick ${member.displayName}`}
                      className="mt-1 size-5 shrink-0"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{member.displayName}</p>
                    <p className="text-xs text-muted">
                      {STATE_LABEL[member.state]}. Enrolled <LocalTime value={member.enrolledAt} />.
                    </p>
                    <p translate="no" className="mt-1 break-all font-mono text-xs text-muted">
                      {member.fingerprint}
                    </p>
                    {member.keyChanged ? (
                      <div className="mt-1">
                        <KeyChangedAlert />
                        <p className="text-xs text-muted">They cannot be added or paged until this is resolved.</p>
                      </div>
                    ) : null}
                    {page ? (
                      <p className="mt-1 text-xs text-muted">
                        Page: {PAGE_LABEL[page.status]}
                        {page.joined ? ", joined" : ""}
                        {page.carrierReported ? "" : " (not yet confirmed by the carrier)"}
                      </p>
                    ) : null}
                  </div>
                </div>
                {active ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="grid gap-1 text-xs text-muted" htmlFor={`role-${id}`}>
                      Role in the incident
                      <select
                        id={`role-${id}`}
                        value={roles[id] ?? "technical"}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "counsel" || value === "technical" || value === "executive") {
                            setRoles((prior) => ({ ...prior, [id]: value }));
                          }
                        }}
                        className={fieldClass}
                      >
                        <option value="counsel">{ROLE_LABELS.counsel}</option>
                        <option value="technical">{ROLE_LABELS.technical}</option>
                        <option value="executive">{ROLE_LABELS.executive}</option>
                      </select>
                    </label>
                    {pickable ? (
                      <button type="button" disabled={busy} onClick={() => void callOne(member)} className={secondaryButtonClass}>
                        {page ? "Retry call" : "Call"}
                      </button>
                    ) : null}
                    {isAdmin ? null : <RevokeControl member={member} onDone={setNotice} />}
                  </div>
                ) : null}
              </li>
            );
          })}
        {roster.length === 0 ? <li className="text-sm text-muted">Nobody is enrolled yet.</li> : null}
      </ul>
      <div className="grid gap-2 border-t border-line pt-4">
        <p className="text-sm text-muted">
          Pick approved people, add them to the open incident, then page them on their personal phones.
          {picked.size > 0 ? ` ${picked.size} picked.` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || picked.size === 0} onClick={() => void run("add")} className={secondaryButtonClass}>
            Add to incident
          </button>
          <button type="button" disabled={busy || picked.size === 0} onClick={() => void run("page")} className={primaryButtonClass}>
            Page picked
          </button>
        </div>
        <FormError message={error} />
        <FormStatus message={notice} />
      </div>
    </section>
  );
}
