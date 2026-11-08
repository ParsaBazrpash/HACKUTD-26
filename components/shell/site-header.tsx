"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
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
    ? "inline-flex h-full items-center border-b-2 border-signal px-2 text-sm font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:px-3"
    : "inline-flex h-full items-center border-b-2 border-transparent px-2 text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:px-3";
}

function PrimaryNavLinks({ pathname }: { pathname: string | null }) {
  const membersHref = useMembersHref(pathname);
  const onPeople = pathname !== null && /\/people(?:\/|$)/.test(pathname);
  const onIncidents = pathname !== null && pathname.startsWith("/incidents") && !onPeople;
  const onJoin = pathname === "/join" || (pathname !== null && pathname.startsWith("/join/"));
  const onOrg = pathname === "/org" || (pathname !== null && pathname.startsWith("/org/"));
  return (
    <nav aria-label="Primary" className="-mb-px flex h-full min-w-0 items-stretch justify-start gap-1 overflow-x-auto sm:justify-center sm:gap-2">
      <Link href="/incidents" aria-current={onIncidents ? "page" : undefined} className={itemClass(onIncidents)}>
        Incidents
      </Link>
      <Link
        href={membersHref}
        aria-current={onPeople ? "page" : undefined}
        className={itemClass(onPeople)}
      >
        Members
      </Link>
      <Link href="/org" aria-current={onOrg ? "page" : undefined} className={itemClass(onOrg)}>
        Org
      </Link>
      <Link href="/join" aria-current={onJoin ? "page" : undefined} className={itemClass(onJoin)}>
        Join
      </Link>
    </nav>
  );
}

function PrimaryNav() {
  const pathname = usePathname();
  return <PrimaryNavLinks pathname={pathname} />;
}

function AccountLink({ pathname }: { pathname: string | null }) {
  const membersHref = useMembersHref(pathname);
  return (
    <Link
      href={membersHref}
      aria-label="People and access"
      className="grid size-9 place-items-center rounded-full border border-line text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <User aria-hidden="true" className="size-4" />
    </Link>
  );
}

function AccountSlot() {
  const pathname = usePathname();
  return <AccountLink pathname={pathname} />;
}

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-background">
      <div className="mx-auto grid h-14 w-full min-w-0 max-w-[1440px] grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-3 px-4 sm:px-8">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 self-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
        >
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-md bg-signal text-[11px] font-bold tracking-tight text-signal-ink"
          >
            HV
          </span>
          <span className="text-sm font-semibold tracking-tight">HAVEN</span>
        </Link>
        <Suspense fallback={<PrimaryNavLinks pathname={null} />}>
          <PrimaryNav />
        </Suspense>
        <div className="flex shrink-0 items-center gap-2">
          <InstallAppControl />
          <Suspense fallback={<AccountLink pathname={null} />}>
            <AccountSlot />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
