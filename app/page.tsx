import type { Metadata } from "next";
import { HomeView } from "@/components/landing/home-view";

export const metadata: Metadata = {
  title: { absolute: "HAVEN" },
  description:
    "Coordinate, communicate, and make critical decisions in a secure, tamper-evident workspace.",
};

export default function Page() {
  return <HomeView />;
}
