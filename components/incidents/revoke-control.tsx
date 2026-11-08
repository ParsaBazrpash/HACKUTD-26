"use client";

import { useState, type FormEvent } from "react";
import { RefreshCw, UserX } from "lucide-react";
import { FormError, FormStatus, fieldClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import {
  inviteRequest,
  REPLACE_DEVICE_REASON,
  replaceDeviceEnabled,
  REVOKE_REASON_MAX,
  revokeConfirmPhrase,
  revokeConfirmed,
  revokeEnabled,
} from "@/components/incidents/room-controls";
import { LocalTime } from "@/components/local-time";
import { useBrowserNow } from "@/hooks/use-browser-now";
import { looksStale } from "@/lib/client/presence";
import { SafeText } from "@/components/incidents/safe-text";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { MemberView } from "@/lib/client/types";

const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-alert px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alert";

const openButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-alert/60 px-3 py-2 text-sm font-medium text-alert hover:bg-alert/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alert";

type Mode = "revoke" | "replace";
type Reissued = { name: string; url: string; expiresAt: Date };

/**
 * Commander-only revoke for an active member, plus Replace device: the same revoke followed by a
 * new invite for the same role, for someone who lost the browser or device that held their keys.
 * The new browser joins with new keys and the commander checks its safety code before admitting,
 * exactly like any other invite. The old keys stay revoked forever.
 *
 * Commander-only revoke for an active member. The client signs the revocation, rotates every channel
 * the member could read to a new key for everyone else, and logs `roster.revoke` in #record.
 */
export function RevokeControl({ member }: { member: MemberView }) {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const now = useBrowserNow();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("revoke");
  const [reissued, setReissued] = useState<Reissued | null>(null);
  const [copied, setCopied] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (reissued) return <ReissuedInvite invite={reissued} copied={copied} onCopied={setCopied} />;
  if (notice) return <FormStatus message={notice} />;
  // The server can accept the revoke and then the #record entry can fail. The row already shows
  // revoked by then, so keep the error on screen instead of hiding it with the form.
  if (!revokeEnabled(state.me, member)) {
    return error ? <FormError message={`Access was removed, but the record entry failed: ${error}`} /> : null;
  }

  const phrase = revokeConfirmPhrase(member);
  const confirmed = revokeConfirmed(member, typed);
  const id = `revoke-${member.memberId.toString()}`;

  const canReplace = replaceDeviceEnabled(state.me, member);
  const stale = now !== null && looksStale(member, now);

  function start(next: Mode) {
    setMode(next);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setTyped("");
    setReason("");
    setError(null);
  }

  async function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || !revokeEnabled(state.me, member)) return;
    setBusy(true);
    setError(null);
    const replacing = mode === "replace" && canReplace;
    const signedReason = reason.trim().slice(0, REVOKE_REASON_MAX) || (replacing ? REPLACE_DEVICE_REASON : "");
    let revoked = false;
    try {
      await getIncidentClient().revokeMember(member.memberId, signedReason);
      revoked = true;
      if (replacing) {
        const created = await getIncidentClient().createInvite(inviteRequest(member.role));
        setReissued({ name: member.displayName, url: created.url, expiresAt: created.expiresAt });
        return;
      }
      setNotice(
        mock
          ? `Revoked ${member.displayName} in the demo. No keys rotate in the demo.`
          : `Revoked ${member.displayName}. Their channels now use new keys.`,
      );
    } catch (cause) {
      if (revoked && replacing) {
        setNotice(
          `Revoked ${member.displayName} and rotated keys, but the new invite failed: ${clientErrorMessage(cause)} Create one under Invite people.`,
        );
      } else {
        setError(clientErrorMessage(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="grid gap-2">
        {stale && canReplace ? (
          <p className="text-xs leading-5 text-muted">
            None of their browsers has been connected for a while. Admitted does not mean they can still open the
            room. If they lost the browser or device that held their keys, use Replace device.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {canReplace ? (
            <button type="button" onClick={() => start("replace")} className={secondaryButtonClass}>
              <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
              Replace device
            </button>
          ) : null}
          <button type="button" onClick={() => start("revoke")} className={openButtonClass}>
            <UserX aria-hidden="true" className="size-4" />
            Revoke access
          </button>
        </div>
      </div>
    );
  }

  const replacing = mode === "replace" && canReplace;

  return (
    <form
      onSubmit={(event) => void revoke(event)}
      aria-label={replacing ? `Replace device for ${member.displayName}` : `Revoke ${member.displayName}`}
      className="grid gap-3 rounded-xl border border-alert/50 bg-panel p-4"
    >
      <p className="text-sm font-medium text-foreground">
        {replacing ? "Replace device for " : "Revoke "}
        <SafeText text={member.displayName} />
      </p>
      {replacing ? (
        <p className="text-sm leading-6 text-muted">
          Use this when they lost the browser or device that holds their keys. Their old seat is revoked and every
          channel they could read gets a new key, so the lost device can never read anything new. Then you get a new
          invite link for the same role. Send it to them yourself, have them open it on the web address you use, and
          check the safety code with them before you admit them.
        </p>
      ) : null}
      <p className="text-sm leading-6 text-muted">
        They lose access to this room at once. Every channel they could read gets a new key, so nothing sent after
        this reaches them, and their device wipes its keys for this room. What they already saw cannot be taken back.
        To return they need a new invite or a fresh enrollment, and you admit them again.
      </p>
      {mock ? (
        <p className="text-xs leading-5 text-muted">Demo room. Access is marked revoked here, but no keys rotate in the demo.</p>
      ) : null}
      <label className="grid gap-2 text-sm text-muted" htmlFor={`${id}-reason`}>
        Reason (optional, signed into the record)
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={REVOKE_REASON_MAX}
          onChange={(event) => setReason(event.target.value)}
          autoComplete="off"
          className={fieldClass}
        />
      </label>
      <label className="grid gap-2 text-sm text-muted" htmlFor={`${id}-confirm`}>
        <span>
          Type <span translate="no" className="whitespace-pre-wrap break-words font-medium text-foreground">{phrase}</span> to
          confirm
        </span>
        <input
          id={`${id}-confirm`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className={fieldClass}
        />
      </label>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!confirmed || busy} className={dangerButtonClass}>
          <UserX aria-hidden="true" className="size-4" />
          {busy ? (replacing ? "Replacing…" : "Revoking…") : replacing ? "Revoke old device and create invite" : "Revoke and rotate keys"}
        </button>
        <button type="button" onClick={close} disabled={busy} className={secondaryButtonClass}>
          Keep access
        </button>
      </div>
    </form>
  );
}

function ReissuedInvite({
  invite,
  copied,
  onCopied,
}: {
  invite: Reissued;
  copied: boolean;
  onCopied: (value: boolean) => void;
}) {
  const [copyError, setCopyError] = useState<string | null>(null);
  const safeHref = (() => {
    try {
      const parsed = new URL(invite.url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  })();

  async function copy() {
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(invite.url);
      onCopied(true);
    } catch {
      onCopied(false);
      setCopyError("Copy failed. Select the link and copy it.");
    }
  }

  return (
    <div role="status" className="grid gap-3 rounded-xl border border-line bg-panel p-4">
      <p className="text-sm font-medium text-foreground">
        Old device revoked. New invite for <SafeText text={invite.name} />
      </p>
      <p className="text-sm leading-6 text-muted">
        Send this link to them over a channel you trust. When they open it, a new join request appears here. Compare
        the safety code with them by voice before you admit it. The link works once and expires{" "}
        <LocalTime value={invite.expiresAt} />.
      </p>
      <p translate="no" className="break-all rounded-lg border border-line bg-panel-raised p-3 font-mono text-xs text-foreground">
        {safeHref ? invite.url : "The invite link was not a web address, so it is not shown."}
      </p>
      {safeHref ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void copy()} className={secondaryButtonClass}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      ) : null}
      <FormError message={copyError} />
    </div>
  );
}
