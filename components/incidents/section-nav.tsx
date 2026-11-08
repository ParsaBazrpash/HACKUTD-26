"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Scale,
  Server,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { INCIDENT_SECTIONS, incidentSectionActive, incidentSectionHref } from "@/components/incidents/sections";

type Slug = (typeof INCIDENT_SECTIONS)[number]["slug"];

/** Sections grouped the way responders work: act, talk, then govern and report. */
const GROUPS: ReadonlyArray<{ label: string; slugs: readonly Slug[] }> = [
  { label: "RESPOND", slugs: ["", "timeline", "systems", "tasks"] },
  { label: "COMMUNICATE", slugs: ["channels", "board"] },
  { label: "GOVERN", slugs: ["people", "legal", "report"] },
];

const ICONS: Record<Slug, LucideIcon> = {
  "": LayoutDashboard,
  timeline: History,
  systems: Server,
  tasks: ClipboardList,
  board: Megaphone,
  channels: MessagesSquare,
  people: Users,
  legal: Scale,
  report: FileText,
};

/** A small count beside a section, shown only when it is above zero. */
export type SectionBadges = Partial<Record<Slug, { count: number; tone: "alert" | "signal" }>>;

function linkClass(active: boolean): string {
  const base =
    "inline-flex min-h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal lg:flex lg:w-full";
  return active
    ? `${base} bg-signal font-medium text-signal-ink`
    : `${base} text-muted hover:bg-panel-raised hover:text-foreground`;
}

function badgeClass(active: boolean, tone: "alert" | "signal"): string {
  if (active) return "bg-signal-ink/15 text-signal-ink";
  return tone === "alert" ? "bg-alert/15 text-alert" : "bg-signal/15 text-signal";
}

function SectionLinks({
  incidentId,
  pathname,
  badges,
}: {
  incidentId: string;
  pathname: string | null;
  badges: SectionBadges;
}) {
  const bySlug = new Map(INCIDENT_SECTIONS.map((section) => [section.slug as Slug, section]));
  return (
    <nav
      aria-label="Incident sections"
      className="no-print flex gap-1 overflow-x-auto rounded-xl border border-line p-1 lg:flex-col lg:gap-5 lg:overflow-visible lg:rounded-none lg:border-0 lg:p-0"
    >
      {GROUPS.map((group) => (
        <div key={group.label} className="flex shrink-0 gap-1 lg:flex-col">
          <p aria-hidden="true" className="hidden px-3 pb-1 text-[10px] font-medium tracking-[0.16em] text-muted lg:block">
            {group.label}
          </p>
          {group.slugs.map((slug) => {
            const section = bySlug.get(slug);
            if (!section) return null;
            const Icon = ICONS[slug];
            const href = incidentSectionHref(incidentId, slug);
            const active = pathname !== null && incidentSectionActive(pathname, incidentId, slug);
            const badge = badges[slug];
            return (
              <Link key={slug} href={href} aria-current={active ? "page" : undefined} className={linkClass(active)}>
                <Icon aria-hidden="true" className="hidden size-4 shrink-0 lg:block" />
                <span className="lg:min-w-0 lg:flex-1 lg:truncate">{section.label}</span>
                {badge && badge.count > 0 ? (
                  <span
                    aria-hidden="true"
                    className={`rounded-full px-1.5 text-[11px] font-medium tabular-nums ${badgeClass(active, badge.tone)}`}
                  >
                    {badge.count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function LiveSectionNav({ incidentId, badges }: { incidentId: string; badges: SectionBadges }) {
  const pathname = usePathname();
  return <SectionLinks incidentId={incidentId} pathname={pathname} badges={badges} />;
}

export function SectionNav({ incidentId, badges = {} }: { incidentId: string; badges?: SectionBadges }) {
  return (
    <Suspense fallback={<SectionLinks incidentId={incidentId} pathname={null} badges={badges} />}>
      <LiveSectionNav incidentId={incidentId} badges={badges} />
    </Suspense>
  );
}
