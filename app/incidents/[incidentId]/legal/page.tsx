import type { Metadata } from "next";
import { LegalBoard } from "@/components/incidents/legal-board";

export const metadata: Metadata = {
  title: "Legal Deadlines",
};

export default function LegalPage() {
  return <LegalBoard />;
}
