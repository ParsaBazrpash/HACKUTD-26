"use client";

import { useEffect, useState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/incidents/form-ui";
import { saveCardImage } from "@/components/org/break-glass-image";
import { CARD_FOOTER, CARD_HOW_TO, CARD_NO_FINGERPRINT, CARD_PURPOSE, CARD_REPLACE, cardQrText } from "@/components/org/break-glass-model";

const labelClass = "font-mono text-[11px] tracking-[0.18em] text-muted";

/**
 * Pocket card. It holds the org name, the HAVEN address and the admin fingerprint,
 * all public. No code, key, token or enrollment link is ever put on it.
 */
export function BreakGlassCard({
  orgName,
  address,
  adminFingerprint,
}: {
  orgName: string | null;
  address: string;
  adminFingerprint: string | null;
}) {
  const [qrState, setQr] = useState<{ text: string; url: string } | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const qrText = cardQrText(address);
  const qr = qrState && qrState.text === qrText ? qrState.url : null;

  useEffect(() => {
    let live = true;
    if (!qrText) return;
    void (async () => {
      try {
        const { toDataURL } = await import("qrcode");
        const url = await toDataURL(qrText, {
          margin: 1,
          width: 224,
          errorCorrectionLevel: "M",
          color: { dark: "#080a09", light: "#f5f5f3" },
        });
        if (live && url.startsWith("data:image/")) setQr({ text: qrText, url });
      } catch {
        // No QR. The address and fingerprint stay on the card.
      }
    })();
    return () => {
      live = false;
    };
  }, [qrText]);

  async function save() {
    setStatus(null);
    try {
      const result = await saveCardImage({ orgName, address, adminFingerprint, qr });
      setStatus(result === "cancelled" ? null : { text: "Saved.", error: false });
    } catch {
      setStatus({ text: "Could not make the image. Use Print instead.", error: true });
    }
  }

  return (
    <section aria-labelledby="break-glass-heading" className="grid gap-4">
      <div
        id="break-glass-card"
        className="grid gap-4 rounded-2xl border border-line bg-panel px-4 py-4 print:rounded-none print:border-black print:bg-white print:text-black"
      >
        <div className="flex items-center justify-between gap-3">
          <span className={`${labelClass} print:text-black`}>HAVEN BREAK-GLASS CARD</span>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted print:border-black print:text-black">
            NOT A KEY
          </span>
        </div>
        <div className="grid gap-1">
          <h2 id="break-glass-heading" className="text-lg font-medium">
            {orgName?.trim() ? <bdi>{orgName}</bdi> : "Your HAVEN card"}
          </h2>
          <p className="text-sm leading-6 text-muted print:text-black">{CARD_PURPOSE}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <dl className="grid content-start gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted print:text-black">HAVEN address</dt>
              <dd translate="no" className="break-all font-mono">
                {address}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted print:text-black">Admin fingerprint</dt>
              {adminFingerprint ? (
                <dd translate="no" className="break-words font-mono">
                  {adminFingerprint}
                </dd>
              ) : (
                <dd className="text-sm text-muted print:text-black">{CARD_NO_FINGERPRINT}</dd>
              )}
            </div>
          </dl>
          {qrText ? (
            <div className="grid justify-items-start gap-1 sm:justify-items-center">
              {qr ? (
                // Browser-generated data URL. next/image does not optimize those.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR code for the HAVEN address" width={112} height={112} className="h-28 w-28 rounded-lg" />
              ) : (
                <div className="h-28 w-28 rounded-lg" aria-hidden="true" />
              )}
              <span className="text-[11px] text-muted print:text-black">Opens the address only</span>
            </div>
          ) : null}
        </div>
        <div className="grid gap-1 text-sm leading-6">
          <p>{CARD_FOOTER}</p>
          <p className="text-muted print:text-black">{CARD_REPLACE}</p>
        </div>
      </div>
      <div className="no-print flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} className={primaryButtonClass}>
          Save as image
        </button>
        <button type="button" onClick={() => window.print()} className={secondaryButtonClass}>
          Print
        </button>
      </div>
      <p role="status" className={`no-print min-h-5 text-sm ${status?.error ? "text-alert" : "text-muted"}`}>
        {status?.text ?? ""}
      </p>
      <div className="no-print grid gap-4 rounded-2xl border border-line bg-panel px-4 py-4 text-sm leading-6">
        <div>
          <h3 className={labelClass}>{CARD_HOW_TO.handyTitle}</h3>
          <ul className="mt-2 grid list-disc gap-2 pl-5">
            {CARD_HOW_TO.handy.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={labelClass}>{CARD_HOW_TO.whenTitle}</h3>
          <p className="mt-2">{CARD_HOW_TO.when}</p>
        </div>
        <div>
          <h3 className={labelClass}>{CARD_HOW_TO.whereTitle}</h3>
          <p className="mt-2">{CARD_HOW_TO.where}</p>
        </div>
        <div>
          <h3 className={labelClass}>{CARD_HOW_TO.howTitle}</h3>
          <ol className="mt-2 grid list-decimal gap-2 pl-5">
            {CARD_HOW_TO.how.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
