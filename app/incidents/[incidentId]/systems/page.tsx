import type { Metadata } from "next";
import { SystemsBoard } from "@/components/incidents/systems-board";

export const metadata: Metadata = {
  title: "Affected Systems",
};

export default function SystemsPage() {
  return <SystemsBoard />;
}
