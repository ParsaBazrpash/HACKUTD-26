"use client";

import { useState, type FormEvent } from "react";
import { Denied, fieldClass, FormError, FormStatus, primaryButtonClass } from "@/components/incidents/form-ui";
import { csfLabel, phaseLabel } from "@/components/incidents/labels";
import {
  canAuthorRecord,
  draftTimeline,
  recordDenial,
  toDatetimeLocalValue,
} from "@/components/incidents/record-actions";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { CSF_CATEGORIES, PHASES } from "@/lib/protocol/events";
import { formatTimestamp } from "@/lib/time";

export function TimelineForm() {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "timeline.add");
  const [occurredAt, setOccurredAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [phase, setPhase] = useState<string>(state.status?.phase ?? "detection_analysis");
  const [csf, setCsf] = useState<string>(CSF_CATEGORIES[0]);
  const [text, setText] = useState("");
  const [amends, setAmends] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, "timeline.add")) {
      setError(recordDenial("timeline.add"));
      setSaved(null);
      return;
    }
    const draft = draftTimeline({ occurredAt, phase, csf, text, amends });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().addTimelineEntry(draft.body);
      setText("");
      setAmends("");
      setSaved("Entry added to the timeline.");
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed) return <Denied>{recordDenial("timeline.add")}</Denied>;

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5" aria-label="Timeline entry">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="timeline-when">
          When it happened
          <input
            id="timeline-when"
            name="occurred-at"
            type="datetime-local"
            required
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="timeline-phase">
          Phase
          <select
            id="timeline-phase"
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
        <label className="grid gap-2 text-sm" htmlFor="timeline-csf">
          CSF
          <select
            id="timeline-csf"
            name="csf"
            value={csf}
            onChange={(event) => setCsf(event.target.value)}
            className={fieldClass}
          >
            {CSF_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {csfLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="timeline-amends">
          Amends
          <select
            id="timeline-amends"
            name="amends"
            value={amends}
            onChange={(event) => setAmends(event.target.value)}
            className={fieldClass}
          >
            <option value="">New entry</option>
            {state.timeline.map((item) => (
              <option key={item.entry.entryId} value={item.entry.entryId}>
                {formatTimestamp(item.entry.occurredAt)} · {item.entry.text.slice(0, 48)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm" htmlFor="timeline-text">
        Entry
        <textarea
          id="timeline-text"
          name="entry"
          value={text}
          required
          maxLength={4000}
          rows={4}
          onChange={(event) => setText(event.target.value)}
          className={`${fieldClass} min-h-24`}
        />
      </label>
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending || text.trim().length === 0} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Adding…" : "Add entry"}
      </button>
    </form>
  );
}
