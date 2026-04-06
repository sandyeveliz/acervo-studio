import { cn } from "@/lib/utils";
import type { TelemetrySpan, Annotation } from "@/lib/api";
import { Download } from "lucide-react";

interface TurnListProps {
  spans: TelemetrySpan[];
  annotations: Record<number, Annotation>;
  selectedTurn: number | null;
  onSelect: (turnId: number) => void;
  range: number;
  onRangeChange: (range: number) => void;
  rangeOptions: readonly { label: string; value: number }[];
  onExport: (format: "jsonl" | "json") => void;
}

function statusDot(span: TelemetrySpan, annotation?: Annotation) {
  if (annotation?.status === "annotated") return "bg-emerald-500";
  if (annotation?.status === "editing") return "bg-amber-500";
  if (span.failures.length > 0) return "bg-red-500";
  return "bg-muted-foreground/30";
}

export function TurnList({
  spans, annotations, selectedTurn, onSelect,
  range, onRangeChange, rangeOptions, onExport,
}: TurnListProps) {
  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Turns ({spans.length})
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onExport("json")}
              title="Export all turns (JSON)"
              className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Download size={12} />
            </button>
          </div>
        </div>
        <select
          value={range}
          onChange={(e) => onRangeChange(Number(e.target.value))}
          className="w-full text-xs bg-muted border border-border rounded px-1.5 py-1 text-foreground"
        >
          {rangeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Turn items */}
      <div className="flex-1 overflow-y-auto py-1">
        {spans.map((span) => {
          const ann = annotations[span.turn_id];
          const totalMs = span.s1.latency_ms + span.llm.latency_ms + span.s15.latency_ms;
          return (
            <button
              key={span.turn_id}
              onClick={() => onSelect(span.turn_id)}
              className={cn(
                "flex items-start gap-2 w-full px-3 py-2 text-left transition-colors cursor-pointer",
                selectedTurn === span.turn_id
                  ? "bg-accent"
                  : "hover:bg-muted/50",
              )}
            >
              <span className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", statusDot(span, ann))} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium">#{span.turn_id}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{totalMs > 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`}</span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {span.user_msg.slice(0, 40)}
                </p>
                {span.s15.entities_created > 0 && (
                  <span className="text-[10px] text-emerald-500">+{span.s15.entities_created}E</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
