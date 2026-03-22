import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble, StreamBubble } from "./MessageBubble";
import { TracePanel } from "./trace";
import type { Message, PipelineStep, StepGroup } from "@/lib/types";

// ── Types ──

interface ChatTurn {
  userMessage: Message;
  steps: PipelineStep[];
  assistantMessage: Message | null;
  isActiveTurn: boolean;
}

interface ChatTimelineProps {
  messages: Message[];
  pipelineSteps: StepGroup[];
  currentStream: string | null;
  isStreaming: boolean;
  isProcessing: boolean;
}

// ── Helpers ──

function buildTurns(
  messages: Message[],
  pipelineSteps: StepGroup[],
  isProcessing: boolean,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let turnIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      const stepGroup = pipelineSteps[turnIndex];
      const nextMsg = messages[i + 1];
      const assistantMessage = nextMsg?.role === "assistant" ? nextMsg : null;
      const isLast = turnIndex === pipelineSteps.length - 1;

      turns.push({
        userMessage: msg,
        steps: stepGroup?.steps ?? [],
        assistantMessage,
        isActiveTurn: isLast && isProcessing,
      });
      turnIndex++;
      if (assistantMessage) i++;
    }
  }
  return turns;
}

// ── Timeline ──

export function ChatTimeline({
  messages,
  pipelineSteps,
  currentStream,
  isStreaming,
  isProcessing,
}: ChatTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const turns = buildTurns(messages, pipelineSteps, isProcessing);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStream, pipelineSteps]);

  return (
    <ScrollArea className="flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-col gap-4 p-4">
        {turns.length === 0 && !isStreaming && (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-muted-foreground text-sm">Start a conversation...</p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.userMessage.id} className="flex flex-col gap-1.5">
            <MessageBubble message={turn.userMessage} />

            {turn.steps.length > 0 && (
              <TracePanel
                steps={turn.steps}
                isActiveTurn={turn.isActiveTurn}
                isStreaming={isStreaming}
              />
            )}

            {turn.isActiveTurn && isStreaming && currentStream !== null && (
              <StreamBubble text={currentStream} />
            )}

            {turn.assistantMessage && (
              <MessageBubble message={turn.assistantMessage} />
            )}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
