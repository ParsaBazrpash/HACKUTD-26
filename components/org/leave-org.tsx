"use client";

import { useState } from "react";
import { FormError, fieldClass, primaryButtonClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import { usePasskeyGate } from "@/components/org/use-passkey-ready";
import { PasskeyLockCard } from "@/components/security/passkey-lock-card";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";

/**
 * Drops this device's own seat. After it succeeds the org page shows the create form.
 * The name typed here is only a confirmation. It is not sent.
 */
export function LeaveOrg({
  confirmText,
  detail,
}: {
  /** The org name, or the person's own name when the org name is not on screen. */
  confirmText: string;
  detail: string;
}) {
  const gate = usePasskeyGate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed === confirmText;

  async function leave() {
    if (!gate.ready || !matches) return;
    setPending(true);
    setError(null);
    try {
      await getIncidentClient().leaveOrg();
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="grid gap-2">
        <p className="text-sm leading-6 text-muted">{detail}</p>
        <button type="button" onClick={() => setOpen(true)} className={`${secondaryButtonClass} w-fit`}>
          Leave org
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void leave();
      }}
      className="grid gap-3"
      aria-label="Leave org"
    >
      <PasskeyLockCard when="locked" />
      {gate.reason ? <p className="text-sm leading-6 text-muted">{gate.reason}</p> : null}
      <p className="text-sm leading-6 text-muted">{detail}</p>
      <label className="grid gap-2 text-sm" htmlFor="leave-org-confirm">
        Type <bdi>{confirmText}</bdi> to confirm
        <input
          id="leave-org-confirm"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
          className={fieldClass}
        />
      </label>
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !matches || !gate.ready} className={primaryButtonClass}>
          {pending ? "Leaving…" : "Leave org"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          className={secondaryButtonClass}
        >
          Stay
        </button>
      </div>
    </form>
  );
}
