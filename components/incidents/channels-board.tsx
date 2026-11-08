"use client";

import { CHANNEL_LABELS } from "@/components/incidents/labels";
import { MessageComposer } from "@/components/incidents/message-composer";
import { authorizedChatChannels, canCompose } from "@/components/incidents/room-controls";
import { SafeText } from "@/components/incidents/safe-text";
import { selectMessages } from "@/components/incidents/situation";
import { VerdictNote } from "@/components/incidents/verdict-note";
import { useIncident } from "@/hooks/use-incident";
import { formatTimestamp } from "@/lib/time";

export function ChannelsBoard({ limit }: { limit?: number }) {
  const state = useIncident();
  const channels = authorizedChatChannels(state.me?.role, state.me?.state, state.channels);

  if (channels.length === 0) {
    return <p className="text-sm text-muted">No chat channel is open for this role.</p>;
  }

  return (
    <div className="grid gap-8">
      {channels.map((channel) => {
        const messages = selectMessages(channel.messages, limit);
        const hidden = limit !== undefined && channel.messages.length > messages.length;
        const canPost = canCompose(state.me?.role, state.me?.state, channel.kind);
        return (
          <section
            key={channel.kind}
            className={channel.kind === "privileged" ? "min-w-0 border-l border-signal pl-4" : "min-w-0"}
            aria-labelledby={`channel-${channel.kind}`}
          >
            <h3 id={`channel-${channel.kind}`} className="text-sm font-medium text-foreground">
              {CHANNEL_LABELS[channel.kind]}
            </h3>
            {channel.kind === "privileged" ? (
              <p className="mt-1 text-sm text-foreground">
                Privileged communication. Attorney-client privileged and confidential.
              </p>
            ) : null}
            {channel.kind === "command" ? (
              <p className="mt-1 text-sm text-muted">Coordination for everyone in the room.</p>
            ) : null}
            {channel.kind === "technical" ? (
              <p className="mt-1 text-sm text-muted">Forensics and containment.</p>
            ) : null}
            {channel.waitingForKeys ? <p className="mt-2 text-sm text-muted">Waiting for channel keys.</p> : null}
            {hidden ? (
              <p className="mt-3 text-xs text-muted">Showing the latest messages. The full channel is on Secure Channels.</p>
            ) : null}
            {messages.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No messages yet.</p>
            ) : (
              <ul className="mt-3 space-y-4">
                {messages.map((message) => (
                  <li key={`${message.seq.toString()}-${message.messageId}`} className="min-w-0">
                    <p className="break-words text-sm leading-6 text-foreground">
                      <SafeText text={message.text} />
                    </p>
                    <p className="mt-1 break-words text-xs text-muted">
                      {message.author?.displayName ?? "Unknown author"}
                      {" · "}
                      {formatTimestamp(message.sentAt)}
                      {message.verdict.ok ? "" : ` · seq ${message.seq.toString()}`}
                    </p>
                    <VerdictNote verdict={message.verdict} />
                  </li>
                ))}
              </ul>
            )}
            {canPost ? (
              <MessageComposer channel={channel.kind} />
            ) : (
              <p className="mt-3 text-sm text-muted">You can read this channel. Your role cannot post here.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
