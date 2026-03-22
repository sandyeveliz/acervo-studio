import { useState, useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWebSocket } from "@/hooks/useWebSocket";
import { NavSidebar, type Page } from "@/components/NavSidebar";
import { ChatPage } from "@/components/pages/ChatPage";
import { GraphPage } from "@/components/pages/GraphPage";
import { AgentsPage } from "@/components/pages/AgentsPage";
import { MetricsPage } from "@/components/pages/MetricsPage";
import { SettingsPage } from "@/components/pages/SettingsPage";

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("theme") as "light" | "dark") ?? "dark",
  );

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      return next;
    });
  }, []);

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
    requestStats,
  } = useWebSocket();

  return (
    <TooltipProvider delay={300}>
      <div className={`${theme === "dark" ? "dark" : ""} flex h-screen bg-background text-foreground`}>
        <NavSidebar
          currentPage={page}
          onNavigate={setPage}
          connected={connected}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 min-h-0">
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
            {page === "metrics" && <MetricsPage />}
            {page === "agents" && <AgentsPage />}
            {page === "settings" && <SettingsPage onSettingsSaved={requestStats} />}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
