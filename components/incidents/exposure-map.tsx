"use client";

import { Component, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  exposureStep,
  shortCount,
  stateLabel,
  US_TILES,
  type BlastModel,
  type StateExposure,
} from "@/components/incidents/blast-radius-model";
import { scopeStatusLabel } from "@/components/incidents/labels";
import { SafeText } from "@/components/incidents/safe-text";
import { BAND_FILL, BAND_LABEL, BAND_SCALE, exposureBand, leadingStatus, SCALE_BANDS } from "@/lib/geo/exposure";
import { POSTAL_CODES } from "@/lib/geo/fips";
import type { ExposureCounts, ExposureGlobeHandle } from "@/components/incidents/exposure-globe";

const FRAME = "relative h-[min(74vw,28rem)] w-full sm:h-[26rem] lg:h-[32rem]";

const ExposureGlobe = dynamic(
  () => import("@/components/incidents/exposure-globe").then((mod) => mod.ExposureGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center text-xs text-muted" role="status">
        Loading the exposure map
      </div>
    ),
  },
);

const TILE_TONE = [
  "border-line bg-panel-raised text-muted/60",
  "border-[#4e5638] bg-[#4e5638]/80 text-foreground",
  "border-[#8fb34a] bg-[#8fb34a]/80 text-background",
  "border-[#b08a3e] bg-[#b08a3e] text-background",
  "border-[#c97a74] bg-[#c97a74] text-background",
] as const;

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function subscribeEngine(): () => void {
  return () => {};
}

let engineCache: "webgl" | "fallback" | null = null;

function readEngine(): "webgl" | "fallback" {
  if (engineCache) return engineCache;
  engineCache = webglAvailable() ? "webgl" : "fallback";
  return engineCache;
}

function pendingEngine(): "pending" {
  return "pending";
}

class GlobeBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function ExposureTooltip({
  code,
  exposed,
  other,
  systems,
}: {
  code: string;
  exposed: number;
  other: number;
  systems: StateExposure["systems"];
}) {
  const band = exposureBand(exposed, other);
  const status = leadingStatus(systems.map((system) => system.status));
  const shown = systems.slice(0, 3);
  return (
    <div className="w-56 rounded-lg border border-line bg-background/95 px-3 py-2.5">
      <p className="text-sm font-medium text-foreground">
        {stateLabel(code)} ({code})
      </p>
      <p className="mt-1 text-xs text-muted">{band === "none" ? "No exposure on the record" : `${BAND_LABEL[band]} exposure`}</p>
      <p className="mt-1 text-xs tabular-nums text-foreground">{exposed.toLocaleString("en-US")} affected residents</p>
      {other > 0 ? (
        <p className="mt-0.5 text-xs text-muted">{other.toLocaleString("en-US")} on systems outside the blast radius</p>
      ) : null}
      <p className="mt-1 text-xs text-muted">Status: {status ? scopeStatusLabel(status) : "none on the record"}</p>
      {shown.length > 0 ? (
        <ul className="mt-1.5 grid gap-0.5">
          {shown.map((system) => (
            <li key={system.itemId} className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-foreground">
                <SafeText text={system.system} />
              </span>
              <span className="shrink-0 tabular-nums text-muted">{system.count.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {systems.length > shown.length ? (
        <p className="mt-1 text-xs text-muted">{systems.length - shown.length} more on the record</p>
      ) : null}
    </div>
  );
}

function stateOption(code: string, row: StateExposure | undefined): string {
  const name = `${stateLabel(code)} (${code})`;
  if (!row || (row.exposed === 0 && row.other === 0)) return name;
  if (row.exposed === 0) return `${name}, residents outside the blast radius`;
  return `${name}, ${row.exposed.toLocaleString("en-US")} affected residents, ${BAND_LABEL[exposureBand(row.exposed, row.other)]}`;
}

function StateTiles({
  model,
  selectedCode,
  onSelectCode,
}: {
  model: BlastModel;
  selectedCode: string | null;
  onSelectCode: (code: string) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-0.5 sm:gap-1" role="group" aria-label="US states with affected residents">
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
        const isSelected = selectedCode === code;
        const tone = exposed === 0 ? "border-verified/60 bg-verified/10 text-verified" : TILE_TONE[step];
        return (
          <button
            key={code}
            type="button"
            style={place}
            aria-pressed={isSelected}
            aria-label={`${tile.name}: ${exposed.toLocaleString("en-US")} residents exposed${other > 0 ? `, ${other.toLocaleString("en-US")} on systems outside the blast radius` : ""}`}
            onClick={() => onSelectCode(code)}
            className={`${base} ${tone} font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal ${isSelected ? "ring-2 ring-foreground" : ""}`}
          >
            <span>{code}</span>
            {exposed > 0 ? <span className="mt-0.5 hidden font-normal tabular-nums sm:block">{shortCount(exposed)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ExposureMap({
  model,
  selectedCode,
  onSelectCode,
}: {
  model: BlastModel;
  selectedCode: string | null;
  onSelectCode: (code: string) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<ExposureGlobeHandle>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const detected = useSyncExternalStore(subscribeEngine, readEngine, pendingEngine);
  const engine = failed ? "fallback" : detected;

  const counts = useMemo(() => {
    const out: Record<string, ExposureCounts> = {};
    for (const [code, row] of model.states) out[code] = { exposed: row.exposed, other: row.other };
    return out;
  }, [model]);

  const codes = useMemo(
    () => [...POSTAL_CODES].sort((a, b) => stateLabel(a).localeCompare(stateLabel(b), "en")),
    [],
  );

  const onUnavailable = useCallback(() => setFailed(true), []);

  const placeTip = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    const tip = tipRef.current;
    if (!frame || !tip) return;
    const rect = frame.getBoundingClientRect();
    const width = tip.offsetWidth || 224;
    const height = tip.offsetHeight || 140;
    const left = Math.min(Math.max(8, clientX - rect.left + 14), Math.max(8, rect.width - width - 8));
    const top = Math.min(Math.max(8, clientY - rect.top + 14), Math.max(8, rect.height - height - 8));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, []);

  const onHover = useCallback(
    (code: string | null, clientX: number, clientY: number) => {
      pointer.current = { x: clientX, y: clientY };
      setHoverCode((current) => (current === code ? current : code));
      placeTip(clientX, clientY);
    },
    [placeTip],
  );

  useLayoutEffect(() => {
    if (!hoverCode) return;
    placeTip(pointer.current.x, pointer.current.y);
  }, [hoverCode, placeTip, model]);

  const showGlobe = engine === "webgl" && !failed;
  const hover = hoverCode ? model.states.get(hoverCode) : undefined;
  const showOutside = [...model.states.values()].some((row) => row.exposed === 0 && row.other > 0);

  return (
    <div className="mt-4 min-w-0">
      <p className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">US Exposure Overview</p>
      {showGlobe ? (
        <div ref={frameRef} className={`${FRAME} haven-globe-in mt-2`}>
          <GlobeBoundary onError={onUnavailable}>
            <ExposureGlobe
              ref={globeRef}
              exposure={counts}
              hoverCode={hoverCode}
              selectedCode={selectedCode}
              onHover={onHover}
              onSelect={onSelectCode}
              onUnavailable={onUnavailable}
            />
          </GlobeBoundary>
          <div className="pointer-events-none absolute inset-0 z-10">
            <div role="group" aria-label="Globe view" className="pointer-events-auto absolute top-2 right-2 flex flex-col gap-1">
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => globeRef.current?.zoom(0.8)}
                className="grid size-8 place-items-center rounded-md border border-line bg-background/85 text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => globeRef.current?.zoom(1.25)}
                className="grid size-8 place-items-center rounded-md border border-line bg-background/85 text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <Minus aria-hidden="true" className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="Reset view"
                onClick={() => globeRef.current?.reset()}
                className="grid size-8 place-items-center rounded-md border border-line bg-background/85 text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            {hoverCode ? (
              <div ref={tipRef} role="tooltip" className="pointer-events-none absolute top-0 left-0 z-20">
                <ExposureTooltip
                  code={hoverCode}
                  exposed={hover?.exposed ?? 0}
                  other={hover?.other ?? 0}
                  systems={hover?.systems ?? []}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : engine === "pending" ? (
        <div className={`${FRAME} mt-2 grid place-items-center rounded-lg border border-line text-xs text-muted`} role="status">
          Preparing the exposure map
        </div>
      ) : (
        <div className="mt-2">
          <p className="mb-2 text-xs text-muted">This browser cannot draw the globe. The state grid uses the same resident counts.</p>
          <StateTiles model={model} selectedCode={selectedCode} onSelectCode={onSelectCode} />
        </div>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted" aria-label="Exposure scale">
        {SCALE_BANDS.map((band) => (
          <li key={band} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm border border-line" style={{ background: BAND_FILL[band] }} />
            {BAND_SCALE[band]}
          </li>
        ))}
        {showOutside ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm border border-verified/60 bg-verified/20" />
            Outside the blast radius
          </li>
        ) : null}
      </ul>

      <label htmlFor="exposure-state" className="mt-3 flex min-w-0 flex-col gap-1 text-xs text-muted">
        Choose a state
        <select
          id="exposure-state"
          value={selectedCode ?? ""}
          onChange={(event) => {
            if (event.target.value) onSelectCode(event.target.value);
          }}
          className="min-h-9 w-full rounded-lg border border-line bg-panel-raised px-2 py-1.5 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <option value="">Select a state</option>
          {codes.map((code) => (
            <option key={code} value={code}>
              {stateOption(code, model.states.get(code))}
            </option>
          ))}
        </select>
      </label>
      {showGlobe ? (
        <p className="mt-2 text-xs text-muted">Alaska and Hawaii are drawn at their real coordinates. Drag to turn the globe.</p>
      ) : null}
    </div>
  );
}
