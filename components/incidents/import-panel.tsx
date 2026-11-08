"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { FileDown, FileUp } from "lucide-react";
import { fieldClass, FormError, FormStatus, primaryButtonClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import { canAuthorRecord } from "@/components/incidents/record-actions";
import { LocalTime } from "@/components/local-time";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { cleanFileName, cleanText } from "@/lib/import/clean";
import { canSend, findDuplicate, startsChecked } from "@/lib/import/gate";
import { parseCsv, type Row } from "@/lib/import/csv";
import { FIELD_KEYS, type FieldKey, type Mapping } from "@/lib/import/fields";
import { parseJson, parseNdjson } from "@/lib/import/json";
import { buildPlan, sendImport, type ImportPlan } from "@/lib/import/plan";
import { isPlatformId, missingFields, PLATFORM_IDS, PLATFORMS, suggestForPlatform, type PlatformId } from "@/lib/import/platforms";
import type { ImportedSource } from "@/lib/import/label";
import { fileChecklist, type CheckState } from "@/lib/import/checklist";
import { readImportFile, scanParsed, type ImportFormat } from "@/lib/import/read";

const FIELD_LABEL: Record<FieldKey, string> = {
  time: "Time column",
  host: "Host column",
  title: "Alert title column",
  severity: "Severity column",
};

const FORMAT_LABEL: Record<ImportFormat, string> = { csv: "CSV", json: "JSON", ndjson: "NDJSON" };

interface Loaded {
  fileName: string;
  size: number;
  sha256: string;
  format: ImportFormat;
  warnings: string[];
  hiddenFound: boolean;
  columns: string[];
  rows: Row[];
  /** System names on the record when the file was opened. */
  existing: string[];
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

const CHECK_MARK: Record<CheckState, string> = { pass: "\u2713", warn: "!", fail: "\u2717" };
const CHECK_WORD: Record<CheckState, string> = { pass: "Passed", warn: "Warning", fail: "Failed" };
const CHECK_CLASS: Record<CheckState, string> = { pass: "text-emerald-500", warn: "text-amber-500", fail: "text-alert" };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ImportPanel() {
  const state = useIncident();
  if (!canAuthorRecord(state.me?.role, state.me?.state, "timeline.add")) return null;
  return <ImportPanelInner />;
}

function ImportPanelInner() {
  const state = useIncident();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [platform, setPlatform] = useState<PlatformId>("generic");
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [again, setAgain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; sent: string[]; unsent: string[] } | null>(null);

  const custodian = state.me?.displayName ?? "";

  const plan: ImportPlan | null = useMemo(() => {
    if (!loaded || !mapping) return null;
    return buildPlan({
      rows: loaded.rows,
      mapping,
      fileName: loaded.fileName,
      sha256: loaded.sha256,
      custodian,
      existingSystems: loaded.existing,
      platform,
    });
  }, [loaded, mapping, custodian, platform]);

  const duplicate = loaded ? findDuplicate(state.evidence, loaded.sha256) : undefined;

  function reset() {
    setLoaded(null);
    setMapping(null);
    setOverrides(new Map());
    setAgain(false);
    setError(null);
    setProgress(null);
    setSent(null);
    setFailure(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const read = await readImportFile(file);
      if (!read.ok) {
        setError(read.error);
        return;
      }
      const table = read.format === "csv" ? parseCsv(read.text) : read.format === "json" ? parseJson(read.text) : parseNdjson(read.text);
      if (!table.ok) {
        setError(table.error);
        return;
      }
      // JSON escapes (\u202e, \u200b, \u0007) only become characters once parsed, so the parsed strings are checked too.
      const scan = scanParsed(read.format, read.warnings, table.columns, table.rows);
      if (scan.refuse) {
        setError(scan.refuse);
        return;
      }
      setLoaded({
        fileName: cleanFileName(file.name),
        size: read.size,
        sha256: read.sha256,
        format: read.format,
        warnings: scan.warnings,
        hiddenFound: scan.found,
        columns: table.columns,
        rows: table.rows,
        existing: state.scope.map((item) => item.latest.system),
      });
      setMapping(suggestForPlatform(platform, table.columns));
    } catch {
      setError("The file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  const isOn = (key: string, flags: readonly string[]) => overrides.get(key) ?? startsChecked(flags);
  const toggle = (key: string, flags: readonly string[]) => {
    const next = new Map(overrides);
    next.set(key, !isOn(key, flags));
    setOverrides(next);
  };

  const chosenSystems = plan ? plan.systems.filter((s) => isOn(s.key, s.flags)) : [];
  const chosenLines = plan ? plan.lines.filter((l) => isOn(l.key, l.flags)) : [];
  const total = chosenSystems.length + chosenLines.length;
  const sending = progress !== null && sent === null && failure === null;
  const sendable = canSend({ total, duplicate: Boolean(duplicate), again, sending, sent: sent !== null });

  async function send() {
    if (!plan || !loaded || !sendable) return;
    setError(null);
    setFailure(null);
    setProgress({ done: 0, total: total + 1 });
    const outcome = await sendImport(getIncidentClient(), plan, chosenSystems, chosenLines, {
      onProgress: (done, count) => setProgress({ done, total: count }),
      describe: clientErrorMessage,
    });
    if (!outcome.ok) {
      setFailure({ message: outcome.message, sent: outcome.sent, unsent: outcome.unsent });
      return;
    }
    setSent(`Added ${plural(outcome.count, "entry", "entries")} to the record, signed by you and marked as an unverified claim.`);
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={secondaryButtonClass}
      >
        <FileUp className="mr-2 size-4" aria-hidden="true" />
        Import from file
      </button>
      {open ? (
        <section aria-label="Import from file" className="mt-4 min-w-0 rounded-2xl border border-line bg-panel px-4 py-4 sm:px-5 sm:py-5">
          <h3 className="text-base font-semibold tracking-tight">Import from a monitoring export</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Pick a CSV, JSON or NDJSON export from your EDR, SIEM or monitoring console. The file is read in this browser and
            never uploaded. From Excel, use Save As and pick CSV UTF-8. Only the host, time, alert title and severity are used. Entries are added as your own signed claim,
            marked unverified.
          </p>
          <label className="mt-4 grid gap-1.5 text-xs font-medium text-muted" htmlFor="import-platform">
            Platform
            <select
              id="import-platform"
              value={platform}
              disabled={busy || sending}
              onChange={(e) => {
                const next = isPlatformId(e.target.value) ? e.target.value : "generic";
                setPlatform(next);
                if (loaded) {
                  setMapping(suggestForPlatform(next, loaded.columns));
                  setOverrides(new Map());
                }
              }}
              className={fieldClass}
            >
              {PLATFORM_IDS.map((id) => (
                <option key={id} value={id}>
                  {PLATFORMS[id].label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-1.5 text-xs leading-5 text-muted">{PLATFORMS[platform].hint}</p>
          <label className="mt-4 grid gap-1.5 text-xs font-medium text-muted" htmlFor="import-file">
            Export file
            <input
              id="import-file"
              type="file"
              accept=".csv,.json,.ndjson,.txt"
              onChange={onFile}
              disabled={busy || sending}
              className={fieldClass}
            />
          </label>
          <div className="mt-3 grid gap-2">
            <FormError message={error} />
          </div>

          {loaded && plan && mapping ? (
            <div className="mt-5 grid gap-5">
              {duplicate ? (
                <div role="alert" className="rounded-lg border border-alert/60 px-3 py-3 text-sm">
                  <p className="text-alert">
                    Already imported by {duplicate.by?.displayName ?? "an unknown member"}
                    <LocalTime value={duplicate.at} prefix=" at " />.
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-foreground">
                    <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
                    Import again anyway
                  </label>
                </div>
              ) : null}

              <dl className="grid gap-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-muted">File: </dt>
                  <dd className="inline break-all">{loaded.fileName}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">Size: </dt>
                  <dd className="inline">{sizeLabel(loaded.size)}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">SHA-256: </dt>
                  <dd className="inline font-mono text-xs">{loaded.sha256.slice(0, 16)}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">Format: </dt>
                  <dd className="inline">
                    {FORMAT_LABEL[loaded.format]}, {plural(plan.rowCount, "row", "rows")}
                  </dd>
                </div>
              </dl>

              <div className="grid gap-1 text-sm" data-testid="import-checks">
                <ul className="grid gap-1">
                  {fileChecklist({ hiddenFound: loaded.hiddenFound }).map((line) => (
                    <li key={line.label} className="flex gap-2">
                      <span aria-hidden="true" className={CHECK_CLASS[line.state]}>
                        {CHECK_MARK[line.state]}
                      </span>
                      <span className="sr-only">{CHECK_WORD[line.state]}: </span>
                      <span>{line.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">Basic safety checks only. This is not a thorough scan and does not check what the file says.</p>
              </div>

              {loaded.warnings.length > 0 ? (
                <ul className="grid gap-1 text-sm text-muted">
                  {loaded.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}

              {platform !== "generic" ? (
                <div className="grid gap-1 text-sm">
                  <p className="text-muted">
                    Read as {PLATFORMS[platform].label}:{" "}
                    {FIELD_KEYS.map((f) => `${FIELD_LABEL[f].replace(" column", "").toLowerCase()} from ${mapping[f] ? cleanText(mapping[f] as string, 40) : "nothing"}`).join(", ")}.
                  </p>
                  {missingFields(platform, mapping).length > 0 ? (
                    <p role="alert" className="text-alert">
                      This file does not look like a {PLATFORMS[platform].label} export (no {missingFields(platform, mapping).join(", ")} column found). Pick the right platform, or Generic to choose the columns yourself.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className={platform === "generic" ? "grid gap-3 sm:grid-cols-2" : "hidden"}>
                {FIELD_KEYS.map((field) => (
                  <label key={field} className="grid gap-1.5 text-xs font-medium text-muted" htmlFor={`import-map-${field}`}>
                    {FIELD_LABEL[field]}
                    <select
                      id={`import-map-${field}`}
                      value={mapping[field] ?? ""}
                      onChange={(e) => {
                        setMapping({ ...mapping, [field]: e.target.value === "" ? null : e.target.value });
                        setOverrides(new Map());
                      }}
                      className={fieldClass}
                    >
                      <option value="">Not in this file</option>
                      {loaded.columns.map((col) => (
                        <option key={col} value={col}>
                          {cleanText(col, 80)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <p className="text-sm font-medium">
                1 evidence row, {plural(plan.systems.length, "new system", "new systems")}, {plural(plan.lines.length, "alert line", "alert lines")}
              </p>

              {plan.skipped.length > 0 ? (
                <ul className="grid gap-1 text-sm text-muted">
                  {plan.skipped.map((s) => (
                    <li key={s.reason}>
                      {plural(s.count, "row", "rows")} skipped: {s.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              {plan.notImported.length > 0 ? (
                <ul className="grid gap-1 text-sm text-muted">
                  {plan.notImported.map((n) => (
                    <li key={n} className="break-words">
                      {n}
                    </li>
                  ))}
                </ul>
              ) : null}
              {plan.systems.length + plan.lines.length === 0 ? (
                <p className="text-sm text-muted">Nothing to import yet. Check the host, time and title columns above.</p>
              ) : null}

              <ul className="grid gap-3">
                {plan.systems.map((s) => (
                  <PreviewItem key={s.key} on={isOn(s.key, s.flags)} flags={s.flags} text={s.preview} onToggle={() => toggle(s.key, s.flags)} disabled={sending} />
                ))}
                {plan.lines.map((l) => (
                  <PreviewItem key={l.key} on={isOn(l.key, l.flags)} flags={l.flags} text={l.preview} onToggle={() => toggle(l.key, l.flags)} disabled={sending} />
                ))}
              </ul>

              {progress ? (
                <p role="status" className="text-sm text-muted">
                  Sent {progress.done} of {progress.total}
                </p>
              ) : null}
              <FormStatus message={sent} />
              {failure ? (
                <div role="alert" className="grid gap-1 text-sm">
                  <p className="text-alert">Stopped: {failure.message}</p>
                  <p className="text-muted">Sent: {failure.sent.length > 0 ? failure.sent.join("; ") : "nothing"}.</p>
                  <p className="text-muted">Not sent: {failure.unsent.join("; ")}.</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={send} disabled={!sendable} className={primaryButtonClass}>
                  {sending ? "Signing…" : `Sign and add ${total + 1} entries`}
                </button>
                <button type="button" onClick={reset} disabled={sending} className={secondaryButtonClass}>
                  {sent ? "Done" : "Cancel"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function PreviewItem({
  on,
  flags,
  text,
  onToggle,
  disabled,
}: {
  on: boolean;
  flags: readonly string[];
  text: string;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <li className="min-w-0 rounded-lg border border-line bg-background px-3 py-2">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1" checked={on} onChange={onToggle} disabled={disabled} />
        <span className="min-w-0">
          <span className="block whitespace-pre-line break-words text-foreground/90">{text}</span>
          {flags.length > 0 ? <span className="mt-1 block text-xs text-alert">Check this one: {flags.join("; ")}.</span> : null}
        </span>
      </label>
    </li>
  );
}

/** A fixed marker shown beside entries that came from an import. Entry text cannot draw this: it is an icon plus a dashed border. */
export function ImportedChip({ source }: { source: ImportedSource }) {
  return (
    <span
      title={`Imported from ${source.fileName}, sha256 ${source.sha256.slice(0, 12)}. Signed by the importer. Unverified.`}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-signal/70 px-1.5 py-0.5 text-[11px] font-medium text-signal"
    >
      <FileDown className="size-3" aria-hidden="true" />
      Imported, unverified
    </span>
  );
}
