"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, User, X } from "lucide-react";
import { InstallAppControl } from "@/components/pwa/install-app";

function incidentIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/incidents\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

const LAST_INCIDENT_KEY = "haven.lastIncident";

function readLastIncident(): string | null {
  try {
    const v = window.sessionStorage.getItem(LAST_INCIDENT_KEY);
    return v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Members: the open incident's People & Access tab. Off an incident page it returns to the last incident
 * seen this session, and with none it opens the org roster, so the link always goes somewhere different
 * from where the person already is.
 */
function useMembersHref(pathname: string | null): string {
  const current = incidentIdFromPath(pathname);
  useEffect(() => {
    if (!current) return;
    try {
      window.sessionStorage.setItem(LAST_INCIDENT_KEY, current);
    } catch {
      // Storage can be blocked; the link then falls back to the org roster.
    }
  }, [current]);
  const last = useSyncExternalStore(subscribeNever, readLastIncident, () => null);
  const id = current ?? last;
  return id ? `/incidents/${id}/people` : "/org";
}

const subscribeNever = (): (() => void) => () => {};

function itemClass(active: boolean): string {
  return active
    ? "text-[15px] font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
    : "text-[15px] text-white transition-colors hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal";
}

function HavenMark() {
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

function PrimaryLinks({
  pathname,
  onNavigate,
  stacked = false,
}: {
  pathname: string | null;
  onNavigate?: () => void;
  stacked?: boolean;
}) {
  const membersHref = useMembersHref(pathname);
  const onPeople = pathname !== null && /\/people(?:\/|$)/.test(pathname);
  const onIncidents = pathname !== null && pathname.startsWith("/incidents") && !onPeople;
  const onJoin = pathname === "/join" || (pathname !== null && pathname.startsWith("/join/"));
  const onOrg = pathname === "/org" || (pathname !== null && pathname.startsWith("/org/"));
  const links = [
    { href: "/incidents", label: "Incidents", active: onIncidents },
    { href: membersHref, label: "Members", active: onPeople },
    { href: "/org", label: "Org", active: onOrg },
    { href: "/join", label: "Join", active: onJoin },
  ];
  return (
    <>
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          aria-current={link.active ? "page" : undefined}
          className={stacked ? `${itemClass(link.active)} py-2` : itemClass(link.active)}
          onClick={onNavigate}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}

function PrimaryNav({ onNavigate, stacked = false }: { onNavigate?: () => void; stacked?: boolean }) {
  const pathname = usePathname();
  return <PrimaryLinks pathname={pathname} onNavigate={onNavigate} stacked={stacked} />;
}

function AccountLink({ pathname }: { pathname: string | null }) {
  const membersHref = useMembersHref(pathname);
  return (
    <Link
      href={membersHref}
      aria-label="People and access"
      className="grid size-9 place-items-center rounded-full border border-white/15 text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <User aria-hidden="true" className="size-4" />
    </Link>
  );
}

function AccountSlot() {
  const pathname = usePathname();
  return <AccountLink pathname={pathname} />;
}

const getStartedClass =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-signal px-5 text-sm font-medium text-signal transition-colors hover:bg-signal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

export function SiteHeader() {
  return (
    <header className="relative z-30">
      <div className="mx-auto flex h-20 w-full max-w-[1440px] items-center gap-3 px-5 sm:px-10 lg:px-14">
        <Link
          href="/"
          className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
        >
          <HavenMark />
        </Link>
        <nav aria-label="Primary" className="ml-auto hidden items-center gap-9 lg:flex">
          <Suspense fallback={<PrimaryLinks pathname={null} />}>
            <PrimaryNav />
          </Suspense>
        </nav>
        <div className="ml-auto hidden lg:ml-0 lg:block">
          <InstallAppControl />
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:ml-0">
          <div className="hidden sm:block">
            <Suspense fallback={<AccountLink pathname={null} />}>
              <AccountSlot />
            </Suspense>
          </div>
          <Link href="/incidents" className={getStartedClass}>
            Get Started
          </Link>
          <details className="group relative lg:hidden">
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
              <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3 sm:hidden">
                <Suspense fallback={<AccountLink pathname={null} />}>
                  <AccountSlot />
                </Suspense>
              </div>
              <div className="mt-3 border-t border-white/10 pt-3">
                <InstallAppControl />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
