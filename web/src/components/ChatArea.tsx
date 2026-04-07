import { ChatTimeline } from "./ChatTimeline";
import { ChatInput } from "./ChatInput";
import type { Message, StepGroup } from "@/lib/types";

interface ChatAreaProps {
  messages: Message[];
  currentStream: string | null;
  isStreaming: boolean;
  isProcessing: boolean;
  pipelineSteps: StepGroup[];
  onSend: (text: string) => void;
  onRetry?: () => void;
}

export function ChatArea({
  messages,
  currentStream,
  isStreaming,
  isProcessing,
  pipelineSteps,
  onSend,
  onRetry,
}: ChatAreaProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ChatTimeline
        messages={messages}
        pipelineSteps={pipelineSteps}
        currentStream={currentStream}
        isStreaming={isStreaming}
        isProcessing={isProcessing}
        onRetry={onRetry}
      />
      <ChatInput onSend={onSend} disabled={isProcessing} />
    </div>
  );
}
