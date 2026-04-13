import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import type { GraphNode, GraphEdge } from "@/lib/api";

interface ReviewQueuePanelProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectNode: (nodeId: string) => void;
  onConfirmNode: (nodeId: string) => void;
  onConfirmEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

function confidenceColor(c: number | undefined): string {
  if (c == null) return "text-muted-foreground";
  if (c >= 0.8) return "text-emerald-500";
  if (c >= 0.6) return "text-amber-500";
  return "text-red-500";
}

export function ReviewQueuePanel({
  nodes,
  edges,
  onSelectNode,
  onConfirmNode,
  onConfirmEdge,
  onDeleteNode,
  onDeleteEdge,
}: ReviewQueuePanelProps) {
  const [expandNodes, setExpandNodes] = useState(true);
  const [expandEdges, setExpandEdges] = useState(true);

  const pendingNodes = useMemo(
    () =>
      nodes
        .filter((n) => n.status === "pending_review")
        .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0)),
    [nodes],
  );

  const pendingEdges = useMemo(
    () =>
      edges
        .filter((e) => e.status === "pending_review")
        .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0)),
    [edges],
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  if (pendingNodes.length === 0 && pendingEdges.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <ShieldCheck size={32} strokeWidth={1.5} className="text-emerald-500" />
        <p className="text-xs">No items pending review</p>
      </div>
    );
  }

  return (
    <div className="max-h-[300px] overflow-y-auto p-2 space-y-2">
      {/* Nodes section */}
      {pendingNodes.length > 0 && (
        <div>
          <button
            onClick={() => setExpandNodes(!expandNodes)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-xs cursor-pointer"
          >
            {expandNodes ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <AlertTriangle size={12} className="text-amber-500" />
            <span className="flex-1 text-left font-medium">Nodes</span>
            <Badge variant="outline" className="text-[10px]">
              {pendingNodes.length}
            </Badge>
          </button>
          {expandNodes && (
            <div className="ml-2 mt-1 space-y-1">
              {pendingNodes.map((n) => (
                <div
                  key={n.id}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/5 text-xs"
                >
                  <button
                    onClick={() => onSelectNode(n.id)}
                    className="text-primary underline cursor-pointer hover:text-primary/80 truncate flex-1 text-left"
                  >
                    {n.label}
                  </button>
                  <Badge variant="outline" className="text-[9px] shrink-0">
                    {n.type}
                  </Badge>
                  {n.confidence != null && (
                    <span
                      className={`text-[10px] font-mono shrink-0 ${confidenceColor(n.confidence)}`}
                    >
                      {Math.round(n.confidence * 100)}%
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 text-emerald-500 hover:text-emerald-400"
                    onClick={() => onConfirmNode(n.id)}
                    title="Confirm"
                  >
                    <Check size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 text-destructive hover:text-destructive/80"
                    onClick={() => onDeleteNode(n.id)}
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edges section */}
      {pendingEdges.length > 0 && (
        <div>
          <button
            onClick={() => setExpandEdges(!expandEdges)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 text-xs cursor-pointer"
          >
            {expandEdges ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <AlertTriangle size={12} className="text-amber-500" />
            <span className="flex-1 text-left font-medium">Edges</span>
            <Badge variant="outline" className="text-[10px]">
              {pendingEdges.length}
            </Badge>
          </button>
          {expandEdges && (
            <div className="ml-2 mt-1 space-y-1">
              {pendingEdges.map((e) => {
                const src = nodeById.get(e.source);
                const tgt = nodeById.get(e.target);
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/5 text-xs"
                  >
                    <button
                      onClick={() => onSelectNode(e.source)}
                      className="text-primary underline cursor-pointer hover:text-primary/80 truncate"
                    >
                      {src?.label ?? e.source}
                    </button>
                    <span className="text-muted-foreground shrink-0">{e.relation}</span>
                    <button
                      onClick={() => onSelectNode(e.target)}
                      className="text-primary underline cursor-pointer hover:text-primary/80 truncate flex-1 text-left"
                    >
                      {tgt?.label ?? e.target}
                    </button>
                    {e.confidence != null && (
                      <span
                        className={`text-[10px] font-mono shrink-0 ${confidenceColor(e.confidence)}`}
                      >
                        {Math.round(e.confidence * 100)}%
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0 text-emerald-500 hover:text-emerald-400"
                      onClick={() => onConfirmEdge(e.id)}
                      title="Confirm"
                    >
                      <Check size={12} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive/80"
                      onClick={() => onDeleteEdge(e.id)}
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
