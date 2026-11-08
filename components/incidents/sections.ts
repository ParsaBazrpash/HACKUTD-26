export const INCIDENT_SECTIONS = [
  { slug: "", label: "Overview" },
  { slug: "timeline", label: "Timeline" },
  { slug: "systems", label: "Affected Systems" },
  { slug: "tasks", label: "Tasks" },
  { slug: "board", label: "Status Board" },
  { slug: "channels", label: "Secure Channels" },
  { slug: "people", label: "People & Access" },
  { slug: "legal", label: "Legal Deadlines" },
  { slug: "report", label: "Report" },
] as const;

export function incidentSectionHref(incidentId: string, slug: string): string {
  return slug.length === 0 ? `/incidents/${incidentId}` : `/incidents/${incidentId}/${slug}`;
}

export function incidentSectionActive(pathname: string, incidentId: string, slug: string): boolean {
  const href = incidentSectionHref(incidentId, slug);
  if (slug.length === 0) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
