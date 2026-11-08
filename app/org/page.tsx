import type { Metadata } from "next";
import { Main } from "@/components/shell/main";
import { OrgView } from "@/components/org/org-view";

export const metadata: Metadata = {
  title: "Org",
};

export default function OrgPage() {
  return (
    <Main>
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted">ORG ROSTER</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">Who we can page.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Enroll people in peacetime. In an incident, pick them by name and HAVEN calls their personal phones.
      </p>
      <div className="mt-8 max-w-xl">
        <OrgView />
      </div>
    </Main>
  );
}
