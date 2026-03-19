import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card text-card-foreground border border-border",
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}

interface StreamBubbleProps {
  text: string;
}

export function StreamBubble({ text }: StreamBubbleProps) {
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-card text-card-foreground border border-border">
        <div className="whitespace-pre-wrap break-words">
          {text}
          <span className="inline-block w-2 h-4 ml-0.5 bg-primary animate-pulse" />
        </div>
      </div>
    </div>
  );
}
