import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWebSocket } from "@/hooks/useWebSocket";
import { NavSidebar, type Page } from "@/components/NavSidebar";
import { ChatPage } from "@/components/pages/ChatPage";
import { GraphPage } from "@/components/pages/GraphPage";
import { AgentsPage } from "@/components/pages/AgentsPage";
import { SettingsPage } from "@/components/pages/SettingsPage";

export default function App() {
  const [page, setPage] = useState<Page>("chat");

  const {
    messages,
    currentStream,
    isStreaming,
    isProcessing,
    pipelineSteps,
    stats,
    connected,
    sendMessage,
    resetSession,
  } = useWebSocket();

  return (
    <TooltipProvider delay={300}>
      <div className="dark flex h-screen bg-background text-foreground">
        <NavSidebar currentPage={page} onNavigate={setPage} connected={connected} />
        <main className="flex-1 min-w-0">
          {page === "chat" && (
            <ChatPage
              messages={messages}
              currentStream={currentStream}
              isStreaming={isStreaming}
              isProcessing={isProcessing}
              pipelineSteps={pipelineSteps}
              stats={stats}
              connected={connected}
              onSend={sendMessage}
              onReset={resetSession}
            />
          )}
          {page === "graph" && <GraphPage />}
          {page === "agents" && <AgentsPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </TooltipProvider>
  );
}
