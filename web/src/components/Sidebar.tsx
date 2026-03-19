import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { SessionStats } from "@/lib/types";

interface SidebarProps {
  stats: SessionStats;
  connected: boolean;
  onReset: () => void;
}

export function Sidebar({ stats, connected, onReset }: SidebarProps) {
  return (
    <div className="w-72 border-l border-border flex flex-col gap-3 p-3 overflow-y-auto">
      {/* Connection status */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
        <span className="text-xs text-muted-foreground">
          {connected ? "Connected" : "Disconnected"}
        </span>
        <button
          onClick={onReset}
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground font-mono cursor-pointer"
        >
          reset
        </button>
      </div>

      <Separator />

      {/* Model info */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-medium text-muted-foreground">Model</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-1.5">
          <div className="text-sm font-mono truncate" title={stats.model}>
            {stats.model || "—"}
          </div>
          {stats.utility_model && (
            <div className="text-xs text-muted-foreground font-mono truncate" title={stats.utility_model}>
              util: {stats.utility_model}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Session stats */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-medium text-muted-foreground">Session</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="grid grid-cols-2 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">Turns</span>
            <span className="text-right font-mono">{stats.turns}</span>
            <span className="text-muted-foreground">History</span>
            <span className="text-right font-mono">{stats.history_len} msgs</span>
          </div>
        </CardContent>
      </Card>

      {/* Last turn metrics */}
      {stats.last_speed_tps != null && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">Last Turn</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-y-1.5 text-xs">
              <span className="text-muted-foreground">Speed</span>
              <span className="text-right font-mono">{stats.last_speed_tps?.toFixed(1)} t/s</span>
              <span className="text-muted-foreground">TTFT</span>
              <span className="text-right font-mono">{stats.last_ttft_ms?.toFixed(0)} ms</span>
              <span className="text-muted-foreground">Latency</span>
              <span className="text-right font-mono">{(stats.last_latency_ms! / 1000).toFixed(1)}s</span>
              <span className="text-muted-foreground">Tokens</span>
              <span className="text-right font-mono">{stats.last_completion_tokens}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Graph stats */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-medium text-muted-foreground">Knowledge Graph</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="grid grid-cols-2 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">Nodes</span>
            <span className="text-right font-mono">{stats.node_count}</span>
            <span className="text-muted-foreground">Edges</span>
            <span className="text-right font-mono">{stats.edge_count}</span>
          </div>
          {stats.mcp_active && (
            <Badge variant="outline" className="mt-2 text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              MCP active
            </Badge>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
