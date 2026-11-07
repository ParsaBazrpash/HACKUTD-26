import type { Metadata } from "next";
import { IncidentList } from "@/components/incidents/incident-list";
import { Main } from "@/components/shell/main";

export const metadata: Metadata = {
  title: "Incidents",
};

export default function IncidentsPage() {
  return (
    <Main>
      <p className="font-mono text-[11px] tracking-[0.18em] text-signal">WAR ROOM</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">Incidents</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Sealed shells on this client. Titles, messages, and asset details are not on this list.
      </p>
      <div className="mt-8">
        <IncidentList />
      </div>
    </Main>
  );
}
