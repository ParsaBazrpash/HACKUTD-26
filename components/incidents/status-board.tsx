"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ChevronDown, CircleCheck, Columns3, MoreHorizontal, Plus } from "lucide-react";
import { Denied, FormError, FormStatus, fieldClass, primaryButtonClass } from "@/components/incidents/form-ui";
import {
  BOARD_LIST_CAP,
  boardEntries,
  boardText,
  recordProblems,
  stripBoardPrefix,
  type BoardEntry,
  type BoardKind,
} from "@/components/incidents/board";
import { phaseLabel, ROLE_LABELS } from "@/components/incidents/labels";
import { canAuthorRecord, draftTask, draftTimeline, recordDenial, toDatetimeLocalValue } from "@/components/incidents/record-actions";
import { SafeText } from "@/components/incidents/safe-text";
import { incidentSectionHref } from "@/components/incidents/sections";
import { exposedScope } from "@/components/incidents/situation";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { MemberView, Task } from "@/lib/client/types";
import { LocalTime } from "@/components/local-time";

const COLUMNS = [
  { status: "open", label: "Backlog" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
] as const;

type ColumnStatus = (typeof COLUMNS)[number]["status"];
type BoardView = "actions" | "decisions" | "known";

const cardClass = "rounded-xl border border-line bg-panel-raised";

function isColumnStatus(value: string): value is ColumnStatus {
  return COLUMNS.some((column) => column.status === value);
}

function isBoardView(value: string): value is BoardView {
  return value === "actions" || value === "decisions" || value === "known";
}

function ticketCode(id: string): string {
  const tail = id.replace(/-/g, "").slice(-4).replace(/^0+/, "").toUpperCase();
  return `T-${tail || "0"}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`;
  return letters.toUpperCase();
}

function ownerOf(members: readonly MemberView[], identity: string | undefined): { initials: string; chip: string; name: string; revoked: boolean } {
  if (!identity) return { initials: "?", chip: "Unassigned", name: "Unassigned", revoked: false };
  const member = members.find((item) => item.identity === identity);
  if (!member) return { initials: "?", chip: "Unknown", name: "Unknown member", revoked: false };
  const revoked = member.state === "revoked";
  return {
    initials: initials(member.displayName),
    chip: revoked ? "Revoked" : ROLE_LABELS[member.role],
    name: revoked ? `${member.displayName}, revoked` : member.displayName,
    revoked,
  };
}

function columnTasks(tasks: readonly Task[], status: ColumnStatus): Task[] {
  return tasks
    .filter((task) => task.latest.status === status)
    .sort((a, b) => {
      const left = a.history[0]?.seq ?? 0n;
      const right = b.history[0]?.seq ?? 0n;
      if (left < right) return -1;
      if (left > right) return 1;
      return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
    });
}

function leftColumn(event: DragEvent<HTMLElement>): boolean {
  const next = event.relatedTarget;
  return !(next instanceof Node) || !event.currentTarget.contains(next);
}

export function StatusBoard() {
  const state = useIncident();
  const incident = state.incident;
  const [view, setView] = useState<BoardView>("actions");
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState<ColumnStatus>("open");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  if (!incident) return null;

  const canTasks = canAuthorRecord(state.me?.role, state.me?.state, "task.set");
  const canNotes = canAuthorRecord(state.me?.role, state.me?.state, "timeline.add");
  const canAdd = view === "actions" ? canTasks : canNotes;
  const entries = boardEntries(state.timeline);
  const problems = recordProblems(state.integrity);
  const timelineHref = incidentSectionHref(incident.id, "timeline");

  function openAdd(status: ColumnStatus = "open") {
    setPreset(status);
    setAdding(true);
  }

  async function move(task: Task, status: ColumnStatus) {
    if (!canTasks || task.latest.status === status) return;
    const draft = draftTask({
      taskId: task.taskId,
      title: task.latest.title,
      assignee: task.latest.assignee ?? "",
      dueAt: task.latest.dueAt ?? "",
      status,
    });
    if (!draft.ok) {
      setMoveError(draft.reason);
      return;
    }
    setPendingId(task.taskId);
    setMoveError(null);
    try {
      await getIncidentClient().upsertTask(draft.body);
    } catch (cause) {
      setMoveError(clientErrorMessage(cause));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">Status Board</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
            Track decisions, actions, and ownership across the incident.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="relative inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel pl-3 pr-2 text-sm">
            <Columns3 aria-hidden="true" className="size-4 shrink-0 text-muted" />
            <span className="sr-only">Board view</span>
            <select
              value={view}
              onChange={(event) => {
                if (isBoardView(event.target.value)) setView(event.target.value);
              }}
              className="h-10 appearance-none bg-transparent pr-6 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <option value="actions">Board</option>
              <option value="decisions">Decisions</option>
              <option value="known">What we know</option>
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-4 text-muted" />
          </label>
          {canAdd ? (
            <button
              type="button"
              className={`${primaryButtonClass} gap-1.5`}
              aria-expanded={adding}
              onClick={() => setAdding((open) => !open)}
            >
              <Plus aria-hidden="true" className="size-4" />
              {adding ? "Close" : "Add item"}
            </button>
          ) : null}
        </div>
      </div>

      {!canAdd ? <Denied>{recordDenial(view === "actions" ? "task.set" : "timeline.add")}</Denied> : null}
      {adding && canAdd ? (
        view === "actions" ? (
          <AddTaskForm key={preset} members={state.members} status={preset} />
        ) : (
          <AddNoteForm key={view} kind={view === "decisions" ? "decision" : "known"} phase={state.status?.phase ?? "detection_analysis"} />
        )
      ) : null}

      <FormError message={moveError} />
      {problems > 0 ? (
        <p role="alert" className="text-sm text-alert">
          The record has {problems} {problems === 1 ? "entry" : "entries"} that failed verification. Failed entries are
          never shown here. Check Integrity on the Overview.
        </p>
      ) : null}

      {view === "actions" ? (
        <ActionBoard
          tasks={state.tasks}
          members={state.members}
          canMove={canTasks}
          pendingId={pendingId}
          onAdd={openAdd}
          onMove={(task, status) => void move(task, status)}
        />
      ) : null}
      {view === "decisions" ? (
        <div className="grid gap-6">
          <NoteCards items={entries.decisions} empty="No decisions recorded yet." timelineHref={timelineHref} chip="Decision" />
          {entries.proposed.length > 0 ? (
            <div className="grid gap-3">
              <h3 className="text-sm font-medium text-muted">Proposed, not yet decided by the commander</h3>
              <NoteCards items={entries.proposed} empty="" timelineHref={timelineHref} chip="Proposed" proposed />
            </div>
          ) : null}
        </div>
      ) : null}
      {view === "known" ? (
        <div className="grid gap-3">
          {state.status ? (
            <article className={`${cardClass} p-4`}>
              <p className="text-[11px] font-medium tracking-[0.14em] text-muted">CURRENT STATUS</p>
              <p className="mt-2 break-words text-sm leading-6 text-foreground">
                <span className="text-muted">
                  {state.status.severity} · {phaseLabel(state.status.phase)}.{" "}
                </span>
                <SafeText text={state.status.summary} />
              </p>
              <p className="mt-2 text-xs text-muted">
                {state.scope.length} systems on the record, {exposedScope(state.scope).length} still suspected, encrypted
                or exfiltrated.{" "}
                <Link href={incidentSectionHref(incident.id, "systems")} className="text-signal">
                  Systems
                </Link>
              </p>
            </article>
          ) : null}
          <NoteCards items={entries.known} empty="Nothing added yet." timelineHref={timelineHref} chip="Known" />
        </div>
      ) : null}
    </div>
  );
}

function ActionBoard({
  tasks,
  members,
  canMove,
  pendingId,
  onAdd,
  onMove,
}: {
  tasks: readonly Task[];
  members: readonly MemberView[];
  canMove: boolean;
  pendingId: string | null;
  onAdd: (status: ColumnStatus) => void;
  onMove: (task: Task, status: ColumnStatus) => void;
}) {
  const [over, setOver] = useState<ColumnStatus | null>(null);

  return (
    <div className="grid min-w-0 gap-3">
      {canMove && tasks.length > 0 ? (
        <p id="board-move-help" className="text-xs leading-5 text-muted">
          Drag a card into another column, or choose its column on the card. Each move is a signed update.
        </p>
      ) : null}
      <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const items = columnTasks(tasks, column.status);
          const hot = over === column.status;
          return (
            <section
              key={column.status}
              aria-labelledby={`board-col-${column.status}`}
              onDragOver={(event) => {
                if (!canMove) return;
                event.preventDefault();
                setOver(column.status);
              }}
              onDragLeave={(event) => {
                if (leftColumn(event)) setOver((current) => (current === column.status ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const taskId = event.dataTransfer.getData("text/plain");
                const task = tasks.find((item) => item.taskId === taskId);
                if (!task || task.latest.status === column.status) return;
                onMove(task, column.status);
              }}
              className={`flex min-h-64 min-w-0 flex-col rounded-2xl border bg-panel p-3 ${
                hot ? "border-signal" : column.status === "blocked" ? "border-line border-t-2 border-t-alert" : "border-line"
              }`}
            >
              <div className="mb-3 flex items-center gap-2 px-1">
                <h3
                  id={`board-col-${column.status}`}
                  className={`text-sm font-semibold tracking-tight ${
                    column.status === "blocked" ? "underline decoration-alert decoration-2 underline-offset-[6px]" : ""
                  }`}
                >
                  {column.label}
                </h3>
                <span
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums ${
                    column.status === "blocked" ? "bg-alert/20 text-alert" : "bg-background text-muted"
                  }`}
                >
                  {items.length}
                </span>
                {canMove ? (
                  <span className="ml-auto">
                    <ColumnMenu label={column.label} onAdd={() => onAdd(column.status)} />
                  </span>
                ) : null}
              </div>
              <ul className="grid gap-2">
                {items.map((task) => (
                  <TaskCard
                    key={task.taskId}
                    task={task}
                    members={members}
                    canMove={canMove}
                    pending={pendingId === task.taskId}
                    onMove={onMove}
                  />
                ))}
              </ul>
              {items.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted">{hot ? "Drop here" : "Empty"}</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ColumnMenu({ label, onAdd }: { label: string; onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${label} actions`}
        onClick={() => setOpen((value) => !value)}
        className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-10 mt-1 min-w-36 rounded-lg border border-line bg-background p-1">
          <button
            type="button"
            role="menuitem"
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-panel-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
          >
            Add item here
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  members,
  canMove,
  pending,
  onMove,
}: {
  task: Task;
  members: readonly MemberView[];
  canMove: boolean;
  pending: boolean;
  onMove: (task: Task, status: ColumnStatus) => void;
}) {
  const owner = ownerOf(members, task.latest.assignee);
  const done = task.latest.status === "done";
  const code = ticketCode(task.taskId);

  function dragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData("text/plain", task.taskId);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <li className={`${cardClass} ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <div
        draggable={canMove && !pending}
        onDragStart={dragStart}
        className={`px-3 pt-3 ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[11px] tracking-wide text-muted">{code}</p>
          {done ? (
            <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-signal" />
          ) : (
            <span
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-[10px] font-medium tracking-wide text-muted"
              title={owner.name}
            >
              <span aria-hidden="true">{owner.initials}</span>
              <span className="sr-only">{owner.name}</span>
            </span>
          )}
        </div>
        <p className="mt-2 break-words text-sm leading-5 text-foreground">
          <SafeText text={task.latest.title} />
        </p>
        {task.latest.dueAt ? (
          <p className="mt-1 text-[11px] text-muted">
            Due <LocalTime value={task.latest.dueAt} />
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
        <span
          className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-[11px] ${
            owner.revoked ? "border-alert/50 text-alert" : "border-line text-muted"
          }`}
        >
          {owner.chip}
        </span>
        {canMove ? (
          <select
            aria-label={`Move ${task.latest.title}`}
            value={task.latest.status}
            disabled={pending}
            onChange={(event) => {
              if (isColumnStatus(event.target.value)) onMove(task, event.target.value);
            }}
            className="max-w-full rounded-full border border-line bg-transparent px-2 py-0.5 text-[11px] text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {COLUMNS.map((column) => (
              <option key={column.status} value={column.status}>
                {column.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </li>
  );
}

function NoteCards({
  items,
  empty,
  timelineHref,
  chip,
  proposed = false,
}: {
  items: BoardEntry[];
  empty: string;
  timelineHref: string;
  chip: string;
  proposed?: boolean;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="grid gap-3">
      <ul className="grid gap-3 md:grid-cols-2">
        {items.slice(0, BOARD_LIST_CAP).map(({ item, replaces }) => (
          <li key={`${item.entry.entryId}-${item.seq.toString()}`} className={`${cardClass} p-3`}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-mono text-[11px] tracking-wide text-muted">{ticketCode(item.entry.entryId)}</p>
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-[10px] font-medium tracking-wide text-muted">
                <span aria-hidden="true">{initials(item.by?.displayName ?? "")}</span>
                <span className="sr-only">{item.by?.displayName ?? "Unknown member"}</span>
              </span>
            </div>
            <p className="mt-2 break-words text-sm leading-5 text-foreground">
              <SafeText text={stripBoardPrefix(item.entry.text)} />
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{chip}</span>
              <p className="text-[11px] text-muted">
                {proposed ? "Proposed · " : ""}
                <LocalTime value={item.at} />
                {replaces ? ` · Replaces ${replaces}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {items.length > BOARD_LIST_CAP ? (
        <p className="text-xs text-muted">
          Showing {BOARD_LIST_CAP} of {items.length}.{" "}
          <Link href={timelineHref} className="text-signal">
            See all on the timeline
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function AddTaskForm({ members, status }: { members: readonly MemberView[]; status: ColumnStatus }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [taskId, setTaskId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [nextStatus, setNextStatus] = useState<ColumnStatus>(status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = draftTask({ taskId, title, assignee, dueAt, status: nextStatus });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().upsertTask(draft.body);
      setTaskId(crypto.randomUUID());
      setTitle("");
      setSaved("Task added.");
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-line bg-panel p-4" aria-label="Add item">
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="grid gap-2 text-sm lg:col-span-2" htmlFor="board-task-title">
          Title
          <input
            ref={titleRef}
            id="board-task-title"
            value={title}
            required
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="board-task-assignee">
          Owner
          <select
            id="board-task-assignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className={fieldClass}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.identity} value={member.identity}>
                {member.displayName} · {ROLE_LABELS[member.role]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="board-task-status">
          Column
          <select
            id="board-task-status"
            value={nextStatus}
            onChange={(event) => {
              if (isColumnStatus(event.target.value)) setNextStatus(event.target.value);
            }}
            className={fieldClass}
          >
            {COLUMNS.map((column) => (
              <option key={column.status} value={column.status}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm lg:col-span-2" htmlFor="board-task-due">
          Due
          <input
            id="board-task-due"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <p className="text-xs leading-5 text-muted">Saved as a signed task on the record.</p>
      <div>
        <button type="submit" disabled={pending || title.trim().length === 0} className={primaryButtonClass}>
          {pending ? "Saving…" : "Add item"}
        </button>
      </div>
      <FormError message={error} />
      <FormStatus message={saved} />
    </form>
  );
}

function AddNoteForm({ kind, phase }: { kind: BoardKind; phase: string }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim().length === 0) {
      setError(kind === "decision" ? "Write the decision first." : "Write the fact first.");
      setSaved(null);
      return;
    }
    const draft = draftTimeline({
      occurredAt: toDatetimeLocalValue(new Date()),
      phase,
      csf: "RS.CO",
      text: boardText(kind, text),
      amends: "",
    });
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
      setSaved(kind === "decision" ? "Decision recorded." : "Added to what we know.");
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-line bg-panel p-4" aria-label="Add item">
      <label className="grid gap-2 text-sm" htmlFor="board-note-text">
        {kind === "decision" ? "Decision" : "What we know"}
        <textarea
          ref={textRef}
          id="board-note-text"
          value={text}
          maxLength={3900}
          rows={3}
          onChange={(event) => setText(event.target.value)}
          className={fieldClass}
        />
      </label>
      <p className="text-xs leading-5 text-muted">Saved as a signed entry on the timeline, encrypted like the rest of the room.</p>
      <div>
        <button type="submit" disabled={pending || text.trim().length === 0} className={primaryButtonClass}>
          {pending ? "Saving…" : "Add item"}
        </button>
      </div>
      <FormError message={error} />
      <FormStatus message={saved} />
    </form>
  );
}
