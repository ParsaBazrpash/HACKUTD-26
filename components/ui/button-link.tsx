import Link from "next/link";

const control =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function ButtonLink({
  href,
  children,
  variant = "solid",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "ghost";
}) {
  const styles =
    variant === "solid"
      ? "bg-signal text-signal-ink hover:bg-signal-hover"
      : "border border-line bg-panel text-foreground hover:border-signal";

  return (
    <Link href={href} className={`${control} ${styles}`}>
      {children}
    </Link>
  );
}
