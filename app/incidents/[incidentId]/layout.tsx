import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { IncidentShell } from "@/components/incidents/incident-shell";
import { Main } from "@/components/shell/main";

export const metadata: Metadata = {
  title: "Incident",
};

export default function IncidentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ incidentId: string }>;
}) {
  return (
    <Main wide>
      <Suspense
        fallback={
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted">OPENING</p>
            <h1 className="mt-3 text-3xl font-medium tracking-tight">Opening the incident…</h1>
          </div>
        }
      >
        <IncidentShellLoader params={params}>{children}</IncidentShellLoader>
      </Suspense>
    </Main>
  );
}

async function IncidentShellLoader({
  params,
  children,
}: {
  params: Promise<{ incidentId: string }>;
  children: ReactNode;
}) {
  const { incidentId } = await params;
  return (
    <IncidentShell key={incidentId} incidentId={incidentId}>
      {children}
    </IncidentShell>
  );
}
