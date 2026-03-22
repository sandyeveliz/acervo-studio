import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, ListFilter } from "lucide-react";
import type { ExtractionEvent } from "@/lib/api";

interface ExtractionLogProps {
  events: ExtractionEvent[];
  onSelectNode?: (label: string) => void;
}

const ACTION_COLORS: Record<string, string> = {
  created_node: "bg-green-500/20 text-green-400",
  enriched_node: "bg-blue-500/20 text-blue-400",
  enriched_batch: "bg-purple-500/20 text-purple-400",
  graph_snapshot: "bg-zinc-500/20 text-zinc-400",
};

export function ExtractionLog({ events, onSelectNode }: ExtractionLogProps) {
  const [filterComponent, setFilterComponent] = useState<string>("");
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");

  // Derive unique values for filters
  const components = useMemo(
    () => [...new Set(events.map((e) => e.component))].sort(),
    [events],
  );
  const actions = useMemo(
    () => [...new Set(events.map((e) => e.action))].sort(),
    [events],
  );
  const sources = useMemo(
    () => [...new Set(events.map((e) => e.source))].sort(),
    [events],
  );

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (filterComponent && e.component !== filterComponent) return false;
      if (filterAction && e.action !== filterAction) return false;
      if (filterSource && e.source !== filterSource) return false;
      return true;
    });
  }, [events, filterComponent, filterAction, filterSource]);

  const handleExportCsv = () => {
    const headers = [
      "timestamp",
      "turn",
      "user_message_preview",
      "component",
      "action",
      "node_label",
      "node_type",
      "source",
    ];
    const rows = filtered.map((e) =>
      headers.map((h) => {
        const val = e[h as keyof ExtractionEvent];
        const str = val == null ? "" : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      }),
    );
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n",
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extraction-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasFilters = filterComponent || filterAction || filterSource;

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ListFilter size={14} />
            Extraction Log ({filtered.length}
            {hasFilters ? ` / ${events.length}` : ""})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
          >
            <Download size={12} className="mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {/* Filters */}
        <div className="flex gap-1.5 flex-wrap">
          <FilterSelect
            value={filterComponent}
            onChange={setFilterComponent}
            options={components}
            placeholder="Component"
          />
          <FilterSelect
            value={filterAction}
            onChange={setFilterAction}
            options={actions}
            placeholder="Action"
          />
          <FilterSelect
            value={filterSource}
            onChange={setFilterSource}
            options={sources}
            placeholder="Source"
          />
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] px-2"
              onClick={() => {
                setFilterComponent("");
                setFilterAction("");
                setFilterSource("");
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Events */}
        <ScrollArea className="max-h-[350px]">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No extraction events recorded yet.
            </p>
          ) : (
            <div className="space-y-1">
              {filtered
                .slice()
                .reverse()
                .map((event, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-accent/30 text-xs"
                  >
                    <span className="text-[11px] text-muted-foreground/70 shrink-0 w-14 font-mono">
                      T{event.turn}
                    </span>
                    <Badge
                      className={`text-[10px] shrink-0 ${ACTION_COLORS[event.action] ?? ""}`}
                    >
                      {event.action}
                    </Badge>
                    {event.node_label ? (
                      <button
                        onClick={() => onSelectNode?.(event.node_label)}
                        className="text-primary underline cursor-pointer hover:text-primary/80 truncate"
                      >
                        {event.node_label}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground/60 shrink-0">
                      {event.timestamp.split("T")[1] ?? event.timestamp}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 rounded-md border border-input bg-secondary/50 px-2 text-[11px] text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
