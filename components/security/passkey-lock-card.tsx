"use client";

import { useState, useSyncExternalStore } from "react";
import { Fingerprint, LockKeyhole, ShieldCheck, WifiOff } from "lucide-react";
import { FormError, primaryButtonClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import { isMockIncidentClient } from "@/lib/client";
import {
  getDeviceVault,
  PASSKEY_LOCK_SERVER_STATE,
  type PasskeyLockState,
} from "@/lib/client/passkey-lock";

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  return getDeviceVault().subscribe(listener);
}

function getSnapshot(): PasskeyLockState {
  if (typeof window === "undefined") return PASSKEY_LOCK_SERVER_STATE;
  return getDeviceVault().getState();
}

/** Passkey lock state for this browser. */
export function usePasskeyLock(): PasskeyLockState {
  return useSyncExternalStore(subscribe, getSnapshot, () => PASSKEY_LOCK_SERVER_STATE);
}

const TRUST_POINTS = [
  { Icon: LockKeyhole, title: "End-to-end encrypted", text: "Messages are sealed in your browser. The server never sees them." },
  { Icon: ShieldCheck, title: "Signed and checked", text: "Every entry is signed by its author, so edits are caught." },
  { Icon: WifiOff, title: "Works when company systems are down", text: "No company login or email needed. Only this device." },
];

/**
 * Self-contained card for the opt-in passkey lock: turn on, unlock, lock now,
 * turn off. Every passkey prompt starts from a button press, which Safari
 * requires. Renders nothing in the browser demo (mock client).
 * `when="locked"` shows it only while keys wait for the passkey.
 */
export function PasskeyLockCard({ when = "always" }: { when?: "always" | "locked" }) {
  const state = usePasskeyLock();
  const [confirmOff, setConfirmOff] = useState(false);

  if (isMockIncidentClient() || state.status === "checking") return null;
  if (when === "locked" && state.status !== "locked") return null;

  const act = (fn: () => Promise<void> | void) => () => {
    setConfirmOff(false);
    // Errors are shown from state.error.
    void Promise.resolve()
      .then(fn)
      .catch(() => undefined);
  };
  const vault = () => getDeviceVault();

  let heading: string;
  let body: string;
  if (state.status === "unsupported") {
    heading = "Passkey lock unavailable";
    body = "This browser cannot lock keys with a passkey. Your keys stay protected by the browser as usual.";
  } else if (state.status === "off") {
    heading = "Passkey lock is off";
    body =
      "Lock this device's keys behind your fingerprint, face or PIN, so a lost or borrowed device cannot read your incident. It covers incidents you create or join after you turn it on.";
  } else if (state.status === "locked") {
    heading = state.lockedIncidents > 0 ? "Your keys are locked" : "Passkey lock is on";
    body =
      state.lockedIncidents > 0
        ? "Unlock with your passkey to open your incidents in this tab."
        : "Unlock with your passkey before you create or join an incident.";
  } else {
    heading = "Passkey lock is on";
    body = "Your keys are unlocked in this tab until you close it or lock them.";
  }

  const welcome = state.status === "off" || state.status === "locked";

  return (
    <section
      aria-labelledby="passkey-lock-heading"
      className={
        welcome
          ? "relative grid gap-5 overflow-hidden rounded-2xl border border-line bg-panel px-5 py-6 shadow-[0_0_60px_-30px_var(--signal)] sm:px-7 sm:py-7"
          : "grid gap-3 rounded-2xl border border-line bg-panel px-4 py-4"
      }
    >
      {welcome ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-signal/10 blur-3xl"
        />
      ) : null}
      <div className="relative flex items-start gap-4">
        {welcome ? (
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-signal/40 bg-signal/10 text-signal"
          >
            <Fingerprint className="h-6 w-6" />
          </span>
        ) : null}
        <div className="grid gap-1">
          <span className="font-mono text-[11px] tracking-[0.16em] text-muted">DEVICE KEYS</span>
          <h2 id="passkey-lock-heading" className={welcome ? "text-xl font-medium tracking-tight" : "text-base font-medium"}>
            {heading}
          </h2>
          <p className="text-sm leading-6 text-muted">{body}</p>
        </div>
      </div>
      {welcome ? (
        <ul className="relative grid gap-3 sm:grid-cols-3">
          {TRUST_POINTS.map(({ Icon, title, text }) => (
            <li key={title} className="grid content-start gap-1.5 rounded-xl border border-line bg-panel-raised px-3.5 py-3">
              <Icon aria-hidden="true" className="h-4 w-4 text-signal" />
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs leading-5 text-muted">{text}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {state.busy ? (
        <p role="status" className="text-sm text-muted">
          Waiting for your passkey…
        </p>
      ) : null}
      <div className="relative flex flex-wrap gap-2">
        {state.status === "off" ? (
          <button type="button" className={`${primaryButtonClass} min-h-11 w-full gap-2 sm:w-fit`} disabled={state.busy} onClick={act(() => vault().enable())}>
            <Fingerprint aria-hidden="true" className="h-4 w-4" />
            Lock my keys with a passkey
          </button>
        ) : null}
        {state.status === "locked" ? (
          <button type="button" className={`${primaryButtonClass} min-h-11 w-full gap-2 sm:w-fit`} disabled={state.busy} onClick={act(() => vault().unlock())}>
            <Fingerprint aria-hidden="true" className="h-4 w-4" />
            Unlock with passkey
          </button>
        ) : null}
        {state.status === "unlocked" && !confirmOff ? (
          <>
            <button type="button" className={secondaryButtonClass} disabled={state.busy} onClick={act(() => vault().lock())}>
              Lock now
            </button>
            <button type="button" className={secondaryButtonClass} disabled={state.busy} onClick={() => setConfirmOff(true)}>
              Turn off
            </button>
          </>
        ) : null}
        {state.status === "unlocked" && confirmOff ? (
          <>
            <p className="w-full text-sm text-muted">
              Turning it off stores your keys the way the browser does without a passkey. You can then delete the
              &quot;HAVEN device lock&quot; passkey.
            </p>
            <button type="button" className={primaryButtonClass} disabled={state.busy} onClick={act(() => vault().disable())}>
              Turn off the passkey lock
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setConfirmOff(false)}>
              Keep it on
            </button>
          </>
        ) : null}
      </div>
      <FormError message={state.error} />
    </section>
  );
}
