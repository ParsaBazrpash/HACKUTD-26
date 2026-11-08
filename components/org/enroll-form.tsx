"use client";

import { useCallback, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { DemoBanner } from "@/components/incidents/demo-banner";
import { FormError, fieldClass, primaryButtonClass } from "@/components/incidents/form-ui";
import { BreakGlassCard } from "@/components/org/break-glass-card";
import { fingerprintFromEnrollFragment } from "@/components/org/break-glass-model";
import { PhoneField } from "@/components/org/phone-field";
import { applyEnrollHash, PHONE_ERROR, PHONE_HINT, toUsE164 } from "@/components/org/org-link";
import { usePasskeyGate } from "@/components/org/use-passkey-ready";
import { PasskeyLockCard } from "@/components/security/passkey-lock-card";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { useIncident } from "@/hooks/use-incident";

function emptyFragment(): null {
  return null;
}

/** Reads the fragment once, then removes it from the address bar. First snapshot is null so hydration matches. */
function useEnrollFragment(): string | null {
  const box = useRef({ value: null as string | null, ready: false, listeners: new Set<() => void>() });
  const subscribe = useCallback((listener: () => void) => {
    const current = box.current;
    current.listeners.add(listener);
    if (!current.ready) {
      current.ready = true;
      current.value = applyEnrollHash(window.location.hash, (url) => {
        window.history.replaceState(null, "", url);
      });
      queueMicrotask(() => {
        for (const item of current.listeners) item();
      });
    }
    return () => {
      current.listeners.delete(listener);
    };
  }, []);
  const getSnapshot = useCallback(() => box.current.value, []);
  return useSyncExternalStore(subscribe, getSnapshot, emptyFragment);
}

export function EnrollForm() {
  const fragment = useEnrollFragment();
  const gate = usePasskeyGate();
  const state = useIncident();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ safetyCode: string; address: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fragment || !gate.ready) return;
    setError(null);
    const e164 = toUsE164(phone);
    if (!e164) {
      setError(PHONE_ERROR);
      return;
    }
    setPending(true);
    try {
      const result = await getIncidentClient().enroll({ fragment, displayName: displayName.trim(), phone: e164 });
      // The number is not kept or shown again.
      setPhone("");
      setDone({ safetyCode: result.safetyCode, address: window.location.origin });
    } catch (cause) {
      setError(clientErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid max-w-xl gap-5">
      <div className="no-print grid gap-5">
        <DemoBanner />
        {done ? null : <PasskeyLockCard />}
        {fragment === null ? <p className="text-sm text-muted">Reading the enrollment link…</p> : null}
        {fragment === "" && !done ? (
          <p className="text-sm leading-6 text-muted">
            No enrollment link is loaded. Open the link from your org admin.
          </p>
        ) : null}
        {done ? null : gate.reason && fragment ? <p className="text-sm leading-6 text-muted">{gate.reason}</p> : null}
        {done ? null : (
          <form onSubmit={submit} className="grid gap-4" aria-label="Enroll">
            <label className="grid gap-2 text-sm" htmlFor="enroll-name">
              Your name
              <input
                id="enroll-name"
                value={displayName}
                required
                maxLength={40}
                autoComplete="name"
                onChange={(event) => setDisplayName(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor="enroll-phone">
              Your personal mobile number
              <PhoneField id="enroll-phone" value={phone} onChange={setPhone} />
              <span className="text-xs leading-5 text-muted">{PHONE_HINT} It is not shown again after you submit.</span>
            </label>
            <FormError message={error} />
            <button
              type="submit"
              disabled={pending || !fragment || !gate.ready || !displayName.trim() || !phone.trim()}
              className={`${primaryButtonClass} w-full sm:w-fit`}
            >
              {pending ? "Enrolling…" : "Enroll"}
            </button>
          </form>
        )}
        {done ? (
          <section role="status" aria-labelledby="safety-code-heading" className="grid gap-2 rounded-2xl border border-line bg-panel px-4 py-4">
            <h2 id="safety-code-heading" className="font-mono text-[11px] tracking-[0.18em] text-muted">
              YOUR SAFETY CODE
            </h2>
            <p translate="no" className="font-mono text-3xl tracking-widest">
              {done.safetyCode}
            </p>
            <p className="text-sm leading-6 text-muted">
              Read this to your admin. They approve you only after you read it to them on a call or in person.
            </p>
          </section>
        ) : null}
      </div>
      {done ? (
        <BreakGlassCard
          orgName={state.org?.name ?? null}
          address={done.address}
          adminFingerprint={state.org?.adminFingerprint ?? fingerprintFromEnrollFragment(fragment)}
        />
      ) : null}
    </div>
  );
}
