"use client";

import { useState, type FormEvent } from "react";
import { FormError, fieldClass, primaryButtonClass } from "@/components/incidents/form-ui";
import { PHONE_ERROR, PHONE_HINT, toUsE164 } from "@/components/org/org-link";
import { PhoneField } from "@/components/org/phone-field";
import { usePasskeyGate } from "@/components/org/use-passkey-ready";
import { PasskeyLockCard } from "@/components/security/passkey-lock-card";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { MAX_ORG_NAME, normalizeOrgName } from "@/spacetimedb/src/shared/org";

export function CreateOrgForm() {
  const gate = usePasskeyGate();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gate.ready) return;
    setError(null);
    const e164 = toUsE164(phone);
    if (!e164) {
      setError(PHONE_ERROR);
      return;
    }
    setPending(true);
    try {
      await getIncidentClient().createOrg({
        name: normalizeOrgName(name),
        displayName: displayName.trim(),
        phone: e164,
      });
      // The number is not kept or shown again.
      setPhone("");
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  const ready = name.trim() !== "" && displayName.trim() !== "" && phone.trim() !== "";

  return (
    <div className="grid max-w-xl gap-5">
      <PasskeyLockCard />
      {gate.reason ? <p className="text-sm leading-6 text-muted">{gate.reason}</p> : null}
      <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-panel px-4 py-4" aria-label="Create org">
        <label className="grid gap-2 text-sm" htmlFor="org-name">
          Org name
          <input
            id="org-name"
            value={name}
            required
            maxLength={MAX_ORG_NAME}
            autoComplete="organization"
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="org-admin-name">
          Your name
          <input
            id="org-admin-name"
            value={displayName}
            required
            maxLength={40}
            autoComplete="name"
            onChange={(event) => setDisplayName(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-2 text-sm" htmlFor="org-admin-phone">
          Your personal mobile number
          <PhoneField id="org-admin-phone" value={phone} onChange={setPhone} />
          <span className="text-xs leading-5 text-muted">{PHONE_HINT} It is not shown again after you submit.</span>
        </label>
        <FormError message={error} />
        <button type="submit" disabled={pending || !ready || !gate.ready} className={`${primaryButtonClass} w-full sm:w-fit`}>
          {pending ? "Creating…" : "Create org"}
        </button>
      </form>
    </div>
  );
}
