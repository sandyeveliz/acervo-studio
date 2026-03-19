import { Badge } from "@/components/ui/badge";
import { getEventSource } from "@/lib/eventNames";
import type { PipelineStep } from "@/lib/types";

const SOURCE_COLORS: Record<string, string> = {
  acervo: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  pipeline: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  graph: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  llm: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
};

interface StepBadgeProps {
  step: PipelineStep;
}

export function StepBadge({ step }: StepBadgeProps) {
  const source = getEventSource(step.type);
  const color = SOURCE_COLORS[source] ?? SOURCE_COLORS.pipeline;

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge variant="outline" className={`${color} text-[10px] font-mono px-1.5 py-0`}>
        {source}
      </Badge>
      <span className="text-muted-foreground font-medium">{step.label}</span>
      {step.detail && (
        <span className="text-muted-foreground/70 truncate">{step.detail}</span>
      )}
    </div>
  );
}
