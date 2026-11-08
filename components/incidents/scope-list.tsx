"use client";

import { assetLabel, dataTypeLabel, scopeStatusLabel } from "@/components/incidents/labels";
import { ImportedChip } from "@/components/incidents/import-panel";
import { SafeText } from "@/components/incidents/safe-text";
import { VerdictNote } from "@/components/incidents/verdict-note";
import type { ScopeItem } from "@/lib/client/types";
import { importedNotesSource } from "@/lib/import/label";

function tone(status: string): string {
  if (status === "exfiltrated") return "text-alert";
  if (status === "encrypted" || status === "suspected" || status === "unknown") return "text-signal";
  if (status === "contained" || status === "eradicated" || status === "restored") return "text-verified";
  return "text-muted";
}

export function ScopeList({ items }: { items: readonly ScopeItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted">No systems in this group.</p>;

  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((item) => {
        const imported = importedNotesSource(item.latest.notes);
        return (
        <li key={item.itemId} className="min-w-0 py-4">
          <p className="flex flex-wrap items-center gap-2 break-words text-sm text-foreground">
            <SafeText text={item.latest.system} />
            {imported ? <ImportedChip source={imported} /> : null}
          </p>
          <p className={`mt-1 text-sm ${tone(item.latest.status)}`}>
            {scopeStatusLabel(item.latest.status)}
            <span className="text-muted"> · {assetLabel(item.latest.assetType)}</span>
            {item.latest.recordCount !== undefined
              ? ` · ${item.latest.recordCount.toLocaleString("en-US")} records`
              : ""}
          </p>
          {item.latest.dataTypes.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {item.latest.dataTypes.map((type) => (
                <li key={type} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
                  {dataTypeLabel(type)}
                </li>
              ))}
            </ul>
          ) : null}
          {item.latest.affected.length > 0 ? (
            <p className="mt-3 break-words text-sm text-muted">
              {item.latest.affected.map((row) => `${row.state} ${row.count.toLocaleString("en-US")}`).join(" · ")}
            </p>
          ) : null}
          {item.latest.euResidents !== undefined ? (
            <p className="mt-2 text-sm text-muted">
              EU residents {item.latest.euResidents.toLocaleString("en-US")}
            </p>
          ) : null}
          {item.latest.notes ? (
            <p className="mt-3 break-words text-sm leading-6 text-muted">
              {imported ? item.latest.notes : <SafeText text={item.latest.notes} />}
            </p>
          ) : null}
          {item.history.length > 1 ? (
            <p className="mt-2 text-xs text-muted">{item.history.length} versions on the record.</p>
          ) : null}
          {item.history.at(-1) ? <VerdictNote verdict={item.history[item.history.length - 1].verdict} /> : null}
        </li>
        );
      })}
    </ul>
  );
}
