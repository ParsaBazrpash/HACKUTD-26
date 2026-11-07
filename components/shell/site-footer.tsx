export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>
          <span className="font-semibold tracking-tight text-foreground">HAVEN</span>
          <span aria-hidden="true"> · </span>
          Plaintext and channel keys stay in the browser.
        </p>
        <p>HackUTD 2026 · SpacetimeDB · Winstead</p>
      </div>
    </footer>
  );
}
