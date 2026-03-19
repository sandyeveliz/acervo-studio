import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { PipelineSteps } from "./PipelineSteps";
import type { Message, StepGroup } from "@/lib/types";

interface ChatAreaProps {
  messages: Message[];
  currentStream: string | null;
  isStreaming: boolean;
  isProcessing: boolean;
  pipelineSteps: StepGroup[];
  onSend: (text: string) => void;
}

export function ChatArea({
  messages,
  currentStream,
  isStreaming,
  isProcessing,
  pipelineSteps,
  onSend,
}: ChatAreaProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList
        messages={messages}
        currentStream={currentStream}
        isStreaming={isStreaming}
      />
      <PipelineSteps groups={pipelineSteps} currentTurnActive={isProcessing} />
      <ChatInput onSend={onSend} disabled={isProcessing} />
    </div>
  );
}
