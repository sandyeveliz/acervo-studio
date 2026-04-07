import { cn } from "@/lib/utils";
import { AlertCircle, RotateCcw } from "lucide-react";
import type { Message } from "@/lib/types";

interface MessageBubbleProps {
  message: Message;
  onRetry?: () => void;
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (message.role === "error") {
    return (
      <div className="flex w-full justify-start">
        <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-destructive/10 border border-destructive/30 text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-xs mb-1">Pipeline Error</p>
              <p className="whitespace-pre-wrap break-words text-xs opacity-80">
                {message.content}
              </p>
            </div>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive hover:text-destructive/80 transition-colors cursor-pointer"
            >
              <RotateCcw size={12} />
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

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
