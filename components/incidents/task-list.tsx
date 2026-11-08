"use client";

import { useState } from "react";
import { fieldClass, FormError } from "@/components/incidents/form-ui";
import { taskStatusLabel } from "@/components/incidents/labels";
import { canAuthorRecord, draftTask } from "@/components/incidents/record-actions";
import { SafeText } from "@/components/incidents/safe-text";
import { memberName } from "@/components/incidents/situation";
import { VerdictNote } from "@/components/incidents/verdict-note";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { Task } from "@/lib/client/types";
import { TASK_STATUSES } from "@/lib/protocol/events";
import { formatTimestamp } from "@/lib/time";

function tone(status: string): string {
  if (status === "blocked") return "text-alert";
  if (status === "in_progress") return "text-signal";
  if (status === "done") return "text-verified";
  return "text-foreground";
}

export function TaskList({ interactive = false }: { interactive?: boolean }) {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "task.set");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(task: Task, status: string) {
    if (!allowed) return;
    const draft = draftTask({
      taskId: task.taskId,
      title: task.latest.title,
      assignee: task.latest.assignee ?? "",
      dueAt: task.latest.dueAt ?? "",
      status,
    });
    if (!draft.ok) {
      setError(draft.reason);
      return;
    }
    setPendingId(task.taskId);
    setError(null);
    try {
      await getIncidentClient().upsertTask(draft.body);
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  if (state.tasks.length === 0) return <p className="text-sm text-muted">No tasks yet.</p>;

  return (
    <div className="grid gap-3">
      <FormError message={error} />
      <ul className="divide-y divide-line border-y border-line">
        {state.tasks.map((task) => {
          const version = task.history.at(-1);
          return (
            <li key={task.taskId} className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center">
              <div className="min-w-0">
                <p className="break-words text-sm text-foreground">
                  <SafeText text={task.latest.title} />
                </p>
                <p className="mt-1 break-words text-xs text-muted">
                  <span className={tone(task.latest.status)}>{taskStatusLabel(task.latest.status)}</span>
                  {" · "}
                  {memberName(state.members, task.latest.assignee)}
                  {task.latest.dueAt ? ` · due ${formatTimestamp(task.latest.dueAt)}` : ""}
                </p>
                {version ? <VerdictNote verdict={version.verdict} /> : null}
              </div>
              {interactive ? (
                <label className="grid gap-2 text-sm" htmlFor={`task-row-${task.taskId}`}>
                  <span className="sr-only">Status for {task.latest.title}</span>
                  <select
                    id={`task-row-${task.taskId}`}
                    value={task.latest.status}
                    disabled={!allowed || pendingId === task.taskId}
                    onChange={(event) => void update(task, event.target.value)}
                    className={fieldClass}
                  >
                    {TASK_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {taskStatusLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
