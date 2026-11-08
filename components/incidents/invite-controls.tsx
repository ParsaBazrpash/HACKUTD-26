"use client";

import { useState, type FormEvent } from "react";
import { Link2, Send } from "lucide-react";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { LocalTime } from "@/components/local-time";
import { fieldClass, primaryButtonClass } from "@/components/incidents/form-ui";
import { ROLE_LABELS } from "@/components/incidents/labels";
import {
  DEFAULT_INVITE_TTL_MINUTES,
  INVITE_TTL_CHOICES,
  inviteRequest,
  isInviteRole,
  isInviteTtl,
  type InviteRole,
} from "@/components/incidents/room-controls";

function httpInviteHref(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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
    <section className="rounded-xl border border-line bg-panel p-5" aria-labelledby="invite-heading">
      <div className="flex items-start gap-3">
        <Send aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />
        <div className="min-w-0">
          <h2 id="invite-heading" className="text-base font-semibold tracking-tight">
            Invite people
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Bring in outside responders, such as counsel or forensics. The link expires; access lasts until you
            revoke it.
          </p>
        </div>
      </div>
      <form onSubmit={create} className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-2 text-sm text-muted" htmlFor="invite-role">
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
        <label className="grid gap-2 text-sm text-muted" htmlFor="invite-ttl">
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
        <button type="submit" disabled={pending} className={`${primaryButtonClass} gap-1.5`}>
          <Link2 aria-hidden="true" className="size-4" />
          {pending ? "Creating…" : "Create invite"}
        </button>
      </form>
      <p className="mt-3 text-xs leading-5 text-muted">
        The link carries that role. This page cannot make someone a commander.
      </p>
      {mock ? (
        <p className="mt-2 text-xs leading-5 text-muted">
          Demo invite. It stays in this browser, and it is not a cryptographic link. Open it in another tab so this
          one stays the commander.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-alert">
          {error}
        </p>
      ) : null}
      {invite ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm text-muted">
            Copy this link before you create another. It will not be shown again.
            <LocalTime value={invite.expiresAt} prefix=" Expires " suffix="." />
          </p>
          {httpInviteHref(invite.url) ? (
            <a
              id="invite-url"
              href={invite.url}
              target="_blank"
              rel="noopener noreferrer"
              translate="no"
              className="break-all font-mono text-xs text-signal underline decoration-line underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              {invite.url}
            </a>
          ) : (
            <p id="invite-url" translate="no" className="break-all font-mono text-xs text-foreground select-all">
              {invite.url}
            </p>
          )}
          <button type="button" onClick={() => void copyLink()} className={`${primaryButtonClass} w-fit`}>
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
