"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/incidents", label: "Incidents" },
  { href: "/join", label: "Join" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-signal font-mono text-sm font-semibold text-signal-ink">
            ZH
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight">ZeroHour</span>
            <span className="block font-mono text-[10px] tracking-[0.18em] text-muted">
              FIRST 72 HOURS
            </span>
          </span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-lg px-3 py-1.5 font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    : "rounded-lg px-3 py-1.5 text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
