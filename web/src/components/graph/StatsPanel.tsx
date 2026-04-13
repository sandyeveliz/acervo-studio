import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, CartesianGrid,
} from "recharts";
import type { GraphStats, GraphNode } from "@/lib/api";
import { TYPE_COLORS, getNodeColor } from "@/components/graph/GraphViewer";

interface StatsPanelProps {
  stats: GraphStats | null;
  nodes: GraphNode[];
}

export function StatsPanel({ stats, nodes }: StatsPanelProps) {
  // Type distribution for donut
  const typeData = useMemo(() => {
    if (!stats?.types_distribution) return [];
    return Object.entries(stats.types_distribution)
      .map(([name, value]) => ({ name, value, fill: getNodeColor(name) }))
      .sort((a, b) => b.value - a.value);
  }, [stats?.types_distribution]);

  // Relation distribution for bar chart
  const relationData = useMemo(() => {
    if (!stats?.relations_distribution) return [];
    return Object.entries(stats.relations_distribution)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);
  }, [stats?.relations_distribution]);

  // Growth timeline: cumulative nodes by created_at date
  const timelineData = useMemo(() => {
    const datedNodes = nodes.filter((n) => n.created_at);
    if (datedNodes.length === 0) return [];

    // Group by date
    const byDate: Record<string, number> = {};
    for (const n of datedNodes) {
      const date = n.created_at!.slice(0, 10);
      byDate[date] = (byDate[date] ?? 0) + 1;
    }

    // Sort and accumulate
    const sorted = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
    let cumulative = 0;
    return sorted.map(([date, count]) => {
      cumulative += count;
      return { date, count, cumulative };
    });
  }, [nodes]);

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <p className="text-xs">No stats available</p>
      </div>
    );
  }

  return (
    <div className="max-h-[300px] overflow-y-auto p-2 space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-2.5 text-center">
            <p className="text-lg font-semibold">{stats.total_nodes}</p>
            <p className="text-[10px] text-muted-foreground">Nodes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2.5 text-center">
            <p className="text-lg font-semibold">{stats.total_edges}</p>
            <p className="text-[10px] text-muted-foreground">Edges</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2.5 text-center">
            <p className="text-lg font-semibold">{stats.orphan_count ?? "—"}</p>
            <p className="text-[10px] text-muted-foreground">Orphans</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-2">
        {/* Type distribution donut */}
        {typeData.length > 0 && (
          <Card>
            <CardHeader className="pb-1 pt-2 px-3">
              <CardTitle className="text-[10px] font-medium text-muted-foreground">Types</CardTitle>
            </CardHeader>
            <CardContent className="px-1 pb-2">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie
                    data={typeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={55}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {typeData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ fontSize: "11px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }}
                    formatter={(value: number, name: string) => [`${value}`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-1 px-2">
                {typeData.slice(0, 8).map((d) => (
                  <span key={d.name} className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: d.fill }} />
                    {d.name}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Relation distribution bar */}
        {relationData.length > 0 && (
          <Card>
            <CardHeader className="pb-1 pt-2 px-3">
              <CardTitle className="text-[10px] font-medium text-muted-foreground">Relations</CardTitle>
            </CardHeader>
            <CardContent className="px-1 pb-2">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={relationData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={80}
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: "11px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }}
                  />
                  <Bar dataKey="value" fill="#60a5fa" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Growth timeline */}
      {timelineData.length > 1 && (
        <Card>
          <CardHeader className="pb-1 pt-2 px-3">
            <CardTitle className="text-[10px] font-medium text-muted-foreground">Growth</CardTitle>
          </CardHeader>
          <CardContent className="px-1 pb-2">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={timelineData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} width={30} />
                <Tooltip
                  contentStyle={{ fontSize: "11px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }}
                />
                <Line type="monotone" dataKey="cumulative" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
