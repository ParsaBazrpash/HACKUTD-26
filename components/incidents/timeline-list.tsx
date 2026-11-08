"use client";

import { VerdictNote } from "@/components/incidents/verdict-note";
import { phaseLabel } from "@/components/incidents/labels";
import { SafeText } from "@/components/incidents/safe-text";
import { useIncident } from "@/hooks/use-incident";
import type { TimelineItem } from "@/lib/client/types";
import { formatTimestamp } from "@/lib/time";

export function TimelineList({ items, detailed }: { items: readonly TimelineItem[]; detailed: boolean }) {
  const state = useIncident();
  const byId = new Map(state.timeline.map((item) => [item.entry.entryId, item]));

  if (items.length === 0) {
    return <p className="text-sm text-muted">No timeline entries yet.</p>;
  }

  return (
    <ol className="divide-y divide-line border-y border-line">
      {items.map((item) => {
        const target = item.entry.amends ? byId.get(item.entry.amends) : undefined;
        return (
          <li key={item.entry.entryId} className="grid min-w-0 gap-2 py-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted">{formatTimestamp(item.entry.occurredAt)}</p>
              <p className="mt-1 text-sm text-foreground">
                {phaseLabel(item.entry.phase)}
                <span className="text-muted"> · {item.entry.csf}</span>
              </p>
            </div>
            <div className="min-w-0">
              <p className="break-words text-sm leading-6 text-foreground">
                <SafeText text={item.entry.text} />
              </p>
              <p className="mt-2 break-words text-xs text-muted">
                {item.by?.displayName ?? "Unknown author"}
                {item.sentAt ? ` · signed ${formatTimestamp(item.sentAt)}` : ""}
                {` · server ${formatTimestamp(item.at)}`}
              </p>
              {detailed && target ? (
                <p className="mt-2 text-xs text-muted">Amends the entry from {formatTimestamp(target.entry.occurredAt)}.</p>
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
