"use client";

import { useState, type FormEvent } from "react";
import { Denied, fieldClass, FormError, FormStatus, primaryButtonClass } from "@/components/incidents/form-ui";
import { ROLE_LABELS } from "@/components/incidents/labels";
import {
  canAuthorRecord,
  draftDeadline,
  draftDiscovery,
  recordDenial,
  toDatetimeLocalValue,
} from "@/components/incidents/record-actions";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { MemberView } from "@/lib/client/types";
import { DEADLINE_STATUSES } from "@/lib/protocol/events";

const RECORDED_LABELS: Record<(typeof DEADLINE_STATUSES)[number], string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  not_applicable: "Not applicable",
};

export function LegalWriteNote() {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "legal.discovery");
  if (allowed) return null;
  return <Denied>{recordDenial("legal.discovery")}</Denied>;
}

export function DeterminationForm({
  kind,
  determinedAt,
  basis,
  onSaved,
}: {
  kind: "legal.discovery" | "legal.materiality";
  determinedAt?: Date;
  basis?: string;
  onSaved?: (message: string) => void;
}) {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, kind);
  const discovery = kind === "legal.discovery";
  const [time, setTime] = useState(determinedAt ? toDatetimeLocalValue(determinedAt) : "");
  const [text, setText] = useState(basis ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const timeId = discovery ? "discovery-time" : "materiality-time";
  const basisId = discovery ? "discovery-basis" : "materiality-basis";
  const title = discovery ? "Record discovery" : "Record materiality";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, kind)) {
      setError(recordDenial(kind));
      setSaved(null);
      return;
    }
    const draft = draftDiscovery({ determinedAt: time, basis: text });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const client = getIncidentClient();
      if (discovery) await client.recordDiscovery(draft.body);
      else await client.recordMateriality(draft.body);
      const message = discovery ? "Discovery recorded." : "Materiality recorded.";
      setSaved(message);
      onSaved?.(message);
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed) return null;

  return (
    <form onSubmit={submit} className="no-print grid gap-3" aria-label={title}>
      <h4 className="text-sm font-medium">{title}</h4>
      <label className="grid gap-2 text-sm" htmlFor={timeId}>
        Determination time
        <input
          id={timeId}
          type="datetime-local"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className={fieldClass}
          required
        />
      </label>
      <label className="grid gap-2 text-sm" htmlFor={basisId}>
        Basis
        <textarea
          id={basisId}
          value={text}
          maxLength={1000}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          className={`${fieldClass} min-h-24`}
        />
      </label>
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Recording…" : title}
      </button>
    </form>
  );
}

export function DeadlineStatusForm({
  ruleId,
  ruleName,
  status,
  owner,
  note,
  onSaved,
}: {
  ruleId: string;
  ruleName: string;
  status?: string;
  owner?: string;
  note?: string;
  onSaved?: (message: string) => void;
}) {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "deadline.update");
  const [nextStatus, setNextStatus] = useState(status && status in RECORDED_LABELS ? status : "open");
  const [nextOwner, setNextOwner] = useState(owner ?? "");
  const [nextNote, setNextNote] = useState(note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const owners = state.members.filter((member) => member.state === "active");
  const statusId = `deadline-status-${ruleId}`;
  const ownerId = `deadline-owner-${ruleId}`;
  const noteId = `deadline-note-${ruleId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, "deadline.update")) {
      setError(recordDenial("deadline.update"));
      setSaved(null);
      return;
    }
    const draft = draftDeadline({ ruleId, status: nextStatus, owner: nextOwner, note: nextNote });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().updateDeadline(draft.body);
      const message = "Deadline status recorded.";
      setSaved(message);
      onSaved?.(message);
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed || !/^[a-z0-9-]{1,40}$/.test(ruleId)) return null;

  return (
    <form onSubmit={submit} className="no-print mt-4 grid gap-3 border-t border-line pt-4" aria-label={`Update ${ruleName}`}>
      <p className="text-sm text-muted">This mark tracks the work. It does not change the computed deadline.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor={statusId}>
          Recorded status
          <select id={statusId} value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className={fieldClass}>
            {DEADLINE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {RECORDED_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor={ownerId}>
          Owner
          <select id={ownerId} value={nextOwner} onChange={(event) => setNextOwner(event.target.value)} className={fieldClass}>
            <option value="">Unassigned</option>
            {owners.map((member) => (
              <option key={member.identity} value={member.identity}>
                {memberLabel(member)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm" htmlFor={noteId}>
        Note
        <textarea
          id={noteId}
          value={nextNote}
          maxLength={1000}
          rows={2}
          onChange={(event) => setNextNote(event.target.value)}
          className={`${fieldClass} min-h-20`}
        />
      </label>
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Saving…" : "Update deadline"}
      </button>
    </form>
  );
}

function memberLabel(member: MemberView): string {
  return `${member.displayName} · ${ROLE_LABELS[member.role]}`;
}
