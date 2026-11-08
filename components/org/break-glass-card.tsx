"use client";

/**
 * Printable wallet card. It holds the org name, the HAVEN address and the admin
 * fingerprint, all public. No key, code or token is ever put on it.
 */
export function BreakGlassCard({
  orgName,
  address,
  adminFingerprint,
}: {
  orgName: string;
  address: string;
  adminFingerprint: string | null;
}) {
  return (
    <section aria-labelledby="break-glass-heading" className="grid gap-3">
      <div
        id="break-glass-card"
        className="grid gap-3 rounded-2xl border border-line bg-panel px-4 py-4 print:rounded-none print:border-black print:bg-white print:text-black"
      >
        <span className="font-mono text-[11px] tracking-[0.18em] text-muted print:text-black">HAVEN BREAK-GLASS CARD</span>
        <h2 id="break-glass-heading" className="text-lg font-medium">
          {orgName}
        </h2>
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted print:text-black">HAVEN address</dt>
            <dd translate="no" className="break-all font-mono">
              {address}
            </dd>
          </div>
          {adminFingerprint ? (
            <div>
              <dt className="text-xs text-muted print:text-black">Admin fingerprint</dt>
              <dd translate="no" className="break-all font-mono">
                {adminFingerprint}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="text-sm leading-6">
          HAVEN will never ask you for a code. If you are paged, open HAVEN on your personal phone.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.print()}
        className="no-print inline-flex min-h-11 w-fit items-center justify-center rounded-lg border border-line bg-panel-raised px-4 py-2 text-sm font-medium text-foreground hover:border-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Print this card
      </button>
    </section>
  );
}
