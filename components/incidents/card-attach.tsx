"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Radar, X } from "lucide-react";
import { statusTone } from "@/components/incidents/blast-radius";
import { buildBlastModel, type LiveCard } from "@/components/incidents/blast-radius-model";
import { scopeStatusLabel } from "@/components/incidents/labels";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { clockStatusLabel, compareDeadlines, computeDeadlines } from "@/lib/legal";
import type { ComputedDeadline } from "@/lib/legal";
import type { IncidentState } from "@/lib/client/types";

const iconButtonClass =
  "grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-panel text-muted hover:border-signal hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
const optionClass =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground hover:bg-panel-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal";

function openDeadlines(state: IncidentState, now: number | null): ComputedDeadline[] {
  if (now === null) return [];
  return computeDeadlines(state, new Date(now))
    .filter((deadline) => deadline.applicability !== "no")
    .sort(compareDeadlines);
}

/** Short name for an attached card, from this reader's own record. */
export function liveCardLabel(card: LiveCard, state: IncidentState, now: number | null): string {
  if (card.kind === "blast") return "Blast radius";
  if (card.kind === "system") return state.scope.find((item) => item.itemId === card.itemId)?.latest.system ?? "A system";
  return openDeadlines(state, now).find((deadline) => deadline.rule.id === card.ruleId)?.rule.name ?? "A legal clock";
}

/** The list of cards a member can attach: the blast radius, each system, each legal clock on the record. */
export function CardPickerList({ onPick }: { onPick: (card: LiveCard) => void }) {
  const state = useIncident();
  const now = useBrowserNow();
  const model = buildBlastModel(state.scope);
  const deadlines = openDeadlines(state, now);
  return (
    <div className="grid gap-3">
      <div>
        <p className="px-2.5 pb-1 text-xs font-medium text-muted">Map</p>
        <button type="button" className={optionClass} onClick={() => onPick({ kind: "blast" })}>
          <Radar aria-hidden="true" className="size-4 shrink-0 text-signal" />
          <span className="min-w-0 flex-1 truncate">Live blast radius</span>
          <span className="shrink-0 text-xs text-muted">
            {model.exposed} of {model.total} exposed
          </span>
        </button>
      </div>
      {state.scope.length > 0 ? (
        <div>
          <p className="px-2.5 pb-1 text-xs font-medium text-muted">Systems</p>
          <ul>
            {state.scope.map((item) => (
              <li key={item.itemId}>
                <button type="button" className={optionClass} onClick={() => onPick({ kind: "system", itemId: item.itemId })}>
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${statusTone(item.latest.status).dot}`} />
                  <span className="min-w-0 flex-1 truncate">{item.latest.system}</span>
                  <span className={`shrink-0 text-xs ${statusTone(item.latest.status).text}`}>{scopeStatusLabel(item.latest.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {deadlines.length > 0 ? (
        <div>
          <p className="px-2.5 pb-1 text-xs font-medium text-muted">Legal clocks</p>
          <ul>
            {deadlines.map((deadline) => (
              <li key={deadline.rule.id}>
                <button type="button" className={optionClass} onClick={() => onPick({ kind: "deadline", ruleId: deadline.rule.id })}>
                  <span className="min-w-0 flex-1 truncate">{deadline.rule.name}</span>
                  <span className="shrink-0 text-xs text-muted">{clockStatusLabel(deadline)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Paperclip button with a picker that opens above the chat box. */
export function CardAttachButton({ disabled, onAttach }: { disabled?: boolean; onAttach: (card: LiveCard) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        aria-label="Attach a live card"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? "card-attach-picker" : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`${iconButtonClass} ${open ? "border-signal text-signal" : ""}`}
      >
        <Paperclip aria-hidden="true" className="size-4" />
      </button>
      {open ? (
        <div
          id="card-attach-picker"
          role="group"
          aria-label="Attach a live card"
          className="absolute bottom-full left-0 z-20 mb-2 max-h-80 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-xl border border-line bg-panel p-2 shadow-lg shadow-black/40"
        >
          <p className="px-2.5 pb-2 pt-1 text-xs leading-5 text-muted">
            Attach a live card. Everyone sees it drawn from their own record, and it updates in place.
          </p>
          <CardPickerList
            onPick={(card) => {
              onAttach(card);
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The attached card, shown above the chat box until the message is sent or the card is removed. */
export function AttachedCardChip({ card, onRemove }: { card: LiveCard; onRemove: () => void }) {
  const state = useIncident();
  const now = useBrowserNow();
  return (
    <div className="mb-2 flex w-fit max-w-full items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 py-1 pl-2.5 pr-1 text-sm">
      <Radar aria-hidden="true" className="size-4 shrink-0 text-signal" />
      <span className="min-w-0 truncate">
        <span className="text-muted">Live card: </span>
        {liveCardLabel(card, state, now)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove the attached card"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
