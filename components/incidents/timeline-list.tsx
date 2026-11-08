"use client";

import { Clock, User } from "lucide-react";
import { ROLE_LABELS, phaseLabel } from "@/components/incidents/labels";
import { ImportedChip } from "@/components/incidents/import-panel";
import { SafeText } from "@/components/incidents/safe-text";
import { VerdictNote } from "@/components/incidents/verdict-note";
import { useIncident } from "@/hooks/use-incident";
import { LocalTime } from "@/components/local-time";
import type { TimelineItem } from "@/lib/client/types";
import { importedSource } from "@/lib/import/label";

const PHASE_TONE: Record<string, { dot: string; badge: string }> = {
  preparation: { dot: "bg-muted", badge: "bg-panel-raised text-foreground" },
  detection_analysis: { dot: "bg-[#d6b25e]", badge: "bg-[#2a2618] text-[#f3e6c4]" },
  containment: { dot: "bg-signal", badge: "bg-[#1c2914] text-[#e7f7c8]" },
  eradication: { dot: "bg-alert", badge: "bg-[#2a1c1b] text-[#f3d2cf]" },
  recovery: { dot: "bg-[#7eb6ff]", badge: "bg-[#172433] text-[#d6e8ff]" },
  post_incident: { dot: "bg-verified", badge: "bg-[#1c2418] text-[#e4efd4]" },
};

function phaseTone(phase: string): { dot: string; badge: string } {
  return PHASE_TONE[phase] ?? { dot: "bg-muted", badge: "bg-panel-raised text-foreground" };
}

export function TimelineList({ items, detailed }: { items: readonly TimelineItem[]; detailed: boolean }) {
  const state = useIncident();
  const byId = new Map(state.timeline.map((item) => [item.entry.entryId, item]));
  const recent = [...items].reverse();

  return (
    <section aria-labelledby="recent-timeline-heading" className="min-w-0">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden="true" />
        <div className="min-w-0">
          <h3 id="recent-timeline-heading" className="text-base font-semibold tracking-tight">
            Recent timeline entries
          </h3>
          <p className="mt-0.5 text-sm leading-5 text-muted">Most recent incident records, in order.</p>
        </div>
      </div>
      {recent.length === 0 ? (
        <p className="mt-5 text-sm text-muted">No timeline entries yet.</p>
      ) : (
        <ol className="mt-5">
          {recent.map((item, index) => {
            const target = item.entry.amends ? byId.get(item.entry.amends) : undefined;
            const tone = phaseTone(item.entry.phase);
            const imported = importedSource(item.entry.text);
            const role = item.by ? ROLE_LABELS[item.by.role] : "Unknown";
            return (
              <li key={`${item.entry.entryId}-${item.seq.toString()}`} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-3 last:pb-0">
                {index < recent.length - 1 ? (
                  <span aria-hidden="true" className="absolute bottom-0 left-[0.3rem] top-5 w-px bg-line" />
                ) : null}
                <span aria-hidden="true" className="relative z-10 mt-5 size-2.5 rounded-full bg-signal ring-4 ring-background" />
                <article className="min-w-0 rounded-xl border border-line bg-panel px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <time dateTime={item.entry.occurredAt} className="text-sm font-semibold tracking-tight">
                      <LocalTime value={item.entry.occurredAt} />
                    </time>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${tone.badge}`}>
                      <span aria-hidden="true" className={`size-1.5 rounded-full ${tone.dot}`} />
                      {phaseLabel(item.entry.phase)}
                    </span>
                    <span className="rounded-md border border-line bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {item.entry.csf}
                    </span>
                    {imported ? <ImportedChip source={imported} /> : null}
                    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
                      <User className="size-3.5" aria-hidden="true" />
                      {role}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-foreground/85">
                    {imported ? item.entry.text : <SafeText text={item.entry.text} />}
                  </p>
                  {detailed ? (
                    <p className="mt-2 break-words text-xs text-muted">
                      {item.by?.displayName ?? "Unknown author"}
                      {item.sentAt ? <LocalTime value={item.sentAt} prefix=" · signed " /> : null}
                      <LocalTime value={item.at} prefix=" · server " />
                    </p>
                  ) : null}
                  {detailed && target ? (
                    <p className="mt-2 text-xs text-muted">
                      Amends the entry from <LocalTime value={target.entry.occurredAt} />.
                    </p>
                  ) : null}
                  {detailed && item.entry.amends && !target ? (
                    <p className="mt-2 text-xs text-muted">Amends an earlier entry.</p>
                  ) : null}
                  {detailed && item.amendedBy.length > 0 ? (
                    <p className="mt-2 text-xs text-muted">
                      {item.amendedBy.length === 1 ? "A later entry amends this one." : "Later entries amend this one."}
                    </p>
                  ) : null}
                  <VerdictNote verdict={item.verdict} />
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
