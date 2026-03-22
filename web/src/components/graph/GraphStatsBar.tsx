import { Badge } from "@/components/ui/badge";
import { CheckCircle, CircleDashed, AlertTriangle, Layers } from "lucide-react";
import type { GraphAnalysisStats } from "@/lib/api";

interface GraphStatsBarProps {
  stats: GraphAnalysisStats;
}

export function GraphStatsBar({ stats }: GraphStatsBarProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-card/50 text-xs flex-wrap">
      {/* Totals */}
      <div className="flex items-center gap-1.5">
        <Layers size={13} className="text-muted-foreground" />
        <span className="font-mono">{stats.total_nodes}</span>
        <span className="text-muted-foreground">nodes</span>
        <span className="text-muted-foreground/40 mx-0.5">|</span>
        <span className="font-mono">{stats.total_edges}</span>
        <span className="text-muted-foreground">edges</span>
      </div>

      {/* Verified / unverified */}
      <div className="flex items-center gap-1.5">
        <CheckCircle size={12} className="text-green-500" />
        <span className="font-mono">{stats.verified_count}</span>
        <span className="text-muted-foreground">verified</span>
      </div>

      {stats.placeholder_count > 0 && (
        <div className="flex items-center gap-1.5">
          <CircleDashed size={12} className="text-yellow-500" />
          <span className="font-mono">{stats.placeholder_count}</span>
          <span className="text-muted-foreground">placeholder</span>
        </div>
      )}

      {stats.issue_count > 0 && (
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-orange-500" />
          <span className="font-mono">{stats.issue_count}</span>
          <span className="text-muted-foreground">issues</span>
        </div>
      )}

      {/* Type distribution */}
      <div className="flex items-center gap-1 ml-auto flex-wrap">
        {Object.entries(stats.by_type)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 8)
          .map(([type, count]) => (
            <Badge key={type} variant="outline" className="text-[10px] font-mono">
              {type}: {count}
            </Badge>
          ))}
      </div>
    </div>
  );
}
