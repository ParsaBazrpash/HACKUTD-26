import type { Metadata } from "next";
import { HomeView } from "@/components/landing/home-view";

export const metadata: Metadata = {
  title: "ZeroHour",
  description:
    "A sealed incident-response war room for the first 72 hours after a ransomware attack.",
};

export default function Page() {
  return <HomeView />;
}
