import { MessageSquare, Network, Bot, Settings } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Page = "chat" | "graph" | "agents" | "settings";

const NAV_ITEMS: { page: Page; icon: typeof MessageSquare; label: string }[] = [
  { page: "chat", icon: MessageSquare, label: "Chat" },
  { page: "graph", icon: Network, label: "Graph" },
  { page: "agents", icon: Bot, label: "Agents" },
  { page: "settings", icon: Settings, label: "Settings" },
];

interface NavSidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  connected: boolean;
}

export function NavSidebar({ currentPage, onNavigate, connected }: NavSidebarProps) {
  return (
    <div className="flex flex-col items-center w-14 border-r border-border bg-sidebar py-3 gap-1">
      {NAV_ITEMS.map(({ page, icon: Icon, label }) => (
        <Tooltip key={page}>
          <TooltipTrigger
            onClick={() => onNavigate(page)}
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-lg transition-colors cursor-pointer",
              currentPage === page
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
            )}
            render={<button />}
          >
            <Icon size={20} />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {label}
          </TooltipContent>
        </Tooltip>
      ))}

      <div className="mt-auto flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5" title={connected ? "Connected" : "Disconnected"}>
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              connected ? "bg-emerald-500" : "bg-red-500",
            )}
          />
        </div>
      </div>
    </div>
  );
}
