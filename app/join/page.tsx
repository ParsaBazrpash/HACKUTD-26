import type { Metadata } from "next";
import { JoinForm } from "@/components/incidents/join-form";
import { Main } from "@/components/shell/main";

export const metadata: Metadata = {
  title: "Join",
};

export default function JoinPage() {
  return (
    <Main>
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted">MEMBERSHIP</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">Join with an invite link.</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
        The role comes from the commander&apos;s invite. This page cannot assign one.
      </p>
      <div className="mt-8">
        <JoinForm />
      </div>
    </Main>
  );
}
