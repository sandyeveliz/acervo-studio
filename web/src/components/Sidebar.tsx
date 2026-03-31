import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, FileJson, Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { McpConfigDialog } from "./McpConfigDialog";
import { mcpApi, acervoApi, type AcervoProxyStatus, type AcervoGraphInfo, type ContextLayersResponse } from "@/lib/api";
import { ContextLayersPanel } from "./ContextLayersPanel";
import { useConfirm } from "@/hooks/useConfirm";
import { useProject } from "@/hooks/useProject";
import type { SessionStats, McpServer } from "@/lib/types";

interface SidebarProps {
  stats: SessionStats;
  connected: boolean;
  onReset: () => void;
}

function McpStatusDot({ status }: { status: string }) {
  const color =
    status === "ready" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-zinc-500";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] font-semibold text-muted-foreground/80 uppercase tracking-wider mt-1">
      {children}
    </div>
  );
}

function AcervoStatusDot({ status }: { status: string }) {
  const color =
    status === "active" ? "bg-emerald-500" :
    status === "pass-through" ? "bg-amber-500" :
    status === "disconnected" ? "bg-red-500" :
    "bg-zinc-500";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;
}

export function Sidebar({ stats, connected, onReset }: SidebarProps) {
  const { confirm, ConfirmDialog } = useConfirm();
  const { activeId } = useProject();
  const [mcpConfigOpen, setMcpConfigOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[] | null>(null);
  const [probing, setProbing] = useState(false);

  // Acervo state — multiple signals determine if active
  const settingsEnabled = stats.acervo_enabled ?? false;
  const [proxyStatus, setProxyStatus] = useState<AcervoProxyStatus | null>(null);
  const [graphInfo, setGraphInfo] = useState<AcervoGraphInfo | null>(null);
  const [contextLayers, setContextLayers] = useState<ContextLayersResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Acervo is "active" if settings say enabled OR if the proxy is reachable OR if graph data exists
  const proxyActive = proxyStatus?.status === "active" || proxyStatus?.status === "pass-through";
  const hasGraphData = graphInfo != null && graphInfo.initialized;
  const acervoActive = settingsEnabled || proxyActive || hasGraphData;

  // Determine display status
  const displayStatus = proxyActive
    ? proxyStatus!.status
    : settingsEnabled
      ? "disconnected"
      : hasGraphData
        ? "pass-through"
        : "disabled";

  const servers = mcpServers ?? stats.mcp_servers ?? [];

  const handleProbe = async () => {
    setProbing(true);
    try {
      const res = await mcpApi.probe();
      setMcpServers(res.servers);
    } catch {
      // ignore
    } finally {
      setProbing(false);
    }
  };

  const handleConfigSaved = () => {
    handleProbe();
  };

  // Fetch Acervo data — always try all endpoints (don't gate on settings flag)
  const fetchAcervoData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [statusResult, infoResult, layersResult] = await Promise.allSettled([
        acervoApi.getStatus(),
        acervoApi.getGraphInfo(),
        acervoApi.getContextLayers(),
      ]);
      if (statusResult.status === "fulfilled") {
        setProxyStatus(statusResult.value);
      } else {
        setProxyStatus(null);
      }
      if (infoResult.status === "fulfilled") {
        setGraphInfo(infoResult.value);
      }
      if (layersResult.status === "fulfilled") {
        setContextLayers(layersResult.value);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleClearAll = async () => {
    const ok = await confirm({
      title: "Clear all data",
      description: "Clear conversation and Acervo graph data? This cannot be undone.",
      confirmLabel: "Clear",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await acervoApi.clearData();
      onReset();
      await fetchAcervoData();
    } catch {
      // ignore
    }
  };

  // Fetch on mount and whenever the active project changes (via context)
  const prevActiveId = useRef(activeId);
  useEffect(() => {
    if (prevActiveId.current !== activeId) {
      prevActiveId.current = activeId;
    }
    fetchAcervoData();
  }, [fetchAcervoData, activeId]);

  // Auto-refresh after each turn completes
  useEffect(() => {
    if (stats.turns > 0) {
      fetchAcervoData();
    }
  }, [stats.turns]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    {ConfirmDialog}
    <div className="w-72 border-l border-border flex flex-col gap-2 p-3 overflow-y-auto">
      {/* Connection + reset */}
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
        <span className="text-sm text-muted-foreground/80">
          {connected ? "Connected" : "Disconnected"}
        </span>
        <button
          onClick={handleClearAll}
          className="ml-auto p-1 text-muted-foreground/60 hover:text-red-400 transition-colors cursor-pointer"
          title="Clear conversation and graph data"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <Separator />

      {/* Session info */}
      <div className="space-y-1.5">
        <SectionHeader>Session</SectionHeader>
        <div className="text-sm font-mono truncate" title={stats.model}>
          {stats.model || "\u2014"}
        </div>
        {stats.utility_model && (
          <div className="text-[13px] text-muted-foreground/70 font-mono truncate" title={stats.utility_model}>
            util: {stats.utility_model}
          </div>
        )}
        <div className="grid grid-cols-4 gap-x-2 gap-y-1 text-[13px] font-mono mt-1">
          <span className="text-muted-foreground/70">turns</span>
          <span className="text-foreground/90">{stats.turns}</span>
          <span className="text-muted-foreground/70">msgs</span>
          <span className="text-foreground/90">{stats.history_len}</span>
        </div>
      </div>

      {/* Last turn compact row */}
      {stats.last_speed_tps != null && (
        <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 text-[13px] font-mono bg-muted/30 rounded px-2 py-1.5">
          <span className="text-muted-foreground/70">speed</span>
          <span className="text-foreground/90">{stats.last_speed_tps?.toFixed(1)}t/s</span>
          <span className="text-muted-foreground/70">ttft</span>
          <span className="text-foreground/90">{stats.last_ttft_ms?.toFixed(0)}ms</span>
          <span className="text-muted-foreground/70">latency</span>
          <span className="text-foreground/90">{(stats.last_latency_ms! / 1000).toFixed(1)}s</span>
          <span className="text-muted-foreground/70">tokens</span>
          <span className="text-foreground/90">{stats.last_completion_tokens}</span>
        </div>
      )}

      <Separator />

      {/* Acervo Info */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <SectionHeader>Acervo</SectionHeader>
          <button
            onClick={fetchAcervoData}
            disabled={refreshing}
            className="p-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh Acervo data"
          >
            <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>

        {!acervoActive ? (
          <p className="text-[13px] text-muted-foreground/60">
            Not enabled &mdash; configure in Settings &gt; Acervo
          </p>
        ) : (
          <div className="space-y-1.5">
            {/* Status indicator */}
            <div className="flex items-center gap-1.5 text-sm">
              <AcervoStatusDot status={displayStatus} />
              <span className="font-mono text-foreground/90">
                {displayStatus === "active" ? "Active" :
                 displayStatus === "pass-through" ? "Graph available" :
                 displayStatus === "disconnected" ? "Proxy disconnected" :
                 "Unknown"}
              </span>
            </div>

            {/* Context layers panel */}
            {contextLayers && contextLayers.totals.nodes > 0 ? (
              <ContextLayersPanel data={contextLayers} />
            ) : graphInfo && graphInfo.initialized ? (
              <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 text-[13px] font-mono">
                <span className="text-muted-foreground/70">nodes</span>
                <span className="text-foreground/90">{graphInfo.node_count}</span>
                <span className="text-muted-foreground/70">edges</span>
                <span className="text-foreground/90">{graphInfo.edge_count}</span>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground/50 font-mono italic">
                No graph data yet — send a message to start
              </p>
            )}

            {/* Proxy details when connected */}
            {proxyActive && proxyStatus && (
              <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 text-[13px] font-mono">
                {proxyStatus.turns != null && (
                  <>
                    <span className="text-muted-foreground/70">turns</span>
                    <span className="text-foreground/90">{proxyStatus.turns}</span>
                  </>
                )}
                {proxyStatus.changelog_entries != null && (
                  <>
                    <span className="text-muted-foreground/70">changelog</span>
                    <span className="text-foreground/90">{proxyStatus.changelog_entries}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* MCP Servers — compact */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <SectionHeader>MCP Servers</SectionHeader>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setMcpConfigOpen(true)}
              className="p-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
              title="Edit .mcp.json"
            >
              <FileJson size={11} />
            </button>
            <button
              onClick={handleProbe}
              disabled={probing}
              className="p-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer disabled:opacity-50"
              title="Check status"
            >
              <RefreshCw size={11} className={probing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        {servers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground/60">No servers configured</p>
        ) : (
          <div className="space-y-1.5">
            {servers.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5 text-sm">
                <McpStatusDot status={s.status} />
                <span className="font-mono truncate text-foreground/90">{s.name}</span>
                <span className="ml-auto text-[13px] text-muted-foreground/70">{s.status}</span>
              </div>
            ))}
            {servers.some((s) => s.error) && (
              <div className="mt-1">
                {servers
                  .filter((s) => s.error)
                  .map((s) => (
                    <p key={s.name} className="text-[13px] text-red-400 truncate" title={s.error}>
                      {s.name}: {s.error}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      <McpConfigDialog
        open={mcpConfigOpen}
        onOpenChange={setMcpConfigOpen}
        onSaved={handleConfigSaved}
      />
    </div>
    </>
  );
}
