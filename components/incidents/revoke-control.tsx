"use client";

import { useState, type FormEvent } from "react";
import { UserX } from "lucide-react";
import { FormError, FormStatus, fieldClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import {
  REVOKE_REASON_MAX,
  revokeConfirmPhrase,
  revokeConfirmed,
  revokeEnabled,
} from "@/components/incidents/room-controls";
import { SafeText } from "@/components/incidents/safe-text";
import { useIncident } from "@/hooks/use-incident";
import { getIncidentClient, isMockIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import type { MemberView } from "@/lib/client/types";

const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-alert px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alert";

const openButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-alert/60 px-3 py-2 text-sm font-medium text-alert hover:bg-alert/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alert";

/**
 * Commander-only revoke for an active member. The client signs the revocation, rotates every channel
 * the member could read to a new key for everyone else, and logs `roster.revoke` in #record.
 */
export function RevokeControl({ member }: { member: MemberView }) {
  const state = useIncident();
  const mock = isMockIncidentClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (notice) return <FormStatus message={notice} />;
  if (!revokeEnabled(state.me, member)) return null;

  const phrase = revokeConfirmPhrase(member);
  const confirmed = revokeConfirmed(member, typed);
  const id = `revoke-${member.memberId.toString()}`;

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
    try {
      await getIncidentClient().revokeMember(member.memberId, reason.trim().slice(0, REVOKE_REASON_MAX));
      setNotice(
        mock
          ? `Revoked ${member.displayName} in the demo. No keys rotate in the demo.`
          : `Revoked ${member.displayName}. Their channels now use new keys.`,
      );
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)} className={openButtonClass}>
          <UserX aria-hidden="true" className="size-4" />
          Revoke access
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void revoke(event)}
      aria-label={`Revoke ${member.displayName}`}
      className="grid gap-3 rounded-xl border border-alert/50 bg-panel p-4"
    >
      <p className="text-sm font-medium text-foreground">
        Revoke <SafeText text={member.displayName} />
      </p>
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
          {busy ? "Revoking…" : "Revoke and rotate keys"}
        </button>
        <button type="button" onClick={close} disabled={busy} className={secondaryButtonClass}>
          Keep access
        </button>
      </div>
    </form>
  );
}
