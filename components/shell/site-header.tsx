"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";

function incidentIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/incidents\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

function membersHref(pathname: string | null): string {
  const incidentId = incidentIdFromPath(pathname);
  return incidentId ? `/incidents/${incidentId}/people` : "/incidents";
}

function itemClass(active: boolean): string {
  return active
    ? "inline-flex h-full items-center border-b-2 border-signal px-2 text-sm font-medium text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:px-3"
    : "inline-flex h-full items-center border-b-2 border-transparent px-2 text-sm text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:px-3";
}

function PrimaryNavLinks({ pathname }: { pathname: string | null }) {
  const onPeople = pathname !== null && /\/people(?:\/|$)/.test(pathname);
  const onIncidents = pathname !== null && pathname.startsWith("/incidents") && !onPeople;
  const onJoin = pathname === "/join" || (pathname !== null && pathname.startsWith("/join/"));
  const onOrg = pathname === "/org" || (pathname !== null && pathname.startsWith("/org/"));
  return (
    <nav aria-label="Primary" className="-mb-px flex h-full min-w-0 items-stretch justify-center gap-1 overflow-x-auto sm:gap-2">
      <Link href="/incidents" aria-current={onIncidents ? "page" : undefined} className={itemClass(onIncidents)}>
        Incidents
      </Link>
      <Link
        href={membersHref(pathname)}
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
  return (
    <Link
      href={membersHref(pathname)}
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
        <div className="flex items-center">
          <Suspense fallback={<AccountLink pathname={null} />}>
            <AccountSlot />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
