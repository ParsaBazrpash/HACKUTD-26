"use client";

import { useMemo, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Radar, X } from "lucide-react";
import {
  buildBlastModel,
  CENTER,
  exposureStep,
  RING_RADIUS,
  roundTripNote,
  RINGS,
  shortCount,
  stateDeadlines,
  stateLabel,
  US_TILES,
  VIEW,
  type BlastModel,
  type MapNode,
  type Ring,
} from "@/components/incidents/blast-radius-model";
import { assetLabel, dataTypeLabel, ROLE_LABELS, scopeStatusLabel } from "@/components/incidents/labels";
import { SafeText } from "@/components/incidents/safe-text";
import { formatLead } from "@/components/incidents/situation";
import { ShareToChat } from "@/components/incidents/share-to-chat";
import { LocalTime } from "@/components/local-time";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { useIncident } from "@/hooks/use-incident";
import { canAuthorRecord } from "@/components/incidents/record-actions";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { SCOPE_STATUSES, type ScopeBody } from "@/lib/protocol/events";
import { medianSync, subscribeSync, syncCount, syncSampleSince, syncSamples, type SyncSample } from "@/lib/client/sync-meter";
import { clockStatusLabel, computeDeadlines, showsConfirmedCountdown } from "@/lib/legal";
import type { ComputedDeadline } from "@/lib/legal";
import type { IncidentState, MemberRef, ScopeItem } from "@/lib/client/types";

const RING_LABELS: Record<Ring, string> = {
  exfiltrated: "Exfiltrated",
  encrypted: "Encrypted",
  suspected: "Suspected",
  unknown: "Not assessed",
  closed: "Contained or better",
};

/** Node, glyph, text and dot tones per status. Suspected and unknown are hollow so they never read as confirmed. */
export function statusTone(status: string): { node: string; glyph: string; text: string; dot: string } {
  if (status === "exfiltrated") return { node: "fill-alert stroke-background", glyph: "fill-background", text: "text-alert", dot: "bg-alert" };
  if (status === "encrypted") return { node: "fill-signal stroke-background", glyph: "fill-background", text: "text-signal", dot: "bg-signal" };
  if (status === "suspected") return { node: "fill-panel stroke-signal", glyph: "fill-signal", text: "text-signal", dot: "border border-signal" };
  if (status === "contained" || status === "eradicated" || status === "restored") {
    return { node: "fill-verified stroke-background", glyph: "fill-background", text: "text-verified", dot: "bg-verified" };
  }
  return { node: "fill-panel stroke-muted", glyph: "fill-muted", text: "text-muted", dot: "border border-muted" };
}

const RING_DOT: Record<Ring, string> = {
  exfiltrated: "bg-alert",
  encrypted: "bg-signal",
  suspected: "border border-signal",
  unknown: "border border-muted",
  closed: "bg-verified",
};

const ASSET_GLYPH: Record<string, string> = {
  endpoint: "E",
  server: "S",
  database: "D",
  saas: "C",
  backup: "B",
  network: "N",
  other: "O",
};

const TILE_TONE = [
  "border-line bg-panel-raised text-muted/60",
  "border-alert/30 bg-alert/20 text-foreground",
  "border-alert/50 bg-alert/40 text-foreground",
  "border-alert/70 bg-alert/70 text-background",
  "border-alert bg-alert text-background",
] as const;

const EMPTY_SAMPLES: readonly SyncSample[] = [];
// Room around the rings for node labels, so names on the outer ring are not clipped.
const PAD_X = 56;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const FLASH_WINDOW_MS = 8000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function byLine(by: MemberRef | null): string {
  return by ? `${by.displayName} (${ROLE_LABELS[by.role] ?? by.role})` : "an unknown author";
}

type Selection = { kind: "system"; itemId: string } | { kind: "state"; code: string } | null;

export function BlastRadius() {
  const state = useIncident();
  const now = useBrowserNow();
  const model = useMemo(() => buildBlastModel(state.scope), [state.scope]);
  const [selected, setSelected] = useState<Selection>(null);
  const statesLit = [...model.states.values()].filter((row) => row.exposed > 0).length;

  return (
    <section aria-labelledby="blast-heading" className="min-w-0 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="blast-heading" className="flex items-center gap-2 text-xl font-medium tracking-tight">
            <Radar aria-hidden="true" className="size-5 text-signal" />
            Live blast radius
            <span className="relative ml-1 inline-flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full rounded-full bg-signal opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-signal" />
            </span>
          </h2>
          <LastChange model={model} now={now} />
        </div>
        <SyncBadge />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="In the blast radius" value={`${model.exposed} of ${model.total}`} hint="Systems suspected, encrypted or exfiltrated" />
        <Figure
          label="Records exposed"
          value={`${model.exposedRecords.toLocaleString("en-US")}${model.uncountedSystems > 0 ? "+" : ""}`}
          hint={model.uncountedSystems > 0 ? `${model.uncountedSystems} exposed system${model.uncountedSystems === 1 ? "" : "s"} not counted yet` : "On exposed systems"}
        />
        <Figure label="States lit" value={String(statesLit)} hint="Residents on exposed systems" />
        <Figure label="Contained or better" value={String(model.closed)} hint="Contained, eradicated or restored" />
      </dl>

      <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
        <RingMap model={model} now={now} selected={selected} onSelect={setSelected} />
        <StateGrid model={model} selected={selected} onSelect={setSelected} />
      </div>

      {selected ? (
        <div role="region" aria-label="Selected details" className="mt-5 rounded-lg border border-line bg-background/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {selected.kind === "system" ? (
                <SystemDetail key={selected.itemId} state={state} itemId={selected.itemId} />
              ) : (
                <StateDetail key={selected.code} state={state} model={model} code={selected.code} now={now} />
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close details"
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-xl text-xs leading-5 text-muted">
          Drawn on this device from the signed, verified record. Every change anyone records moves here for everyone in
          the room at once. The server only relays ciphertext.
        </p>
        <ShareToChat card={{ kind: "blast" }} caption="Shared the live blast radius." label="Share the map to chat" />
      </div>
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-background/40 px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
      <dd className="text-xs leading-5 text-muted">{hint}</dd>
    </div>
  );
}

function LastChange({ model, now }: { model: BlastModel; now: number | null }) {
  const last = model.lastChange;
  if (!last) return <p className="mt-1 text-sm text-muted">No systems on the record yet.</p>;
  const ago = now === null ? null : Math.max(0, Math.round((now - last.at.getTime()) / 1000));
  const when =
    ago === null ? "" : ago < 60 ? `${ago} s ago` : ago < 3600 ? `${Math.floor(ago / 60)} min ago` : `${Math.floor(ago / 3600)} h ago`;
  return (
    <p className="mt-1 break-words text-sm text-muted" aria-live="polite">
      Last change{when ? ` ${when}` : ""}: <SafeText text={truncate(last.system, 60)} /> marked{" "}
      <span className={statusTone(last.status).text}>{scopeStatusLabel(last.status)}</span> by {byLine(last.by)}
    </p>
  );
}

function SyncBadge() {
  const samples = useSyncExternalStore(subscribeSync, syncSamples, () => EMPTY_SAMPLES);
  if (isMockIncidentClient()) {
    return (
      <p className="rounded-full border border-line px-3 py-1 text-xs text-muted" title="The demo build has no server.">
        Demo data: no server round trip
      </p>
    );
  }
  const last = samples.at(-1);
  const median = medianSync(samples);
  return (
    <p
      className="rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-xs text-foreground"
      title="Time from sending your encrypted, signed change to Spacetime committing it and sending it back. Everyone else in the room gets it from the same commit."
    >
      {last ? (
        <>
          Your last change went live in <span className="font-semibold tabular-nums text-signal">{last.ms} ms</span>
          {samples.length > 1 && median !== null ? (
            <span className="text-muted">
              {" "}
              · median {median} ms over {samples.length}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted">Save a change to see the Spacetime round trip</span>
      )}
    </p>
  );
}

function RingMap({
  model,
  now,
  selected,
  onSelect,
}: {
  model: BlastModel;
  now: number | null;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  const ringCounts = Object.fromEntries(RINGS.map((ring) => [ring, model.nodes.filter((n) => n.ring === ring).length])) as Record<Ring, number>;
  const edge = (RING_RADIUS.suspected + RING_RADIUS.unknown) / 2;

  function key(event: KeyboardEvent<SVGGElement>, node: MapNode) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect({ kind: "system", itemId: node.itemId });
    }
  }

  return (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">Systems by status</h3>
      <p className="mt-1 text-xs text-muted">Center is worst. A system moves outward as the team contains it.</p>
      <svg
        viewBox={`${-PAD_X} ${-PAD_TOP} ${VIEW + 2 * PAD_X} ${VIEW + PAD_TOP + PAD_BOTTOM}`}
        role="group"
        aria-label="Systems placed by status, worst at the center"
        className="mx-auto mt-3 block w-full max-w-[30rem]"
      >
        {RINGS.map((ring) => (
          <circle key={ring} cx={CENTER} cy={CENTER} r={RING_RADIUS[ring]} className="fill-none stroke-line" strokeWidth={1} />
        ))}
        <circle cx={CENTER} cy={CENTER} r={edge} className="fill-alert/5 stroke-alert/70" strokeWidth={1.5} strokeDasharray="6 5" />
        <text x={CENTER} y={CENTER - edge - 6} textAnchor="middle" className="fill-alert text-[11px]">
          blast radius edge
        </text>
        <circle cx={CENTER} cy={CENTER} r={34} className="fill-alert/15 stroke-alert/40" />
        <text x={CENTER} y={CENTER + 4} textAnchor="middle" className="fill-foreground text-[26px] font-semibold">
          {model.exposed}
        </text>
        <text x={CENTER} y={CENTER + 20} textAnchor="middle" className="fill-muted text-[9px]">
          exposed
        </text>
        {model.nodes.map((node) => {
          const tone = statusTone(node.status);
          const isSelected = selected?.kind === "system" && selected.itemId === node.itemId;
          const fresh =
            now !== null && node.updatedAt !== null && Math.abs(now - node.updatedAt.getTime()) < FLASH_WINDOW_MS;
          const labelled = ringCounts[node.ring] <= 10;
          return (
            <g
              key={node.itemId}
              role="button"
              tabIndex={0}
              aria-label={`${node.system}: ${scopeStatusLabel(node.status)}, ${assetLabel(node.assetType)}`}
              aria-pressed={isSelected}
              onClick={() => onSelect({ kind: "system", itemId: node.itemId })}
              onKeyDown={(event) => key(event, node)}
              className="cursor-pointer outline-none transition-transform duration-700 ease-out motion-reduce:transition-none [&:focus-visible>circle.node]:stroke-foreground"
              style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
            >
              <title>{`${node.system} (${scopeStatusLabel(node.status)})`}</title>
              {fresh ? <circle key={`flash-${node.version}`} r={10} className="haven-flash fill-none stroke-signal" strokeWidth={2} /> : null}
              <circle
                r={isSelected ? 12 : 10}
                className={`node ${isSelected ? tone.node.replace(/stroke-\S+/, "stroke-foreground") : tone.node}`}
                strokeWidth={2}
              />
              <text y={3.5} textAnchor="middle" className={`pointer-events-none text-[10px] font-semibold ${tone.glyph}`}>
                {ASSET_GLYPH[node.assetType] ?? "O"}
              </text>
              {labelled ? (
                <text y={24} textAnchor="middle" className="pointer-events-none fill-muted text-[10px]">
                  {truncate(node.system, 14)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
        {RINGS.map((ring) => (
          <li key={ring} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2.5 rounded-full ${RING_DOT[ring]}`} />
            {RING_LABELS[ring]} · {ringCounts[ring] + model.hiddenByRing[ring]}
            {model.hiddenByRing[ring] > 0 ? ` (${model.hiddenByRing[ring]} not drawn)` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Letters: S server, D database, E endpoint, C SaaS, B backup, N network, O other.</p>
    </div>
  );
}

function StateGrid({
  model,
  selected,
  onSelect,
}: {
  model: BlastModel;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">Where the affected people live</h3>
      <p className="mt-1 text-xs text-muted">Shaded by residents on exposed systems. Open a state for the legal clocks it starts.</p>
      <div className="mt-3 grid grid-cols-12 gap-0.5 sm:gap-1" role="group" aria-label="US states with affected residents">
        {Object.entries(US_TILES).map(([code, tile]) => {
          const row = model.states.get(code);
          const exposed = row?.exposed ?? 0;
          const other = row?.other ?? 0;
          const step = exposureStep(exposed);
          const place = { gridColumn: tile.col + 1, gridRow: tile.row + 1 };
          const base = "flex aspect-square min-w-0 flex-col items-center justify-center rounded-[4px] border text-[9px] leading-none sm:text-[10px]";
          if (exposed === 0 && other === 0) {
            return (
              <div key={code} aria-hidden="true" style={place} className={`${base} ${TILE_TONE[0]}`}>
                {code}
              </div>
            );
          }
          const isSelected = selected?.kind === "state" && selected.code === code;
          const tone = exposed === 0 ? "border-verified/60 bg-verified/10 text-verified" : TILE_TONE[step];
          return (
            <button
              key={code}
              type="button"
              style={place}
              aria-pressed={isSelected}
              aria-label={`${tile.name}: ${exposed.toLocaleString("en-US")} residents exposed${other > 0 ? `, ${other.toLocaleString("en-US")} on systems outside the blast radius` : ""}`}
              onClick={() => onSelect({ kind: "state", code })}
              className={`${base} ${tone} font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal ${isSelected ? "ring-2 ring-foreground" : ""}`}
            >
              <span>{code}</span>
              {exposed > 0 ? <span className="mt-0.5 hidden font-normal tabular-nums sm:block">{shortCount(exposed)}</span> : null}
            </button>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Shading">
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-alert/20" />under 250</li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-alert/40" />250 to 999</li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-alert/70" />1,000 to 9,999</li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-alert" />10,000 or more</li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm border border-verified/60 bg-verified/10" />outside the blast radius only</li>
      </ul>
      {model.unmappedSystems > 0 ? (
        <p className="mt-3 text-xs leading-5 text-signal">
          {model.unmappedSystems} exposed system{model.unmappedSystems === 1 ? " holds" : "s hold"} personal data with no resident
          list yet. Counsel treats unlisted states as open.
        </p>
      ) : null}
      {model.otherCodes.length > 0 ? (
        <p className="mt-2 break-words text-xs text-muted">
          Other codes on the record: {model.otherCodes.map((row) => `${row.code} ${row.exposed.toLocaleString("en-US")}`).join(" · ")}
        </p>
      ) : null}
      {model.euResidents > 0 ? (
        <p className="mt-2 text-xs text-muted">EU residents on exposed systems: {model.euResidents.toLocaleString("en-US")}</p>
      ) : null}
    </div>
  );
}

export function SystemDetail({ state, itemId }: { state: IncidentState; itemId: string }) {
  const item = state.scope.find((row) => row.itemId === itemId);
  if (!item) return <p className="text-sm text-muted">This system is no longer on the record.</p>;
  const body = item.latest;
  const last = item.history.at(-1);
  return (
    <div className="grid gap-3">
      <div>
        <p className="break-words text-base font-medium text-foreground">
          <SafeText text={body.system} />
        </p>
        <p className="mt-1 text-sm">
          <span className={statusTone(body.status).text}>{scopeStatusLabel(body.status)}</span>
          <span className="text-muted">
            {" "}
            · {assetLabel(body.assetType)}
            {body.recordCount !== undefined ? ` · ${body.recordCount.toLocaleString("en-US")} records` : ""}
          </span>
        </p>
      </div>
      {body.dataTypes.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {body.dataTypes.map((type) => (
            <li key={type} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
              {dataTypeLabel(type)}
            </li>
          ))}
        </ul>
      ) : null}
      {body.affected.length > 0 ? (
        <p className="break-words text-sm text-muted">
          {body.affected.map((row) => `${stateLabel(row.state)} ${row.count.toLocaleString("en-US")}`).join(" · ")}
        </p>
      ) : null}
      {last ? (
        <p className="text-xs text-muted">
          Version {item.history.length}, recorded by {byLine(last.by)} <LocalTime value={last.at} prefix="at " />
        </p>
      ) : null}
      <QuickStatus item={item} />
      <ShareToChat card={{ kind: "system", itemId }} caption="Shared a system from the blast radius." />
    </div>
  );
}

/** Change one system's status straight from the map. It writes the same signed scope.set as the form below. */
function QuickStatus({ item }: { item: ScopeItem }) {
  const state = useIncident();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (!canAuthorRecord(state.me?.role, state.me?.state, "scope.set")) return null;
  const value = picked ?? item.latest.status;

  async function save() {
    if (value === item.latest.status) return;
    setBusy(true);
    setNote(null);
    const mark = syncCount();
    try {
      await getIncidentClient().upsertScopeItem({ ...item.latest, status: value as ScopeBody["status"] });
      const timed = isMockIncidentClient() ? null : syncSampleSince(mark);
      setPicked(null);
      setNote({ tone: "ok", text: timed ? `Saved. ${roundTripNote(timed.ms)}` : "Saved." });
    } catch (cause) {
      setNote({ tone: "error", text: clientErrorMessage(cause) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`quick-status-${item.itemId}`} className="text-sm text-muted">
          Status
        </label>
        <select
          id={`quick-status-${item.itemId}`}
          value={value}
          disabled={busy}
          onChange={(event) => setPicked(event.target.value)}
          className="min-h-9 rounded-lg border border-line bg-panel-raised px-2 py-1.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          {SCOPE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {scopeStatusLabel(status)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || value === item.latest.status}
          className="inline-flex min-h-9 items-center rounded-lg bg-signal px-3 py-1.5 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          Save status
        </button>
      </div>
      <p aria-live="polite" className={`min-h-4 text-xs ${note?.tone === "error" ? "text-alert" : "text-muted"}`}>
        {note?.text ?? ""}
      </p>
    </div>
  );
}

function StateDetail({ state, model, code, now }: { state: IncidentState; model: BlastModel; code: string; now: number | null }) {
  const row = model.states.get(code);
  const deadlines = now === null ? [] : stateDeadlines(code, computeDeadlines(state, new Date(now)));
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-base font-medium text-foreground">{stateLabel(code)}</p>
        <p className="mt-1 text-sm text-muted">
          {(row?.exposed ?? 0).toLocaleString("en-US")} residents on exposed systems
          {row && row.other > 0 ? ` · ${row.other.toLocaleString("en-US")} on systems outside the blast radius` : ""}
        </p>
      </div>
      {row && row.systems.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {row.systems.map((system) => (
            <li key={system.itemId} className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${statusTone(system.status).dot}`} />
              <span className="min-w-0 truncate text-foreground">
                <SafeText text={system.system} />
              </span>
              <span className="shrink-0 text-muted">
                {scopeStatusLabel(system.status)} · {system.count.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <h4 className="text-sm font-medium">Legal clocks from these residents</h4>
        {deadlines.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            {now === null ? "Loading the legal clocks." : "No state clock on the record for these residents. Counsel still reviews."}
          </p>
        ) : (
          <ul className="mt-2 grid gap-3">
            {deadlines.map((deadline) => (
              <li key={deadline.rule.id} className="grid gap-2 rounded-md border border-line p-3">
                <DeadlineLine deadline={deadline} now={now} />
                <ShareToChat card={{ kind: "deadline", ruleId: deadline.rule.id }} caption="Shared a legal clock." />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function DeadlineLine({ deadline, now }: { deadline: ComputedDeadline; now: number | null }) {
  const countdown = showsConfirmedCountdown(deadline) && deadline.dueAt && now !== null;
  return (
    <div className="min-w-0">
      <p className="break-words text-sm font-medium text-foreground">{deadline.rule.name}</p>
      <p className="mt-0.5 text-sm">
        <span className={countdown ? (deadline.clockStatus === "scheduled" ? "text-signal" : "text-alert") : "text-muted"}>
          {countdown && deadline.dueAt ? formatLead(deadline.dueAt.getTime() - (now ?? 0)) : clockStatusLabel(deadline)}
        </span>
        <span className="text-muted"> · {deadline.rule.citation}</span>
      </p>
    </div>
  );
}
