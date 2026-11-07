import { Suspense } from "react";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import { Main } from "@/components/shell/main";

export default function IncidentDetailPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  return (
    <Main>
      {/* Await params inside Suspense so Cache Components can prerender the shell. */}
      <Suspense
        fallback={
          <div>
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted">OPENING</p>
            <h1 className="mt-3 text-3xl font-medium tracking-tight">Opening the incident…</h1>
          </div>
        }
      >
        <IncidentDetailLoader params={params} />
      </Suspense>
    </Main>
  );
}

async function IncidentDetailLoader({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;
  return <IncidentDetail key={incidentId} incidentId={incidentId} />;
}
