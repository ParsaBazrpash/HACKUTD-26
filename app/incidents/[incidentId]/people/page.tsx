import type { Metadata } from "next";
import { PeopleBoard } from "@/components/incidents/people-board";

export const metadata: Metadata = {
  title: "People and Access",
};

export default function PeoplePage() {
  return <PeopleBoard />;
}
