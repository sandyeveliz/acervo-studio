import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download, Upload, RefreshCw, Plus, FileDown, Sparkles, Info } from "lucide-react";
import type { GraphSource, GraphStatus } from "@/lib/api";

interface GraphToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onExport: () => void;
  onImport: (data: string) => void;
  onRefresh: () => void;
  onExportTraining: () => void;
  onCreateNode: () => void;
  typeFilter: string | null;
  onTypeFilterChange: (type: string | null) => void;
  layerFilter: string | null;
  onLayerFilterChange: (layer: string | null) => void;
  availableTypes: string[];
  availableLayers: string[];
  // v0.6.1
  sourceFilter?: GraphSource | null;
  onSourceFilterChange?: (source: GraphSource | null) => void;
  statusFilter?: GraphStatus | null;
  onStatusFilterChange?: (status: GraphStatus | null) => void;
  showLegend?: boolean;
  onToggleLegend?: () => void;
  onDedupGlobal?: () => void;
}

export function GraphToolbar({
  searchQuery,
  onSearchChange,
  onExport,
  onImport,
  onRefresh,
  onExportTraining,
  onCreateNode,
  typeFilter,
  onTypeFilterChange,
  layerFilter,
  onLayerFilterChange,
  availableTypes,
  availableLayers,
  sourceFilter = null,
  onSourceFilterChange,
  statusFilter = null,
  onStatusFilterChange,
  showLegend = false,
  onToggleLegend,
  onDedupGlobal,
}: GraphToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImport(reader.result as string);
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
      {/* Search */}
      <input
        type="text"
        placeholder="Search nodes..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="max-w-[200px] rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      {/* Type filter */}
      <select
        value={typeFilter ?? ""}
        onChange={(e) => onTypeFilterChange(e.target.value || null)}
        className="rounded-md border border-input bg-secondary/50 px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">All types</option>
        {availableTypes.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Layer filter */}
      {availableLayers.length > 0 && (
        <select
          value={layerFilter ?? ""}
          onChange={(e) => onLayerFilterChange(e.target.value || null)}
          className="rounded-md border border-input bg-secondary/50 px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">All layers</option>
          {availableLayers.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      )}

      {/* Source filter (v0.6.1) */}
      {onSourceFilterChange && (
        <select
          value={sourceFilter ?? ""}
          onChange={(e) =>
            onSourceFilterChange((e.target.value as GraphSource) || null)
          }
          className="rounded-md border border-input bg-secondary/50 px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title="Filter by source"
        >
          <option value="">All sources</option>
          <option value="llm">LLM</option>
          <option value="user">User</option>
          <option value="system">System</option>
        </select>
      )}

      {/* Status filter (v0.6.1) */}
      {onStatusFilterChange && (
        <select
          value={statusFilter ?? ""}
          onChange={(e) =>
            onStatusFilterChange((e.target.value as GraphStatus) || null)
          }
          className="rounded-md border border-input bg-secondary/50 px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title="Filter by status"
        >
          <option value="">All status</option>
          <option value="pending_review">Pending</option>
          <option value="confirmed">Confirmed</option>
        </select>
      )}

      {/* Actions */}
      <div className="ml-auto flex gap-1.5">
        <Button variant="outline" size="sm" onClick={onCreateNode} className="text-xs">
          <Plus size={14} className="mr-1" />
          Node
        </Button>
        {onDedupGlobal && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDedupGlobal}
            className="text-xs"
            title="Run fact deduplication across the whole graph"
          >
            <Sparkles size={14} className="mr-1" />
            Dedup
          </Button>
        )}
        {onToggleLegend && (
          <Button
            variant={showLegend ? "secondary" : "outline"}
            size="sm"
            onClick={onToggleLegend}
            className="text-xs"
            title="Toggle legend"
          >
            <Info size={14} />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onRefresh} className="text-xs">
          <RefreshCw size={14} />
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} className="text-xs">
          <Download size={14} className="mr-1" />
          JSON
        </Button>
        <Button variant="outline" size="sm" onClick={onExportTraining} className="text-xs">
          <FileDown size={14} className="mr-1" />
          Training
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="text-xs">
          <Upload size={14} className="mr-1" />
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileImport}
        />
      </div>
    </div>
  );
}
