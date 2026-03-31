import { MessageSquare, Network, Bot, Settings, BarChart3, FolderOpen, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectSelector } from "./ProjectSelector";

export type Page = "chat" | "graph" | "metrics" | "agents" | "projects" | "settings";

const NAV_ITEMS: { page: Page; icon: typeof MessageSquare; label: string }[] = [
  { page: "chat", icon: MessageSquare, label: "Chat" },
  { page: "graph", icon: Network, label: "Graph" },
  { page: "metrics", icon: BarChart3, label: "Metrics" },
  { page: "agents", icon: Bot, label: "Agents" },
  { page: "projects", icon: FolderOpen, label: "Projects" },
  { page: "settings", icon: Settings, label: "Settings" },
];

interface NavSidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  connected: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function NavSidebar({ currentPage, onNavigate, connected, theme, onToggleTheme }: NavSidebarProps) {
  return (
    <div className="flex flex-col w-44 border-r border-border bg-sidebar py-3 px-2 gap-0.5">
      <div className="text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider px-2 mb-2">
        Acervo Studio
      </div>

      <ProjectSelector />

      {NAV_ITEMS.map(({ page, icon: Icon, label }) => (
        <button
          key={page}
          onClick={() => onNavigate(page)}
          className={cn(
            "flex items-center gap-2.5 w-full px-2 py-2 rounded-lg text-sm transition-colors cursor-pointer",
            currentPage === page
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
          )}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}

      <div className="mt-auto flex flex-col gap-2 pt-3">
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-2.5 w-full px-2 py-2 rounded-lg text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors cursor-pointer"
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        <div className="flex items-center gap-2 px-2 py-1">
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              connected ? "bg-emerald-500" : "bg-red-500",
            )}
          />
          <span className="text-xs text-sidebar-foreground/40">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
    </div>
  );
}
