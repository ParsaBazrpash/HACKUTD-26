import type { Metadata } from "next";
import { IncidentOverview } from "@/components/incidents/overview";

export const metadata: Metadata = {
  title: "Overview",
};

export default function IncidentOverviewPage() {
  return <IncidentOverview />;
}
