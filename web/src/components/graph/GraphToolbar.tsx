import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Upload } from "lucide-react";
import type { GraphStats } from "@/lib/api";

interface GraphToolbarProps {
  stats: GraphStats | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onExport: () => void;
  onImport: (data: string) => void;
}

export function GraphToolbar({
  stats,
  searchQuery,
  onSearchChange,
  onExport,
  onImport,
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
    <div className="flex items-center gap-3 p-3 border-b border-border">
      <input
        type="text"
        placeholder="Search nodes..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1 max-w-xs rounded-md border border-input bg-secondary/50 px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      {stats && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[12px] font-mono">
            {stats.node_count} nodes
          </Badge>
          <Badge variant="secondary" className="text-[12px] font-mono">
            {stats.edge_count} edges
          </Badge>
          {Object.entries(stats.type_distribution).map(([type, count]) => (
            <Badge key={type} variant="outline" className="text-[12px]">
              {type}: {count}
            </Badge>
          ))}
        </div>
      )}

      <div className="ml-auto flex gap-1.5">
        <Button variant="outline" size="sm" onClick={onExport} className="text-xs">
          <Download size={14} className="mr-1" />
          Export
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
