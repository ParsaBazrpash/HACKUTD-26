import Link from "next/link";
import { Main } from "@/components/shell/main";

export default function NotFound() {
  return (
    <Main>
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted">404</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">That page is not in the war room.</h1>
      <Link
        href="/"
        className="mt-6 inline-flex text-sm text-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Return home
      </Link>
    </Main>
  );
}
