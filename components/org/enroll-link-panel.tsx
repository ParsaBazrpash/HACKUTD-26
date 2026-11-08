"use client";

import { useState } from "react";
import { FormError, fieldClass, primaryButtonClass } from "@/components/incidents/form-ui";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";

const TTL_CHOICES = [1, 4, 24] as const;

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

type Issued = { url: string; qr: string | null };

export function EnrollLinkPanel() {
  const [ttlHours, setTtlHours] = useState<number>(24);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    setCopied(false);
    setCopyError(null);
    try {
      const created = await getIncidentClient().createEnrollLink({ ttlHours });
      let qr = created.qr && created.qr.startsWith("data:image/") ? created.qr : null;
      if (!qr) {
        try {
          const { toDataURL } = await import("qrcode");
          qr = await toDataURL(created.url, {
            margin: 1,
            width: 192,
            errorCorrectionLevel: "M",
            color: { dark: "#080a09", light: "#f5f5f3" },
          });
        } catch {
          qr = null;
        }
      }
      setIssued({ url: created.url, qr });
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!issued) return;
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Copy failed. Select the link and copy it.");
    }
  }

  return (
    <section className="no-print rounded-2xl border border-line bg-panel px-4 py-4" aria-labelledby="enroll-link-heading">
      <h2 id="enroll-link-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        ENROLLMENT LINK
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        Share this in peacetime, in person or over any channel. The safety code check is what proves it is them.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-2 text-sm" htmlFor="enroll-ttl">
          Expires after
          <select
            id="enroll-ttl"
            value={ttlHours}
            onChange={(event) => setTtlHours(Number(event.target.value))}
            className={fieldClass}
          >
            {TTL_CHOICES.map((hours) => (
              <option key={hours} value={hours}>
                {hours} {hours === 1 ? "hour" : "hours"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={pending} onClick={() => void create()} className={primaryButtonClass}>
          {pending ? "Creating…" : "Create link"}
        </button>
      </div>
      <div className="mt-3">
        <FormError message={error} />
      </div>
      {issued ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm text-muted">Copy this link before you create another. It will not be shown again.</p>
          {isHttpUrl(issued.url) ? (
            <a
              href={issued.url}
              target="_blank"
              rel="noopener noreferrer"
              translate="no"
              className="break-all font-mono text-xs text-signal underline decoration-line underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              {issued.url}
            </a>
          ) : (
            <p translate="no" className="break-all font-mono text-xs select-all">
              {issued.url}
            </p>
          )}
          <button type="button" onClick={() => void copy()} className={`${primaryButtonClass} w-fit`}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <FormError message={copyError} />
          {issued.qr ? (
            // Browser-generated data URL. next/image does not optimize those.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={issued.qr}
              alt="Enrollment QR code"
              width={192}
              height={192}
              className="h-auto w-48 rounded-xl bg-foreground p-2"
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
