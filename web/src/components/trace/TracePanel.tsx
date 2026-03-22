import { useState } from "react";
import { Copy, Check, List, LayoutList } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PipelineStep } from "@/lib/types";
import { TraceCard } from "./TraceCard";
import { PipelineStepper } from "./PipelineStepper";
import { copyFullTraceAsMarkdown } from "./copyTrace";

// ── Phase detection ──

const PHASE_MAP: Record<string, string> = {
  message_received: "context",
  context_built: "context",
  topic_detect_step: "context",
  topic_changed: "context",
  acervo_request_sent: "llm",
  planner_decision: "llm",
  executor_result: "llm",
  stream_started: "llm",
  stream_completed: "llm",
  acervo_enrich_result: "llm",
  tool_call_requested: "tools",
  tool_call_completed: "tools",
  extraction_started: "post",
  extraction_completed: "post",
  graph_updated: "post",
};

const PHASE_LABELS: Record<string, string> = {
  context: "context",
  llm: "llm",
  tools: "tool execution",
  post: "post-processing",
};

function getPhase(type: string): string {
  return PHASE_MAP[type] ?? "pipeline";
}

function PhaseDivider({ phase, label }: { phase: string; label?: string }) {
  const text = label ?? PHASE_LABELS[phase] ?? phase;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 border-t border-border/30" />
      <span className="text-[12px] text-muted-foreground/50 uppercase tracking-wider font-mono">
        {text}
      </span>
      <span className="flex-1 border-t border-border/30" />
    </div>
  );
}

// ── TracePanel ──

interface TracePanelProps {
  steps: PipelineStep[];
  isActiveTurn: boolean;
  isStreaming: boolean;
}

export function TracePanel({ steps, isActiveTurn, isStreaming }: TracePanelProps) {
  const [compact, setCompact] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasAcervo = steps.some(s => s.type === "acervo_request_sent");
  const enrichStep = steps.find(s => s.type === "acervo_enrich_result");

  const handleCopyAll = async () => {
    await copyFullTraceAsMarkdown(steps);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <TooltipProvider>
      <div className="ml-2 pl-2 border-l border-border/50 my-1">
        {/* Toolbar */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[12px] text-muted-foreground/50 font-mono uppercase tracking-wider">
            trace · {steps.length} steps
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setCompact(!compact)}
            className="text-muted-foreground/30 hover:text-muted-foreground/60 cursor-pointer"
            title={compact ? "Expand trace" : "Compact trace"}
          >
            {compact ? <LayoutList size={12} /> : <List size={12} />}
          </button>
          <button
            onClick={handleCopyAll}
            className="text-muted-foreground/30 hover:text-muted-foreground/60 cursor-pointer"
            title="Copy full trace"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>

        {/* Compact mode: just the stepper if available */}
        {compact && (
          <div>
            {enrichStep ? (
              <PipelineStepper raw={enrichStep.raw} />
            ) : (
              <span className="text-[13px] text-muted-foreground/50 font-mono">
                {steps.length} steps · {hasAcervo ? "acervo" : "direct"} pipeline
              </span>
            )}
          </div>
        )}

        {/* Full mode: all trace cards with phase dividers */}
        {!compact && (
          <div className="flex flex-col gap-0">
            {steps.map((step, j) => {
              const phase = getPhase(step.type);
              const prevPhase = j > 0 ? getPhase(steps[j - 1].type) : null;
              const showDivider = prevPhase !== null && phase !== prevPhase;
              const dividerLabel = phase === "llm" && hasAcervo ? "acervo → llm" : undefined;
              return (
                <div key={`${step.type}-${j}`}>
                  {showDivider && <PhaseDivider phase={phase} label={dividerLabel} />}
                  <TraceCard step={step} />
                </div>
              );
            })}
          </div>
        )}

        {/* Processing indicator */}
        {isActiveTurn && !isStreaming && (
          <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground/60 font-mono mt-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Processing...
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
