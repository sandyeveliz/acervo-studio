import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Layers, Unlink, Bot, User, Cog, ShieldCheck, AlertTriangle } from "lucide-react";
import type { GraphStats, GraphNode, GraphEdge } from "@/lib/api";

interface GraphStatsBarProps {
  stats: GraphStats;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
}

export function GraphStatsBar({ stats, nodes = [], edges = [] }: GraphStatsBarProps) {
  // v0.6.1 client-side counters (backend may not expose these as a separate endpoint yet)
  const counters = useMemo(() => {
    let confirmed = 0;
    let pending = 0;
    let llm = 0;
    let user = 0;
    let system = 0;

    for (const n of nodes) {
      if (n.status === "pending_review") pending++;
      else confirmed++;
      const s = n.source ?? "llm";
      if (s === "user") user++;
      else if (s === "system") system++;
      else llm++;
    }
    for (const e of edges) {
      if (e.status === "pending_review") pending++;
      else confirmed++;
      const s = e.source_type ?? "llm";
      if (s === "user") user++;
      else if (s === "system") system++;
      else llm++;
    }

    return { confirmed, pending, llm, user, system };
  }, [nodes, edges]);

  const showCounters =
    counters.pending > 0 || counters.user > 0 || counters.system > 0;

  return (
    <div className="border-b border-border bg-card/50 text-xs">
      <div className="flex items-center gap-3 px-3 py-2 flex-wrap">
        {/* Totals */}
        <div className="flex items-center gap-1.5">
          <Layers size={13} className="text-muted-foreground" />
          <span className="font-mono">{stats.total_nodes}</span>
          <span className="text-muted-foreground">nodes</span>
          <span className="text-muted-foreground/40 mx-0.5">|</span>
          <span className="font-mono">{stats.total_edges}</span>
          <span className="text-muted-foreground">edges</span>
        </div>

        {stats.orphan_count > 0 && (
          <div className="flex items-center gap-1.5">
            <Unlink size={12} className="text-orange-500" />
            <span className="font-mono">{stats.orphan_count}</span>
            <span className="text-muted-foreground">orphans</span>
          </div>
        )}

        {/* Type distribution */}
        <div className="flex items-center gap-1 ml-auto flex-wrap">
          {Object.entries(stats.types_distribution ?? {})
            .sort(([, a], [, b]) => b - a)
            .slice(0, 8)
            .map(([type, count]) => (
              <Badge key={type} variant="outline" className="text-[10px] font-mono">
                {type}: {count}
              </Badge>
            ))}
        </div>
      </div>

      {/* v0.6.1 status + source counters */}
      {showCounters && (
        <div className="flex items-center gap-3 px-3 pb-2 flex-wrap text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <ShieldCheck size={11} className="text-emerald-500" />
            <span className="font-mono text-foreground">{counters.confirmed}</span>
            confirmed
          </span>
          {counters.pending > 0 && (
            <span className="flex items-center gap-1">
              <AlertTriangle size={11} className="text-amber-500" />
              <span className="font-mono text-amber-500">{counters.pending}</span>
              pending
            </span>
          )}
          <span className="text-muted-foreground/40">|</span>
          <span className="flex items-center gap-1">
            <Bot size={11} />
            <span className="font-mono text-foreground">{counters.llm}</span>
            llm
          </span>
          <span className="flex items-center gap-1">
            <User size={11} />
            <span className="font-mono text-foreground">{counters.user}</span>
            user
          </span>
          {counters.system > 0 && (
            <span className="flex items-center gap-1">
              <Cog size={11} />
              <span className="font-mono text-foreground">{counters.system}</span>
              system
            </span>
          )}
        </div>
      )}
    </div>
  );
}
