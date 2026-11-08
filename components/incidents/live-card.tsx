"use client";

import Link from "next/link";
import { Radar } from "lucide-react";
import { DeadlineLine, statusTone } from "@/components/incidents/blast-radius";
import { buildBlastModel, RINGS, shortCount, stateLabel, type LiveCard, type Ring } from "@/components/incidents/blast-radius-model";
import { assetLabel, ROLE_LABELS, scopeStatusLabel } from "@/components/incidents/labels";
import { SafeText } from "@/components/incidents/safe-text";
import { incidentSectionHref } from "@/components/incidents/sections";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { computeDeadlines, nextCountdown } from "@/lib/legal";
import type { IncidentState } from "@/lib/client/types";

const SEGMENT: Record<Ring, string> = {
  exfiltrated: "bg-alert",
  encrypted: "bg-signal",
  suspected: "bg-signal/45",
  unknown: "bg-muted/40",
  closed: "bg-verified",
};

const linkClass =
  "text-xs text-signal hover:text-signal-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

/**
 * A card shared in chat, drawn from this reader's own verified record. It
 * changes in place for everyone when the record changes, and it never shows
 * anything the reader's record does not already hold.
 */
export function LiveCardView({ card, sharedAt }: { card: LiveCard; sharedAt: Date }) {
  const state = useIncident();
  const now = useBrowserNow();
  const incidentId = state.incident?.id;
  const title = card.kind === "blast" ? "Live blast radius" : card.kind === "system" ? "Live system" : "Live legal clock";

  return (
    <div className="mt-1.5 max-w-md rounded-lg border border-signal/35 bg-background/60 p-3" data-live-card={card.kind}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-signal">
        <Radar aria-hidden="true" className="size-3.5" />
        {title}
        <span aria-hidden="true" className="ml-0.5 size-1.5 rounded-full bg-signal" />
      </p>
      <div className="mt-2">
        {card.kind === "blast" ? <BlastCard state={state} now={now} /> : null}
        {card.kind === "system" ? <SystemCard state={state} itemId={card.itemId} sharedAt={sharedAt} /> : null}
        {card.kind === "deadline" ? <DeadlineCard state={state} ruleId={card.ruleId} now={now} /> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <p className="text-[11px] text-muted">From the signed record. Updates in place.</p>
        {incidentId ? (
          <Link href={incidentSectionHref(incidentId, card.kind === "deadline" ? "legal" : "systems")} className={linkClass}>
            {card.kind === "deadline" ? "Open legal deadlines" : "Open the map"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function BlastCard({ state, now }: { state: IncidentState; now: number | null }) {
  const model = buildBlastModel(state.scope);
  const counts = RINGS.map((ring) => ({ ring, n: model.nodes.filter((node) => node.ring === ring).length + model.hiddenByRing[ring] }));
  const lit = [...model.states.values()].filter((row) => row.exposed > 0).sort((a, b) => b.exposed - a.exposed);
  const next = now === null ? null : nextCountdown(computeDeadlines(state, new Date(now)));
  if (model.total === 0) return <p className="text-sm text-muted">No systems on the record yet.</p>;
  return (
    <div className="grid gap-2">
      <p className="text-sm text-foreground">
        <span className="font-semibold tabular-nums">{model.exposed}</span> of {model.total} systems in the blast radius
        <span className="text-muted">
          {" "}
          · {model.exposedRecords.toLocaleString("en-US")}
          {model.uncountedSystems > 0 ? "+" : ""} records exposed
        </span>
      </p>
      <div className="flex h-2 overflow-hidden rounded-full bg-panel-raised" role="img" aria-label={counts.map((c) => `${c.n} ${c.ring}`).join(", ")}>
        {counts.map((c) =>
          c.n > 0 ? <span key={c.ring} className={`${SEGMENT[c.ring]} transition-all duration-700`} style={{ flexGrow: c.n }} /> : null,
        )}
      </div>
      {lit.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="States with exposed residents">
          {lit.slice(0, 6).map((row) => (
            <li key={row.code} className="rounded border border-alert/40 bg-alert/15 px-1.5 py-0.5 text-[11px] text-foreground">
              {row.code} {shortCount(row.exposed)}
            </li>
          ))}
          {lit.length > 6 ? <li className="px-1 text-[11px] text-muted">+{lit.length - 6} more</li> : null}
        </ul>
      ) : null}
      {next?.dueAt && now !== null ? (
        <DeadlineLine deadline={next} now={now} />
      ) : (
        <p className="text-xs text-muted">No legal countdown is running.</p>
      )}
    </div>
  );
}

function SystemCard({ state, itemId, sharedAt }: { state: IncidentState; itemId: string; sharedAt: Date }) {
  const item = state.scope.find((row) => row.itemId === itemId);
  if (!item) return <p className="text-sm text-muted">This system is not on the record you can see.</p>;
  const body = item.latest;
  const last = item.history.at(-1);
  const changed =
    last && Number.isFinite(sharedAt.getTime()) && Number.isFinite(last.at.getTime()) && last.at.getTime() > sharedAt.getTime();
  return (
    <div className="grid gap-1.5">
      <p className="break-words text-sm font-medium text-foreground">
        <SafeText text={body.system} />
      </p>
      <p className="text-sm">
        <span className={statusTone(body.status).text}>{scopeStatusLabel(body.status)}</span>
        <span className="text-muted">
          {" "}
          · {assetLabel(body.assetType)}
          {body.recordCount !== undefined ? ` · ${body.recordCount.toLocaleString("en-US")} records` : ""}
        </span>
      </p>
      {body.affected.length > 0 ? (
        <p className="break-words text-xs text-muted">
          {body.affected
            .slice(0, 6)
            .map((row) => `${stateLabel(row.state)} ${shortCount(row.count)}`)
            .join(" · ")}
          {body.affected.length > 6 ? ` · +${body.affected.length - 6} more` : ""}
        </p>
      ) : null}
      {changed ? (
        <p className="text-xs text-signal">
          Updated since it was shared, by {last.by ? `${last.by.displayName} (${ROLE_LABELS[last.by.role] ?? last.by.role})` : "an unknown author"}.
        </p>
      ) : null}
    </div>
  );
}

function DeadlineCard({ state, ruleId, now }: { state: IncidentState; ruleId: string; now: number | null }) {
  if (now === null) return <p className="text-sm text-muted">Loading the clock.</p>;
  const deadline = computeDeadlines(state, new Date(now)).find((row) => row.rule.id === ruleId);
  if (!deadline || deadline.applicability === "no") {
    return <p className="text-sm text-muted">This clock does not apply on the record now.</p>;
  }
  return (
    <div className="grid gap-1">
      <DeadlineLine deadline={deadline} now={now} />
      <p className="text-xs text-muted">{deadline.rule.jurisdiction}</p>
    </div>
  );
}
