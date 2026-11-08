"use client";

import { useState, type FormEvent } from "react";
import { Denied, fieldClass, FormError, FormStatus, primaryButtonClass } from "@/components/incidents/form-ui";
import { phaseLabel } from "@/components/incidents/labels";
import { canAuthorRecord, draftStatus, recordDenial } from "@/components/incidents/record-actions";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { PHASES, SEVERITIES } from "@/lib/protocol/events";

export function StatusForm() {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "status.set");
  const [severity, setSeverity] = useState<string>(state.status?.severity ?? "SEV2");
  const [phase, setPhase] = useState<string>(state.status?.phase ?? "detection_analysis");
  const [summary, setSummary] = useState(state.status?.summary ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, "status.set")) {
      setError(recordDenial("status.set"));
      setSaved(null);
      return;
    }
    const draft = draftStatus({ severity, phase, summary });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().setStatus(draft.body);
      setSaved("Status updated.");
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed) return <Denied>{recordDenial("status.set")}</Denied>;

  return (
    <form onSubmit={submit} className="grid gap-4" aria-label="Incident status">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="status-severity">
          Severity
          <select
            id="status-severity"
            name="severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            className={fieldClass}
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="status-phase">
          Phase
          <select
            id="status-phase"
            name="phase"
            value={phase}
            onChange={(event) => setPhase(event.target.value)}
            className={fieldClass}
          >
            {PHASES.map((value) => (
              <option key={value} value={value}>
                {phaseLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm" htmlFor="status-summary">
        Summary
        <textarea
          id="status-summary"
          name="summary"
          value={summary}
          maxLength={500}
          rows={4}
          placeholder="Add a concise status update..."
          onChange={(event) => setSummary(event.target.value)}
          className={`${fieldClass} min-h-24 resize-y`}
        />
      </label>
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Updating…" : "Update status"}
      </button>
    </form>
  );
}
