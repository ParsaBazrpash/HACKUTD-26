import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinForm } from "@/components/incidents/join-form";
import { Main } from "@/components/shell/main";

export const metadata: Metadata = {
  title: "Join",
};

export default function JoinPage() {
  return (
    <Main>
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted">MEMBERSHIP</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">Join a sealed room.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        Choose a shell and a role. Your label stays in this tab. Identity keys are not created yet.
      </p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-sm text-muted">Loading the join form…</p>}>
          <JoinForm />
        </Suspense>
      </div>
    </Main>
  );
}
