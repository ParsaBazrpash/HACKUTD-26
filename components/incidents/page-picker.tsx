"use client";

import { useState } from "react";
import {
  FormError,
  FormStatus,
  fieldClass,
  primaryButtonClass,
} from "@/components/incidents/form-ui";
import { ROLE_LABELS } from "@/components/incidents/labels";
import { canPage, identitiesInRoom, isPickRole, notInIncident, pickCheck, type PickRole } from "@/components/incidents/paging";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";

/** Commander-only "Page responders": pick roster people, add them, call them. */
export function PagePicker() {
  const state = useIncident();
  const [picked, setPicked] = useState<Set<bigint>>(new Set());
  const [roles, setRoles] = useState<Record<string, PickRole>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!canPage(state)) return null;

  const inIncident = identitiesInRoom(state.members, state.roster);
  const candidates = notInIncident(state.roster, inIncident);

  function toggle(id: bigint) {
    setPicked((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addAndPage() {
    const ids = candidates
      .filter((member) => picked.has(member.orgMemberId) && pickCheck(member, state.members).pickable)
      .map((member) => member.orgMemberId);
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const client = getIncidentClient();
    try {
      await client.addFromRoster(ids.map((id) => ({ orgMemberId: id, role: roles[id.toString()] ?? "technical" })));
    } catch (cause) {
      setError(clientErrorMessage(cause));
      setBusy(false);
      return;
    }
    setPicked(new Set());
    try {
      await client.page(ids);
      setNotice(`Added and paging ${ids.length}.`);
    } catch (cause) {
      setError(`Added ${ids.length}, but the page did not go out: ${clientErrorMessage(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  const selected = candidates.filter((m) => picked.has(m.orgMemberId) && pickCheck(m, state.members).pickable).length;

  return (
    <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-labelledby="page-picker-heading">
      <h2 id="page-picker-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        PAGE RESPONDERS
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        Pick people from your org roster. HAVEN adds them to this room and calls their personal phones.
      </p>
      {candidates.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Everyone on the roster is already in this room.</p>
      ) : (
        <ul className="mt-3 grid gap-3" aria-label="Roster members not in this room">
          {candidates.map((member) => {
            const id = member.orgMemberId.toString();
            const check = pickCheck(member, state.members);
            return (
              <li key={id} className="grid min-w-0 gap-2 rounded-xl border border-line px-4 py-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id={`page-pick-${id}`}
                    checked={check.pickable && picked.has(member.orgMemberId)}
                    disabled={!check.pickable}
                    onChange={() => toggle(member.orgMemberId)}
                    aria-label={`Pick ${member.displayName}`}
                    className="mt-1 size-5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{member.displayName}</p>
                    {check.pickable ? null : <p className="mt-1 text-xs text-muted">{check.reason}</p>}
                  </div>
                </div>
                {check.pickable ? (
                  <label className="grid gap-1 text-xs text-muted" htmlFor={`page-role-${id}`}>
                    Role in this room
                    <select
                      id={`page-role-${id}`}
                      value={roles[id] ?? "technical"}
                      onChange={(event) => {
                        if (isPickRole(event.target.value)) {
                          const role = event.target.value;
                          setRoles((prior) => ({ ...prior, [id]: role }));
                        }
                      }}
                      className={fieldClass}
                    >
                      <option value="counsel">{ROLE_LABELS.counsel}</option>
                      <option value="technical">{ROLE_LABELS.technical}</option>
                      <option value="executive">{ROLE_LABELS.executive}</option>
                    </select>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 grid gap-2">
        <button
          type="button"
          disabled={busy || selected === 0}
          onClick={() => void addAndPage()}
          className={`${primaryButtonClass} w-fit`}
        >
          {busy ? "Working…" : selected > 0 ? `Add and page ${selected}` : "Add and page"}
        </button>
        <FormError message={error} />
        <FormStatus message={notice} />
      </div>
    </section>
  );
}
