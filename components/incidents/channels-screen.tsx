"use client";

import { useEffect, useRef } from "react";
import { MessagesSquare } from "lucide-react";
import { ChannelsBoard } from "@/components/incidents/channels-board";

export function ChannelsScreen() {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = requestAnimationFrame(() => {
      node.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div ref={frame} className="grid min-w-0 scroll-mt-16 gap-4">
      <div className="flex items-start gap-3">
        <MessagesSquare aria-hidden="true" className="mt-1 size-7 shrink-0 text-signal" />
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">Secure Channels</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Role-based, encrypted communication for coordinated incident response.
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            #record is the structured event log. It is not a chat channel.
          </p>
        </div>
      </div>
      <ChannelsBoard />
    </div>
  );
}
