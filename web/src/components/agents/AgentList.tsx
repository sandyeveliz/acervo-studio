import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { AgentSummary } from "@/lib/api";

interface AgentListProps {
  agents: AgentSummary[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
  onDelete: (name: string) => void;
}

export function AgentList({ agents, selectedName, onSelect, onCreate, onDelete }: AgentListProps) {
  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="text-sm font-medium">Agents</h3>
        <Button variant="ghost" size="sm" onClick={onCreate} className="h-7 w-7 p-0">
          <Plus size={14} />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {agents.map((agent) => (
          <div
            key={agent.name}
            onClick={() => onSelect(agent.name)}
            className={cn(
              "flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors group",
              selectedName === agent.name
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{agent.name}</p>
              {agent.description && (
                <p className="text-xs text-muted-foreground truncate">{agent.description}</p>
              )}
            </div>
            {agent.name !== "default" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(agent.name);
                }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive-foreground transition-opacity cursor-pointer ml-2"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
