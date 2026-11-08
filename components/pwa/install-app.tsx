"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { installSurface, isIosDevice, isIosOtherBrowser, type InstallSurface } from "@/lib/pwa/install-state";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = InstallSurface | "pending" | "dismissed";
type DialogKind = "ios" | "unavailable" | "dismissed";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let sawInstall = false;

const installFlag = globalThis as typeof globalThis & { __havenInstallBound?: boolean };
if (typeof window !== "undefined" && !installFlag.__havenInstallBound) {
  installFlag.__havenInstallBound = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event("haven-install-state"));
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    sawInstall = true;
    window.dispatchEvent(new Event("haven-install-state"));
  });
}

function browserStandalone(): boolean {
  if (sawInstall) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function detectedSurface(): InstallSurface {
  return installSurface({
    standalone: browserStandalone(),
    ios: isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    promptAvailable: deferredPrompt !== null,
  });
}

const controlClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-line px-2.5 text-xs font-medium text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-50";

function useServiceWorker(): void {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      return;
    }

    let stopped = false;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Installation is optional. A failed worker must not break the room.
    });

    const refresh = () => {
      if (stopped || document.visibilityState === "hidden") return;
      void navigator.serviceWorker
        .getRegistration("/")
        .then((registration) => registration?.update())
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
}

export function InstallAppControl() {
  useServiceWorker();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("pending");
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [iosOther, setIosOther] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let settled = false;
    const apply = () => {
      const surface = detectedSurface();
      if (surface === "unavailable" && !settled) return;
      setMode((current) => (current === "dismissed" && surface === "unavailable" ? current : surface));
    };
    apply();
    const timer = window.setTimeout(() => {
      settled = true;
      apply();
    }, 2500);
    const onChange = () => apply();
    window.addEventListener("haven-install-state", onChange);
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    standaloneQuery.addEventListener("change", onChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("haven-install-state", onChange);
      standaloneQuery.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (dialog && !el.open) el.showModal();
    if (!dialog && el.open) el.close();
  }, [dialog]);

  async function install() {
    const event = deferredPrompt;
    if (!event) {
      setDialog("unavailable");
      return;
    }
    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      deferredPrompt = null;
      if (choice.outcome === "accepted") {
        sawInstall = true;
        setMode("standalone");
        return;
      }
      setMode("dismissed");
    } catch {
      deferredPrompt = null;
      setMode("unavailable");
      setDialog("unavailable");
    } finally {
      setBusy(false);
    }
  }

  function openIos() {
    setIosOther(isIosOtherBrowser(navigator.userAgent));
    setDialog("ios");
  }

  const steps = iosOther
    ? ["Open this page in Safari.", "Tap Share.", "Tap Add to Home Screen.", "Tap Add."]
    : ["Tap Share in Safari.", "Tap Add to Home Screen.", "Tap Add."];

  const hidden = mode === "pending" || mode === "standalone";

  return (
    <>
      {mode === "prompt" || mode === "ios" ? (
        <button
          type="button"
          className={controlClass}
          aria-label="Install HAVEN"
          disabled={busy}
          onClick={() => {
            if (mode === "ios") openIos();
            else void install();
          }}
        >
          <Download aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Install</span>
        </button>
      ) : null}
      {mode === "unavailable" || mode === "dismissed" ? (
        <button
          type="button"
          className={controlClass}
          aria-haspopup="dialog"
          onClick={() => setDialog(mode === "dismissed" ? "dismissed" : "unavailable")}
        >
          <span className="sm:hidden">{mode === "dismissed" ? "Later" : "Can't install"}</span>
          <span className="hidden sm:inline">{mode === "dismissed" ? "Install later" : "Install unavailable"}</span>
        </button>
      ) : null}
      <dialog
        ref={dialogRef}
        className="install-dialog"
        aria-labelledby={titleId}
        hidden={hidden && dialog === null ? true : undefined}
        onClose={() => setDialog(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-base font-medium">
            Install HAVEN
          </h2>
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            aria-label="Close"
            onClick={(event) => {
              event.currentTarget.closest("dialog")?.close();
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        {dialog === "ios" ? (
          <>
            <p className="mt-3 text-sm leading-6 text-muted">
              {iosOther ? "Home Screen install on iPhone and iPad uses Safari." : "Add HAVEN from Safari's Share menu."}
            </p>
            <ol className="mt-4 grid gap-2">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-6">
                  <span className="font-mono text-[11px] text-signal">{String(index + 1).padStart(2, "0")}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted">
            {dialog === "dismissed"
              ? "The install prompt was dismissed. You can install HAVEN from the browser menu."
              : "This browser cannot install HAVEN. Use Chrome or Edge on Android, Windows, or Mac. On iPhone and iPad, open this page in Safari and choose Add to Home Screen."}
          </p>
        )}
      </dialog>
    </>
  );
}
