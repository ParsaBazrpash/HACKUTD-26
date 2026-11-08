"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Pencil, Plus } from "lucide-react";
import { Denied, fieldClass, FormError, FormStatus } from "@/components/incidents/form-ui";
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

const labelClass = "grid gap-1.5 text-xs font-medium text-muted";

function EntryIntro() {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-background text-signal">
        <Pencil className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold tracking-tight">Add timeline entry</h3>
        <p className="mt-0.5 text-sm leading-5 text-muted">
          Record an event, action, or decision in the incident log.
        </p>
      </div>
    </div>
  );
}

function EntryCard({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5 sm:py-5">{children}</div>
  );
}

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

  if (!allowed) {
    return (
      <EntryCard>
        <EntryIntro />
        <div className="mt-5">
          <Denied>{recordDenial("timeline.add")}</Denied>
        </div>
      </EntryCard>
    );
  }

  return (
    <form onSubmit={submit} className="min-w-0" aria-label="Timeline entry">
      <EntryCard>
        <EntryIntro />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className={labelClass} htmlFor="timeline-when">
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
          <label className={labelClass} htmlFor="timeline-phase">
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
          <label className={labelClass} htmlFor="timeline-csf">
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
          <label className={labelClass} htmlFor="timeline-amends">
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
        <label className={`${labelClass} mt-4`} htmlFor="timeline-text">
          Entry
          <textarea
            id="timeline-text"
            name="entry"
            value={text}
            required
            maxLength={4000}
            rows={5}
            placeholder="Capture facts, actions, and decisions. This becomes part of the incident record."
            onChange={(event) => setText(event.target.value)}
            className={`${fieldClass} min-h-28 resize-y`}
          />
        </label>
        <div className="mt-4 grid gap-3">
          <FormError message={error} />
          <FormStatus message={saved} />
          <button
            type="submit"
            disabled={pending || text.trim().length === 0}
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-full bg-signal py-1.5 pl-1.5 pr-4 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <span className="grid size-7 place-items-center rounded-full border border-signal-ink/70">
              <Plus className="size-3.5" aria-hidden="true" strokeWidth={2.5} />
            </span>
            {pending ? "Adding…" : "Add entry"}
          </button>
        </div>
      </EntryCard>
    </form>
  );
}
