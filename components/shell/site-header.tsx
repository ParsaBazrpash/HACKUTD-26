"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isMockIncidentClient } from "@/lib/client";

const links = [
  { href: "/incidents", label: "Incidents" },
  { href: "/join", label: "Join" },
];

function linkClass(active: boolean): string {
  return active
    ? "rounded-lg px-3 py-1.5 font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    : "rounded-lg px-3 py-1.5 text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";
}

function PrimaryNavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
      {links.map((link) => {
        const active =
          pathname !== null && (pathname === link.href || pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={linkClass(active)}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

function PrimaryNav() {
  const pathname = usePathname();
  return <PrimaryNavLinks pathname={pathname} />;
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
        >
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg bg-signal font-mono text-sm font-semibold tracking-tight text-signal-ink"
          >
            HV
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight">HAVEN</span>
            <span className="block font-mono text-[10px] tracking-[0.18em] text-muted">
              FIRST 72 HOURS
              {isMockIncidentClient() ? " · DEMO DATA" : ""}
            </span>
          </span>
        </Link>
        {/* usePathname suspends when a dynamic segment is unknown at prerender.
            The fallback keeps the same links so navigation stays usable. */}
        <Suspense fallback={<PrimaryNavLinks pathname={null} />}>
          <PrimaryNav />
        </Suspense>
      </div>
    </header>
  );
}
