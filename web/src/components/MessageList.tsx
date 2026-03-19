import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, StreamBubble } from "./MessageBubble";
import type { Message } from "@/lib/types";

interface MessageListProps {
  messages: Message[];
  currentStream: string | null;
  isStreaming: boolean;
}

export function MessageList({ messages, currentStream, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStream]);

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-3 p-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-muted-foreground text-sm">Start a conversation...</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && currentStream !== null && (
          <StreamBubble text={currentStream} />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
