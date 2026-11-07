"use client";

import { useState, type FormEvent } from "react";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { formatTimestamp } from "@/lib/time";
import { ROLE_LABELS } from "@/components/incidents/labels";
import {
  DEFAULT_INVITE_TTL_MINUTES,
  INVITE_TTL_CHOICES,
  inviteRequest,
  isInviteRole,
  isInviteTtl,
  type InviteRole,
} from "@/components/incidents/room-controls";

const fieldClass =
  "rounded-xl border border-line bg-panel-raised px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

type IssuedInvite = {
  url: string;
  expiresAt: Date;
  qr: string | null;
};

export function InviteControls() {
  const mock = isMockIncidentClient();
  const [role, setRole] = useState<InviteRole>("counsel");
  const [ttlMinutes, setTtlMinutes] = useState(DEFAULT_INVITE_TTL_MINUTES);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<IssuedInvite | null>(null);
  const [qrNote, setQrNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setCopied(false);
    setCopyError(null);
    setQrNote(null);
    try {
      const created = await getIncidentClient().createInvite(inviteRequest(role, ttlMinutes));
      let qr: string | null = null;
      try {
        const { toDataURL } = await import("qrcode");
        qr = await toDataURL(created.url, {
          margin: 1,
          width: 192,
          errorCorrectionLevel: "M",
          color: { dark: "#080a09", light: "#f5f5f3" },
        });
      } catch {
        setQrNote("The QR code could not be drawn. Use Copy link.");
      }
      setInvite({ url: created.url, expiresAt: created.expiresAt, qr });
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!invite) return;
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Copy failed. Select the link and copy it.");
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel px-5 py-4" aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
        INVITE
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        Choose counsel, technical, or executive. The link carries that role. This page cannot make someone a commander.
      </p>
      {mock ? (
        <p className="mt-2 text-sm text-muted">Demo invite. It is a tab-local token, not a cryptographic link.</p>
      ) : null}
      <form onSubmit={create} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm" htmlFor="invite-role">
          Role
          <select
            id="invite-role"
            name="invite-role"
            value={role}
            onChange={(event) => {
              if (isInviteRole(event.target.value)) setRole(event.target.value);
            }}
            className={fieldClass}
          >
            <option value="counsel">{ROLE_LABELS.counsel}</option>
            <option value="technical">{ROLE_LABELS.technical}</option>
            <option value="executive">{ROLE_LABELS.executive}</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm" htmlFor="invite-ttl">
          Expires after
          <select
            id="invite-ttl"
            name="invite-ttl"
            value={ttlMinutes}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (isInviteTtl(next)) setTtlMinutes(next);
            }}
            className={fieldClass}
          >
            {INVITE_TTL_CHOICES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={`${primaryButtonClass} sm:col-span-2 sm:w-fit`}>
          {pending ? "Creating…" : "Create invite"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-alert">
          {error}
        </p>
      ) : null}
      {invite ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm text-muted">
            Copy this link before you create another. It will not be shown again. Expires {formatTimestamp(invite.expiresAt)}.
          </p>
          <p id="invite-url" translate="no" className="break-all font-mono text-xs text-foreground select-all">
            {invite.url}
          </p>
          <button type="button" onClick={() => void copyLink()} className={primaryButtonClass + " w-fit"}>
            {copied ? "Copied" : "Copy link"}
          </button>
          {copyError ? (
            <p role="alert" className="text-sm text-alert">
              {copyError}
            </p>
          ) : null}
          {invite.qr ? (
            // The code is a browser-generated data URL. next/image does not optimize those.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={invite.qr}
              alt="Invite QR code"
              width={192}
              height={192}
              className="h-auto w-48 rounded-xl bg-foreground p-2"
            />
          ) : null}
          {qrNote ? <p className="text-sm text-muted">{qrNote}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
