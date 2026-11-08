import type { Metadata } from "next";
import { TimelineBoard } from "@/components/incidents/timeline-board";

export const metadata: Metadata = {
  title: "Timeline",
};

export default function TimelinePage() {
  return <TimelineBoard />;
}
