import type { Metadata } from "next";
import { StatusBoard } from "@/components/incidents/status-board";

export const metadata: Metadata = {
  title: "Status Board",
};

export default function BoardPage() {
  return <StatusBoard />;
}
