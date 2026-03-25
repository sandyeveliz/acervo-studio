import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
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
  const [allTracesHidden, setAllTracesHidden] = useState(false);
  // undefined = no override (each detail manages its own state)
  // true/false = force all details open/closed
  const [detailsExpanded, setDetailsExpanded] = useState<boolean | undefined>(undefined);
  const turns = buildTurns(messages, pipelineSteps, isProcessing);
  const hasAnySteps = turns.some((t) => t.steps.length > 0);

  const toggleDetails = () => {
    setDetailsExpanded((prev) => (prev === true ? false : true));
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStream, pipelineSteps]);

  return (
    <ScrollArea className="flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-col gap-4 p-4">
        {/* Sticky toolbar */}
        {hasAnySteps && (
          <div className="sticky top-0 z-10 flex justify-end gap-3 py-1.5 px-1 bg-background/80 backdrop-blur-sm border-b border-border/20 -mx-1 -mt-1">
            {!allTracesHidden && (
              <button
                onClick={toggleDetails}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 font-mono cursor-pointer transition-colors"
                title={detailsExpanded === true ? "Collapse all details" : "Expand all details"}
              >
                {detailsExpanded === true
                  ? <ChevronsDownUp size={13} />
                  : <ChevronsUpDown size={13} />}
                {detailsExpanded === true ? "collapse details" : "expand details"}
              </button>
            )}
            <button
              onClick={() => setAllTracesHidden((v) => !v)}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 font-mono cursor-pointer transition-colors"
              title={allTracesHidden ? "Show all traces" : "Hide all traces"}
            >
              {allTracesHidden ? <Eye size={13} /> : <EyeOff size={13} />}
              {allTracesHidden ? "show traces" : "hide traces"}
            </button>
          </div>
        )}

        {turns.length === 0 && !isStreaming && (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-muted-foreground text-sm">Start a conversation...</p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.userMessage.id} className="flex flex-col gap-1.5">
            <MessageBubble message={turn.userMessage} />

            {turn.steps.length > 0 && !allTracesHidden && (
              <TracePanel
                steps={turn.steps}
                isActiveTurn={turn.isActiveTurn}
                isStreaming={isStreaming}
                forceOpenDetails={detailsExpanded}
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
