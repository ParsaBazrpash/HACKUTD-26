export const fieldClass =
  "min-h-10 w-full min-w-0 rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-lg bg-signal px-4 py-2 text-sm font-medium text-signal-ink hover:bg-signal-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-panel-raised px-4 py-2 text-sm font-medium text-foreground hover:border-signal disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-alert">
      {message}
    </p>
  );
}

export function FormStatus({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="text-sm text-verified">
      {message}
    </p>
  );
}

export function Denied({ children }: { children: string }) {
  return <p className="text-sm leading-6 text-muted">{children}</p>;
}
