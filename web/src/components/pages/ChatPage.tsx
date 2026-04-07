import { useState } from "react";
import { Download, Check } from "lucide-react";
import { ChatArea } from "@/components/ChatArea";
import { Sidebar } from "@/components/Sidebar";
import { exportAsJson, exportAsMarkdown, copyAsMarkdown } from "@/lib/exportSession";
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
  onRetry?: () => void;
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
  onRetry,
}: ChatPageProps) {
  const [copied, setCopied] = useState(false);
  const hasMessages = messages.length > 0;

  const handleCopy = async () => {
    const md = copyAsMarkdown(messages, pipelineSteps);
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 flex flex-col">
        {hasMessages && (
          <div className="flex items-center gap-1 px-4 py-1 border-b border-border/50 shrink-0">
            <span className="text-[11px] text-muted-foreground/50 mr-auto">
              {messages.length} messages
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer rounded"
              title="Copy as Markdown"
            >
              {copied ? <Check size={10} className="text-emerald-400" /> : <Download size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => exportAsMarkdown(messages, pipelineSteps)}
              className="px-2 py-0.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer rounded"
              title="Export as Markdown file"
            >
              .md
            </button>
            <button
              onClick={() => exportAsJson(messages, pipelineSteps)}
              className="px-2 py-0.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer rounded"
              title="Export as JSON file"
            >
              .json
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">
          <ChatArea
            messages={messages}
            currentStream={currentStream}
            isStreaming={isStreaming}
            isProcessing={isProcessing}
            pipelineSteps={pipelineSteps}
            onSend={onSend}
            onRetry={onRetry}
          />
        </div>
      </div>
      <Sidebar stats={stats} connected={connected} onReset={onReset} />
    </div>
  );
}
