"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { INCIDENT_SECTIONS, incidentSectionActive, incidentSectionHref } from "@/components/incidents/sections";

function linkClass(active: boolean): string {
  return active
    ? "inline-flex min-h-9 shrink-0 items-center rounded-lg bg-signal px-3 text-sm font-medium text-signal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    : "inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
}

function SectionLinks({ incidentId, pathname }: { incidentId: string; pathname: string | null }) {
  return (
    <nav
      aria-label="Incident sections"
      className="no-print mt-5 flex gap-1 overflow-x-auto rounded-xl border border-line p-1"
    >
      {INCIDENT_SECTIONS.map((section) => {
        const href = incidentSectionHref(incidentId, section.slug);
        const active = pathname !== null && incidentSectionActive(pathname, incidentId, section.slug);
        return (
          <Link
            key={section.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={linkClass(active)}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

function LiveSectionNav({ incidentId }: { incidentId: string }) {
  const pathname = usePathname();
  return <SectionLinks incidentId={incidentId} pathname={pathname} />;
}

export function SectionNav({ incidentId }: { incidentId: string }) {
  return (
    <Suspense fallback={<SectionLinks incidentId={incidentId} pathname={null} />}>
      <LiveSectionNav incidentId={incidentId} />
    </Suspense>
  );
}
