import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface SourceConfig {
  label: string;
  tooltip: string;
  badgeClass: string;
  borderClass: string;
}

const SOURCE_CONFIG: Record<string, SourceConfig> = {
  avs: {
    label: "AVS",
    tooltip: "Orchestrator — builds context, routes messages",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    borderClass: "border-l-emerald-500/50",
  },
  acr: {
    label: "ACR",
    tooltip: "Context engine — topic detection, retrieval, enrichment",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    borderClass: "border-l-amber-500/50",
  },
  llm: {
    label: "LLM",
    tooltip: "Language model response",
    badgeClass: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    borderClass: "border-l-purple-500/50",
  },
  mcp: {
    label: "MCP",
    tooltip: "External tools — web search, etc.",
    badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    borderClass: "border-l-blue-500/50",
  },
  error: {
    label: "ERR",
    tooltip: "Pipeline error",
    badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
    borderClass: "border-l-red-500/50",
  },
};

const DEFAULT_CONFIG: SourceConfig = {
  label: "SYS",
  tooltip: "Pipeline event",
  badgeClass: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  borderClass: "border-l-zinc-500/50",
};

export function getSourceConfig(source: string): SourceConfig {
  return SOURCE_CONFIG[source] ?? DEFAULT_CONFIG;
}

export function SourceBadge({ source }: { source: string }) {
  const config = getSourceConfig(source);
  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="outline" className={`text-[12px] h-5 px-2 font-mono font-medium ${config.badgeClass}`}>
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">{config.tooltip}</TooltipContent>
    </Tooltip>
  );
}
