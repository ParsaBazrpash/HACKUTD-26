"use client";

import { Suspense, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

function itemClass(active: boolean): string {
  return active
    ? "text-[15px] font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
    : "text-[15px] text-white transition-colors hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal";
}

export function HavenMark() {
  return (
    <span className="flex flex-col items-center leading-none">
      <svg aria-hidden="true" viewBox="0 0 36 14" className="h-2.5 w-9 text-signal">
        <path
          d="M2 12 18 2l16 10"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.6"
        />
      </svg>
      <span className="mt-1.5 text-base font-semibold tracking-[0.18em] text-white">HAVEN</span>
    </span>
  );
}

/** Closes the phone menu (a <details>) once a link in it is tapped. */
function closeMenu(event: MouseEvent<HTMLAnchorElement>): void {
  event.currentTarget.closest("details")?.removeAttribute("open");
}

function startsWith(pathname: string | null, base: string): boolean {
  return pathname === base || (pathname !== null && pathname.startsWith(`${base}/`));
}

function PrimaryLinks({ pathname, stacked = false }: { pathname: string | null; stacked?: boolean }) {
  const links = [
    { href: "/incidents", label: "Incidents", active: startsWith(pathname, "/incidents") },
    { href: "/org", label: "Org", active: startsWith(pathname, "/org") },
    { href: "/join", label: "Join", active: startsWith(pathname, "/join") },
  ];
  return (
    <>
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          aria-current={link.active ? "page" : undefined}
          className={stacked ? `${itemClass(link.active)} py-2` : itemClass(link.active)}
          onClick={stacked ? closeMenu : undefined}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}

function PrimaryNav({ stacked = false }: { stacked?: boolean }) {
  const pathname = usePathname();
  return <PrimaryLinks pathname={pathname} stacked={stacked} />;
}

/**
 * Site-wide header. Inside an incident the room's own sidebar takes over, so the header hides
 * itself whenever the page holds the incident room.
 */
export function SiteHeader() {
  return (
    <header className="relative z-30 [body:has(#incident-room)_&]:hidden">
      <div className="mx-auto flex h-20 w-full max-w-[1440px] items-center gap-3 px-5 sm:px-10 lg:px-14">
        <Link
          href="/"
          className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
        >
          <HavenMark />
        </Link>
        <nav aria-label="Primary" className="ml-auto hidden items-center gap-9 sm:flex">
          <Suspense fallback={<PrimaryLinks pathname={null} />}>
            <PrimaryNav />
          </Suspense>
        </nav>
        <details className="group relative ml-auto sm:hidden">
          <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal [&::-webkit-details-marker]:hidden">
            <Menu aria-hidden="true" className="size-5 group-open:hidden" />
            <X aria-hidden="true" className="hidden size-5 group-open:block" />
            <span className="sr-only">Menu</span>
          </summary>
          <div className="absolute right-0 top-full z-40 mt-2 w-[min(18rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-black p-4 shadow-2xl">
            <nav aria-label="Primary" className="flex flex-col">
              <Suspense fallback={<PrimaryLinks pathname={null} stacked />}>
                <PrimaryNav stacked />
              </Suspense>
            </nav>
          </div>
        </details>
      </div>
    </header>
  );
}
