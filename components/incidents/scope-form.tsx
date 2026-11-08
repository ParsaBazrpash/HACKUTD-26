"use client";

import { useState, type FormEvent } from "react";
import { Denied, fieldClass, FormError, FormStatus, primaryButtonClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import { assetLabel, dataTypeLabel, scopeStatusLabel } from "@/components/incidents/labels";
import { canAuthorRecord, draftScope, recordDenial } from "@/components/incidents/record-actions";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { ScopeItem } from "@/lib/client/types";
import { ASSET_TYPES, DATA_TYPES, SCOPE_STATUSES, type DataType } from "@/lib/protocol/events";

interface AffectedRow {
  id: string;
  state: string;
  count: string;
}

function blankAffected(): AffectedRow {
  return { id: crypto.randomUUID(), state: "", count: "" };
}

function fromItem(item: ScopeItem): {
  itemId: string;
  system: string;
  assetType: string;
  status: string;
  dataTypes: DataType[];
  recordCount: string;
  euResidents: string;
  affected: AffectedRow[];
  notes: string;
} {
  return {
    itemId: item.itemId,
    system: item.latest.system,
    assetType: item.latest.assetType,
    status: item.latest.status,
    dataTypes: [...item.latest.dataTypes],
    recordCount: item.latest.recordCount === undefined ? "" : String(item.latest.recordCount),
    euResidents: item.latest.euResidents === undefined ? "" : String(item.latest.euResidents),
    affected: item.latest.affected.map((row) => ({
      id: crypto.randomUUID(),
      state: row.state,
      count: String(row.count),
    })),
    notes: item.latest.notes,
  };
}

export function ScopeForm() {
  const state = useIncident();
  const allowed = canAuthorRecord(state.me?.role, state.me?.state, "scope.set");
  const [mode, setMode] = useState("new");
  const [itemId, setItemId] = useState(() => crypto.randomUUID());
  const [system, setSystem] = useState("");
  const [assetType, setAssetType] = useState<string>(ASSET_TYPES[1]);
  const [status, setStatus] = useState<string>("unknown");
  const [dataTypes, setDataTypes] = useState<DataType[]>([]);
  const [recordCount, setRecordCount] = useState("");
  const [euResidents, setEuResidents] = useState("");
  const [affected, setAffected] = useState<AffectedRow[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function load(nextMode: string) {
    setMode(nextMode);
    setError(null);
    setSaved(null);
    if (nextMode === "new") {
      setItemId(crypto.randomUUID());
      setSystem("");
      setAssetType(ASSET_TYPES[1] ?? "server");
      setStatus("unknown");
      setDataTypes([]);
      setRecordCount("");
      setEuResidents("");
      setAffected([]);
      setNotes("");
      return;
    }
    const item = state.scope.find((entry) => entry.itemId === nextMode);
    if (!item) return;
    const next = fromItem(item);
    setItemId(next.itemId);
    setSystem(next.system);
    setAssetType(next.assetType);
    setStatus(next.status);
    setDataTypes(next.dataTypes);
    setRecordCount(next.recordCount);
    setEuResidents(next.euResidents);
    setAffected(next.affected);
    setNotes(next.notes);
  }

  function toggleType(type: DataType) {
    setDataTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAuthorRecord(state.me?.role, state.me?.state, "scope.set")) {
      setError(recordDenial("scope.set"));
      setSaved(null);
      return;
    }
    const draft = draftScope({
      itemId,
      system,
      assetType,
      status,
      dataTypes,
      recordCount,
      euResidents,
      affected,
      notes,
    });
    if (!draft.ok) {
      setError(draft.reason);
      setSaved(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().upsertScopeItem(draft.body);
      if (mode === "new") load("new");
      setSaved(mode === "new" ? "System recorded." : "System updated.");
    } catch (cause) {
      setSaved(null);
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!allowed) return <Denied>{recordDenial("scope.set")}</Denied>;

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5" aria-label="Affected system">
      <label className="grid gap-2 text-sm" htmlFor="scope-mode">
        Working on
        <select
          id="scope-mode"
          name="scope-mode"
          value={mode}
          onChange={(event) => load(event.target.value)}
          className={fieldClass}
        >
          <option value="new">New system</option>
          {state.scope.map((item) => (
            <option key={item.itemId} value={item.itemId}>
              {item.latest.system}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="scope-system">
          System
          <input
            id="scope-system"
            name="system"
            value={system}
            required
            maxLength={120}
            autoComplete="off"
            onChange={(event) => setSystem(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="scope-asset">
          Asset type
          <select
            id="scope-asset"
            name="asset-type"
            value={assetType}
            onChange={(event) => setAssetType(event.target.value)}
            className={fieldClass}
          >
            {ASSET_TYPES.map((value) => (
              <option key={value} value={value}>
                {assetLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="scope-status">
          Status
          <select
            id="scope-status"
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={fieldClass}
          >
            {SCOPE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {scopeStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="scope-records">
          Record count
          <input
            id="scope-records"
            name="record-count"
            inputMode="numeric"
            value={recordCount}
            onChange={(event) => setRecordCount(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-2 text-sm sm:col-span-2" htmlFor="scope-eu">
          EU residents
          <input
            id="scope-eu"
            name="eu-residents"
            inputMode="numeric"
            value={euResidents}
            onChange={(event) => setEuResidents(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm">Data types</legend>
        <div className="flex flex-wrap gap-2">
          {DATA_TYPES.map((type) => (
            <label key={type} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm">
              <input
                type="checkbox"
                name="data-type"
                value={type}
                checked={dataTypes.includes(type)}
                onChange={() => toggleType(type)}
              />
              {dataTypeLabel(type)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-3">
        <legend className="text-sm">Affected regions</legend>
        {affected.map((row) => (
          <div key={row.id} className="grid gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
            <label className="grid gap-2 text-sm" htmlFor={`region-${row.id}`}>
              Code
              <input
                id={`region-${row.id}`}
                value={row.state}
                maxLength={2}
                autoComplete="off"
                onChange={(event) =>
                  setAffected((current) =>
                    current.map((item) => (item.id === row.id ? { ...item, state: event.target.value } : item)),
                  )
                }
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor={`region-count-${row.id}`}>
              Residents
              <input
                id={`region-count-${row.id}`}
                inputMode="numeric"
                value={row.count}
                onChange={(event) =>
                  setAffected((current) =>
                    current.map((item) => (item.id === row.id ? { ...item, count: event.target.value } : item)),
                  )
                }
                className={fieldClass}
              />
            </label>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setAffected((current) => current.filter((item) => item.id !== row.id))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${secondaryButtonClass} w-fit`}
          disabled={affected.length >= 60}
          onClick={() => setAffected((current) => [...current, blankAffected()])}
        >
          Add region
        </button>
      </fieldset>
      <label className="grid gap-2 text-sm" htmlFor="scope-notes">
        Notes
        <textarea
          id="scope-notes"
          name="notes"
          value={notes}
          maxLength={2000}
          rows={3}
          onChange={(event) => setNotes(event.target.value)}
          className={`${fieldClass} min-h-24`}
        />
      </label>
      <FormError message={error} />
      <FormStatus message={saved} />
      <button type="submit" disabled={pending || system.trim().length === 0} className={`${primaryButtonClass} w-fit`}>
        {pending ? "Saving…" : "Save system"}
      </button>
    </form>
  );
}
