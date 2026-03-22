import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MetricsData, TurnMetric, TurnLogEntry } from "@/lib/types";
import { turnLogApi } from "@/lib/api";

const API_BASE = "http://localhost:8000/api";

function StatCard({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {value}
          {unit && <span className="text-sm text-muted-foreground ml-1">{unit}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

function TokenChart({ turns }: { turns: TurnMetric[] }) {
  if (turns.length === 0) return null;

  const maxTokens = Math.max(...turns.map((t) => t.total_context_tokens), 1);
  const barWidth = Math.max(4, Math.min(24, Math.floor(600 / turns.length)));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Context Tokens per Turn</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-px h-40 overflow-x-auto">
          {turns.map((t) => {
            const warmPct = (t.warm_tokens / maxTokens) * 100;
            const hotPct = (t.hot_tokens / maxTokens) * 100;
            const totalPct = (t.total_context_tokens / maxTokens) * 100;

            return (
              <div
                key={t.turn_number}
                className="flex flex-col items-center group relative"
                style={{ width: barWidth }}
              >
                <div
                  className="w-full rounded-t-sm flex flex-col justify-end"
                  style={{ height: `${totalPct}%`, minHeight: 2 }}
                >
                  <div
                    className="w-full bg-blue-500/80 rounded-t-sm"
                    style={{ height: `${warmPct}%`, minHeight: warmPct > 0 ? 1 : 0 }}
                  />
                  <div
                    className="w-full bg-emerald-500/80"
                    style={{ height: `${hotPct}%`, minHeight: hotPct > 0 ? 1 : 0 }}
                  />
                </div>
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-popover-foreground text-xs px-2 py-1 rounded shadow-md whitespace-nowrap z-10">
                  T{t.turn_number}: {t.total_context_tokens}tk ({t.warm_tokens}w + {t.hot_tokens}h)
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-blue-500/80 rounded-sm" /> Warm (graph)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-emerald-500/80 rounded-sm" /> Hot (recent turns)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function TurnTable({ turns }: { turns: TurnMetric[] }) {
  if (turns.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Turn Details</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Topic</th>
              <th className="py-2 pr-3">Tool</th>
              <th className="py-2 pr-3">Tokens</th>
              <th className="py-2 pr-3">Warm</th>
              <th className="py-2 pr-3">Hot</th>
              <th className="py-2 pr-3">Nodes</th>
              <th className="py-2 pr-3">Entities</th>
              <th className="py-2 pr-3">Facts</th>
              <th className="py-2 pr-3">Context</th>
            </tr>
          </thead>
          <tbody>
            {turns.map((t) => (
              <tr key={t.turn_number} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-1.5 pr-3 tabular-nums">{t.turn_number}</td>
                <td className="py-1.5 pr-3 max-w-[120px] truncate">{t.topic || "—"}</td>
                <td className="py-1.5 pr-3">
                  <Badge variant="outline" className="text-[12px] px-1.5 py-0">
                    {t.plan_tool}
                  </Badge>
                </td>
                <td className="py-1.5 pr-3 tabular-nums">{t.total_context_tokens}</td>
                <td className="py-1.5 pr-3 tabular-nums text-blue-400">{t.warm_tokens}</td>
                <td className="py-1.5 pr-3 tabular-nums text-emerald-400">{t.hot_tokens}</td>
                <td className="py-1.5 pr-3 tabular-nums">{t.node_count}</td>
                <td className="py-1.5 pr-3 tabular-nums">{t.entities_extracted}</td>
                <td className="py-1.5 pr-3 tabular-nums">{t.facts_added}</td>
                <td className="py-1.5 pr-3">
                  {t.context_hit ? (
                    <span className="text-emerald-400">hit</span>
                  ) : (
                    <span className="text-muted-foreground">miss</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ── Turn Audit Log ──

function TurnLogRow({ entry }: { entry: TurnLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-1.5 pr-3 tabular-nums">{entry.turn}</td>
        <td className="py-1.5 pr-3 text-muted-foreground text-[12px]">{entry.timestamp.split("T")[1] ?? ""}</td>
        <td className="py-1.5 pr-3 max-w-[100px] truncate">{entry.topic || "—"}</td>
        <td className="py-1.5 pr-3">
          <Badge variant="outline" className="text-[12px] px-1.5 py-0">
            {entry.planner?.tool ?? "—"}
          </Badge>
        </td>
        <td className="py-1.5 pr-3">{entry.decision?.action ?? "—"}</td>
        <td className="py-1.5 pr-3 tabular-nums text-blue-400">{entry.context?.warm_tokens ?? "—"}</td>
        <td className="py-1.5 pr-3 tabular-nums text-emerald-400">{entry.context?.hot_tokens ?? "—"}</td>
        <td className="py-1.5 pr-3 tabular-nums">{entry.context?.total_tokens ?? "—"}</td>
        <td className="py-1.5 pr-3 tabular-nums">{entry.llm?.speed_tps ? `${entry.llm.speed_tps}t/s` : "—"}</td>
        <td className="py-1.5 pr-3 tabular-nums">{entry.extraction?.entities?.length ?? 0}</td>
        <td className="py-1.5 pr-3">{expanded ? "▼" : "▶"}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/30">
          <td colSpan={11} className="p-3 bg-muted/20">
            <div className="space-y-2 text-xs">
              {/* User input */}
              <div>
                <span className="font-medium text-muted-foreground">User: </span>
                <span>{entry.user_input}</span>
              </div>
              {/* Assistant response */}
              {entry.assistant_response && (
                <div>
                  <span className="font-medium text-muted-foreground">Assistant: </span>
                  <span className="text-muted-foreground/80">
                    {entry.assistant_response.length > 300
                      ? entry.assistant_response.slice(0, 300) + "…"
                      : entry.assistant_response}
                  </span>
                </div>
              )}
              {/* Planner details */}
              {entry.planner && (
                <div className="flex gap-4">
                  <span>
                    <span className="text-muted-foreground">Planner: </span>
                    {entry.planner.tool} → {entry.planner.entity || "—"}
                    {entry.planner.query ? ` "${entry.planner.query}"` : ""}
                  </span>
                </div>
              )}
              {/* Executor */}
              {entry.executor && (
                <div>
                  <span className="text-muted-foreground">Executor: </span>
                  source={entry.executor.source}, {entry.executor.node_count} nodes, {entry.executor.fact_count} facts
                </div>
              )}
              {/* LLM */}
              {entry.llm && (
                <div>
                  <span className="text-muted-foreground">LLM: </span>
                  {entry.llm.model}
                  {entry.llm.skipped ? " (skipped)" : ` · ${entry.llm.completion_tokens}tk · ${entry.llm.latency_ms}ms · ${entry.llm.speed_tps}t/s`}
                </div>
              )}
              {/* Extraction */}
              {entry.extraction?.entities && entry.extraction.entities.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Extracted: </span>
                  {entry.extraction.entities.map(([name, type]) => `${name} (${type})`).join(", ")}
                </div>
              )}
              {/* Filtered facts */}
              {entry.facts_filtered && entry.facts_filtered.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Filtered: </span>
                  {entry.facts_filtered.map((f, i) => (
                    <span key={i} className="text-red-400/70">
                      {f.entity}: "{f.fact}" ({f.reason}){i < entry.facts_filtered!.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
              )}
              {/* Graph state */}
              {entry.graph_after && (
                <div>
                  <span className="text-muted-foreground">Graph: </span>
                  {entry.graph_after.node_count} nodes, {entry.graph_after.edge_count} edges
                </div>
              )}
              {/* Errors */}
              {entry.errors && entry.errors.length > 0 && (
                <div className="text-red-400">
                  {entry.errors.map((e, i) => (
                    <div key={i}>[{e.step}] {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TurnAuditLog({ session }: { session: string }) {
  const [entries, setEntries] = useState<TurnLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const res = await turnLogApi.getTurns(session);
        if (!cancelled) setEntries(res.turns);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading turn log...</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No turns logged yet.</p>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Turn Audit Log</CardTitle>
          <Badge variant="outline">{entries.length} turns</Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Time</th>
              <th className="py-2 pr-3">Topic</th>
              <th className="py-2 pr-3">Planner</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Warm</th>
              <th className="py-2 pr-3">Hot</th>
              <th className="py-2 pr-3">Total</th>
              <th className="py-2 pr-3">Speed</th>
              <th className="py-2 pr-3">Entities</th>
              <th className="py-2 pr-3" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <TurnLogRow key={entry.turn} entry={entry} />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function MetricsPage() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/metrics`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // API not available
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading metrics...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Acervo Metrics</h1>
        {data && <Badge variant="outline">{data.turn_count} turns</Badge>}
      </div>

      {data && data.turn_count > 0 ? (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Avg Context Tokens" value={data.aggregates.avg_total_tokens.toFixed(0)} unit="tk" />
            <StatCard label="Context Hit Rate" value={`${(data.aggregates.context_hit_rate * 100).toFixed(0)}%`} />
            <StatCard label="Graph Growth" value={data.aggregates.graph_growth_rate.toFixed(1)} unit="nodes/turn" />
            <StatCard label="Fact Density" value={data.aggregates.fact_density.toFixed(1)} unit="facts/node" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Avg Warm Tokens" value={data.aggregates.avg_warm_tokens.toFixed(0)} unit="tk" />
            <StatCard label="Total Entities" value={data.aggregates.total_entities_extracted} />
            <StatCard label="Facts Added" value={data.aggregates.total_facts_added} />
            <StatCard label="Facts Deduped" value={data.aggregates.total_facts_deduped} />
          </div>

          {/* Token chart */}
          <TokenChart turns={data.turns} />

          {/* Turn details table (from Acervo metrics) */}
          <TurnTable turns={data.turns} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No Acervo metrics yet. Start chatting to see aggregates.</p>
      )}

      {/* Turn Audit Log — always show, reads from JSONL */}
      <TurnAuditLog session="default" />
    </div>
  );
}
