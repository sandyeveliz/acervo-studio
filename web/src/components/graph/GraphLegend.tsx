import { Bot, User, Cog, AlertTriangle } from "lucide-react";

interface GraphLegendProps {
  visible: boolean;
}

/**
 * Floating legend explaining the v0.6.1 visual conventions used by GraphViewer:
 * confidence → opacity, source → border color, status → amber ring.
 */
export function GraphLegend({ visible }: GraphLegendProps) {
  if (!visible) return null;

  return (
    <div className="absolute bottom-3 right-3 z-10 rounded-lg border border-border bg-popover/95 backdrop-blur-sm p-3 shadow-lg text-xs space-y-2 max-w-[220px]">
      <div className="font-medium text-foreground">Legend</div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Confidence
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-2 flex-1 overflow-hidden rounded">
            <div className="flex-1" style={{ background: "rgba(96, 165, 250, 0.4)" }} />
            <div className="flex-1" style={{ background: "rgba(96, 165, 250, 0.7)" }} />
            <div className="flex-1" style={{ background: "rgba(96, 165, 250, 1)" }} />
          </div>
          <span className="text-[10px] text-muted-foreground">low → high</span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Source
        </div>
        <div className="flex items-center gap-1.5">
          <Bot size={11} />
          <span className="text-[11px]">LLM (no border)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <User size={11} />
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ background: "#60a5fa", border: "2px solid #d4af37" }}
          />
          <span className="text-[11px]">User (gold)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cog size={11} />
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ background: "#60a5fa", border: "1px solid #94a3b8" }}
          />
          <span className="text-[11px]">System (gray)</span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Status
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={11} className="text-amber-500" />
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ background: "#60a5fa", boxShadow: "0 0 0 2px #f59e0b" }}
          />
          <span className="text-[11px]">Pending review</span>
        </div>
      </div>
    </div>
  );
}
