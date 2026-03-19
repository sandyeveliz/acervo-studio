import { ChatArea } from "@/components/ChatArea";
import { Sidebar } from "@/components/Sidebar";
import type { Message, StepGroup, SessionStats } from "@/lib/types";

interface ChatPageProps {
  messages: Message[];
  currentStream: string | null;
  isStreaming: boolean;
  isProcessing: boolean;
  pipelineSteps: StepGroup[];
  stats: SessionStats;
  connected: boolean;
  onSend: (text: string) => void;
  onReset: () => void;
}

export function ChatPage({
  messages,
  currentStream,
  isStreaming,
  isProcessing,
  pipelineSteps,
  stats,
  connected,
  onSend,
  onReset,
}: ChatPageProps) {
  return (
    <div className="flex h-full">
      <ChatArea
        messages={messages}
        currentStream={currentStream}
        isStreaming={isStreaming}
        isProcessing={isProcessing}
        pipelineSteps={pipelineSteps}
        onSend={onSend}
      />
      <Sidebar stats={stats} connected={connected} onReset={onReset} />
    </div>
  );
}
