"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Denied, FormError, FormStatus, fieldClass, primaryButtonClass } from "@/components/incidents/form-ui";
import { boardEntries, boardText, ownerGroups, stripBoardPrefix, type BoardKind } from "@/components/incidents/board";
import { phaseLabel } from "@/components/incidents/labels";
import { canAuthorRecord, draftTimeline, recordDenial, toDatetimeLocalValue } from "@/components/incidents/record-actions";
import { SafeText } from "@/components/incidents/safe-text";
import { incidentSectionHref } from "@/components/incidents/sections";
import { exposedScope, memberName } from "@/components/incidents/situation";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { TimelineItem } from "@/lib/client/types";
import { formatTimestamp } from "@/lib/time";

const panelClass = "min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5";

const TASK_STATUS_LABEL = { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done" } as const;

function EntryList({ items, empty, who }: { items: TimelineItem[]; empty: string; who: (item: TimelineItem) => string }) {
  if (items.length === 0) return <p className="mt-3 text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-line">
      {items.slice(0, 8).map((item) => (
        <li key={item.entry.entryId} className="min-w-0 py-3">
          <p className="break-words text-sm leading-6 text-foreground">
            <SafeText text={stripBoardPrefix(item.entry.text)} />
          </p>
          <p className="mt-1 text-xs text-muted">
            {who(item)} · {formatTimestamp(new Date(item.entry.occurredAt))}
          </p>
        </li>
      ))}
    </ul>
  );
}

function BoardForm() {
  const state = useIncident();
  const [kind, setKind] = useState<BoardKind>("known");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (!canAuthorRecord(state.me?.role, state.me?.state, "timeline.add")) {
    return <Denied>{recordDenial("timeline.add")}</Denied>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(null);
    if (text.trim().length === 0) {
      setError("Write the fact or the decision first.");
      return;
    }
    const draft = draftTimeline({
      occurredAt: toDatetimeLocalValue(new Date()),
      phase: state.status?.phase ?? "detection_analysis",
      csf: "RS.CO",
      text: boardText(kind, text),
      amends: "",
    });
    if (!draft.ok) {
      setError(draft.reason);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().addTimelineEntry(draft.body);
      setText("");
      setSaved(kind === "decision" ? "Decision recorded." : "Added to what we know.");
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${panelClass} grid gap-3`} aria-label="Add to the board">
      <label className="grid gap-2 text-sm" htmlFor="board-kind">
        Add
        <select
          id="board-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value === "decision" ? "decision" : "known")}
          className={fieldClass}
        >
          <option value="known">Something we know</option>
          <option value="decision">A decision</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm" htmlFor="board-text">
        Text
        <textarea
          id="board-text"
          value={text}
          maxLength={3900}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          className={fieldClass}
        />
      </label>
      <p className="text-xs leading-5 text-muted">
        Saved as a signed entry on the timeline, encrypted like the rest of the room.
      </p>
      <div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : "Add to board"}
        </button>
      </div>
      <FormError message={error} />
      <FormStatus message={saved} />
    </form>
  );
}

export function StatusBoard() {
  const state = useIncident();
  const incident = state.incident;
  if (!incident) return null;
  const entries = boardEntries(state.timeline);
  const owners = ownerGroups(state.tasks);
  const exposed = exposedScope(state.scope).length;
  const who = (item: TimelineItem) => item.by?.displayName ?? "Unknown member";

  return (
    <div className="grid min-w-0 gap-4">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Status board</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          What we know, who owns what, and what was decided. Every line is a signed entry or task in this room.
        </p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className={panelClass} aria-labelledby="known-heading">
          <h3 id="known-heading" className="text-base font-semibold tracking-tight">
            What we know
          </h3>
          {state.status ? (
            <p className="mt-2 break-words text-sm leading-6 text-foreground">
              <span className="text-muted">{state.status.severity} · {phaseLabel(state.status.phase)}. </span>
              <SafeText text={state.status.summary} />
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            {state.scope.length} systems on the record, {exposed} still suspected, encrypted or exfiltrated.{" "}
            <Link href={incidentSectionHref(incident.id, "systems")} className="text-signal">
              Systems
            </Link>
          </p>
          <EntryList items={entries.known} empty="Nothing added yet." who={who} />
        </section>

        <section className={panelClass} aria-labelledby="decisions-heading">
          <h3 id="decisions-heading" className="text-base font-semibold tracking-tight">
            Decisions
          </h3>
          <EntryList items={entries.decisions} empty="No decisions recorded yet." who={who} />
        </section>

        <section className={panelClass} aria-labelledby="owners-heading">
          <div className="flex items-start justify-between gap-3">
            <h3 id="owners-heading" className="text-base font-semibold tracking-tight">
              Owners and open tasks
            </h3>
            <Link href={incidentSectionHref(incident.id, "tasks")} className="shrink-0 text-sm text-signal">
              Tasks
            </Link>
          </div>
          {owners.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No open tasks.</p>
          ) : (
            <ul className="mt-3 grid gap-4">
              {owners.map((group) => (
                <li key={group.identity ?? "unassigned"} className="min-w-0">
                  <p className={`text-sm font-medium ${group.identity === null ? "text-alert" : "text-foreground"}`}>
                    {group.identity === null ? "No owner yet" : memberName(state.members, group.identity)}
                  </p>
                  <ul className="mt-1 divide-y divide-line">
                    {group.open.map((task) => (
                      <li key={task.taskId} className="flex min-w-0 items-start justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 break-words">{task.latest.title}</span>
                        <span className={`shrink-0 text-xs ${task.latest.status === "blocked" ? "text-alert" : "text-muted"}`}>
                          {TASK_STATUS_LABEL[task.latest.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-3">
          <BoardForm />
          {entries.unverified > 0 ? (
            <p role="alert" className="text-sm text-alert">
              {entries.unverified} board {entries.unverified === 1 ? "entry" : "entries"} failed verification and{" "}
              {entries.unverified === 1 ? "is" : "are"} hidden. Check Integrity on the Overview.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
