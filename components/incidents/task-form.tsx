"use client";

import { useState, type FormEvent } from "react";
import { Denied, fieldClass, FormError, FormStatus, primaryButtonClass } from "@/components/incidents/form-ui";
import { ROLE_LABELS, taskStatusLabel } from "@/components/incidents/labels";
import { canAuthorRecord, draftTask, recordDenial, toDatetimeLocalValue } from "@/components/incidents/record-actions";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { Task } from "@/lib/client/types";
import { TASK_STATUSES } from "@/lib/protocol/events";

function loadTask(task: Task): {
  taskId: string;
  title: string;
  assignee: string;
  dueAt: string;
  status: string;
} {
  return {
    taskId: task.taskId,
    title: task.latest.title,
    assignee: task.latest.assignee ?? "",
    dueAt: task.latest.dueAt ? toDatetimeLocalValue(task.latest.dueAt) : "",
    status: task.latest.status,
  };
}

export function TaskForm() {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "task.set");
  const [mode, setMode] = useState("new");
  const [taskId, setTaskId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [status, setStatus] = useState<string>("open");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function load(nextMode: string) {
    setMode(nextMode);
    setError(null);
    setSaved(null);
    if (nextMode === "new") {
      setTaskId(crypto.randomUUID());
      setTitle("");
      setAssignee("");
      setDueAt("");
      setStatus("open");
      return;
    }
    const task = state.tasks.find((item) => item.taskId === nextMode);
    if (!task) return;
    const next = loadTask(task);
    setTaskId(next.taskId);
    setTitle(next.title);
    setAssignee(next.assignee);
    setDueAt(next.dueAt);
    setStatus(next.status);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, "task.set")) {
      setError(recordDenial("task.set"));
      setSaved(null);
      return;
    }
    const draft = draftTask({ taskId, title, assignee, dueAt, status });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().upsertTask(draft.body);
      if (mode === "new") load("new");
      setSaved(mode === "new" ? "Task added." : "Task updated.");
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed) return <Denied>{recordDenial("task.set")}</Denied>;

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5" aria-label="Task">
      <label className="grid gap-2 text-sm" htmlFor="task-mode">
        Working on
        <select
          id="task-mode"
          name="task-mode"
          value={mode}
          onChange={(event) => load(event.target.value)}
          className={fieldClass}
        >
          <option value="new">New task</option>
          {state.tasks.map((task) => (
            <option key={task.taskId} value={task.taskId}>
              {task.latest.title}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm" htmlFor="task-title">
        Title
        <input
          id="task-title"
          name="title"
          value={title}
          required
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setTitle(event.target.value)}
          className={fieldClass}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="task-assignee">
          Assignee
          <select
            id="task-assignee"
            name="assignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className={fieldClass}
          >
            <option value="">Unassigned</option>
            {state.members.map((member) => (
              <option key={member.identity} value={member.identity}>
                {member.displayName} · {ROLE_LABELS[member.role]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="task-due">
          Due
          <input
            id="task-due"
            name="due"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2" htmlFor="task-status">
          Status
          <select
            id="task-status"
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={fieldClass}
          >
            {TASK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {taskStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending || title.trim().length === 0} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Saving…" : "Save task"}
      </button>
    </form>
  );
}
