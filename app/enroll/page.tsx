import type { Metadata } from "next";
import { EnrollForm } from "@/components/org/enroll-form";
import { Main } from "@/components/shell/main";

export const metadata: Metadata = {
  title: "Enroll",
};

export default function EnrollPage() {
  return (
    <Main>
      <div className="no-print">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted">ENROLLMENT</p>
        <h1 className="mt-3 text-4xl font-medium tracking-tight">Enroll on your personal phone.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Your admin approves you after you read them the safety code. This page cannot approve you.
        </p>
      </div>
      <div className="mt-8">
        <EnrollForm />
      </div>
    </Main>
  );
}
