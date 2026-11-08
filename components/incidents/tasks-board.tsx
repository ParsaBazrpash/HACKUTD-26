"use client";

import { TaskForm } from "@/components/incidents/task-form";
import { TaskList } from "@/components/incidents/task-list";
import { taskCounts } from "@/components/incidents/situation";
import { useIncident } from "@/hooks/use-incident";

export function TasksBoard() {
  const state = useIncident();
  const counts = taskCounts(state.tasks);

  return (
    <div className="grid min-w-0 gap-8">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Tasks</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          {`${counts.open} open, ${counts.inProgress} in progress, ${counts.blocked} blocked${counts.done > 0 ? `, ${counts.done} done` : ""}.`}
        </p>
      </div>
      <TaskList interactive />
      <TaskForm />
    </div>
  );
}
