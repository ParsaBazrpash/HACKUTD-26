import type { Metadata } from "next";
import { TasksBoard } from "@/components/incidents/tasks-board";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function TasksPage() {
  return <TasksBoard />;
}
