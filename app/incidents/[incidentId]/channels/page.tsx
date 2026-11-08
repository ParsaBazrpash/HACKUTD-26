import type { Metadata } from "next";
import { ChannelsBoard } from "@/components/incidents/channels-board";

export const metadata: Metadata = {
  title: "Secure Channels",
};

export default function ChannelsPage() {
  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <h2 className="text-xl font-medium tracking-tight">Secure channels</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Only channels present for your role are listed. #record is the structured event log. It is not a chat
          channel.
        </p>
      </div>
      <ChannelsBoard />
    </div>
  );
}
