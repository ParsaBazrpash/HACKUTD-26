import type { Metadata } from "next";
import { ChannelsScreen } from "@/components/incidents/channels-screen";

export const metadata: Metadata = {
  title: "Secure Channels",
};

export default function ChannelsPage() {
  return <ChannelsScreen />;
}
