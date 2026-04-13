import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Link, Trash2, Merge, Bot, User, Cog } from "lucide-react";
import type { GraphNode, GraphSource } from "@/lib/api";

const SOURCE_ICONS: Record<GraphSource, typeof Bot> = {
  llm: Bot,
  user: User,
  system: Cog,
};

function confidenceColor(c: number | undefined): string {
  if (c == null) return "text-muted-foreground";
  if (c >= 0.8) return "text-emerald-500";
  if (c >= 0.6) return "text-amber-500";
  return "text-red-500";
}

const RELATION_TYPES = [
  "related_to", "part_of", "contains", "created_by", "member_of",
  "located_in", "depends_on", "uses_technology",
];

interface OrphansPanelProps {
  orphans: GraphNode[];
  allNodes: GraphNode[];
  unavailable?: boolean;
  onSelectNode: (nodeId: string) => void;
  onCreateEdge: (source: string, target: string, relation: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onMerge: (sourceId: string, targetId: string) => void;
}

/** Simple label similarity: shared words / total unique words */
function labelSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

function getSuggestions(orphan: GraphNode, allNodes: GraphNode[], max = 3): GraphNode[] {
  return allNodes
    .filter((n) => n.id !== orphan.id)
    .map((n) => ({ node: n, score: labelSimilarity(orphan.label, n.label) }))
    .filter((s) => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.node);
}

export function OrphansPanel({
  orphans,
  allNodes,
  unavailable,
  onSelectNode,
  onCreateEdge,
  onDeleteNode,
  onMerge,
}: OrphansPanelProps) {
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [relation, setRelation] = useState("related_to");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (unavailable) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <AlertTriangle size={32} strokeWidth={1.5} />
        <p className="text-xs">Orphans endpoint not available — backend endpoint not connected yet</p>
      </div>
    );
  }

  if (orphans.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <p className="text-xs">No orphan nodes</p>
      </div>
    );
  }

  return (
    <div className="max-h-[280px] overflow-y-auto space-y-1.5 p-1">
      {orphans.map((orphan) => {
        const suggestions = getSuggestions(orphan, allNodes);
        return (
          <div
            key={orphan.id}
            className="px-2.5 py-2 rounded-md border border-border bg-card space-y-1.5"
          >
            {/* Header row */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSelectNode(orphan.id)}
                className="text-xs font-medium text-primary underline cursor-pointer hover:text-primary/80 truncate"
              >
                {orphan.label}
              </button>
              <Badge variant="outline" className="text-[9px] shrink-0">{orphan.type}</Badge>
              {orphan.source && (() => {
                const SourceIcon = SOURCE_ICONS[orphan.source];
                return <SourceIcon size={10} className="text-muted-foreground shrink-0" />;
              })()}
              {orphan.confidence != null && (
                <span
                  className={`text-[10px] font-mono shrink-0 ${confidenceColor(orphan.confidence)}`}
                >
                  {Math.round(orphan.confidence * 100)}%
                </span>
              )}
              {orphan.created_at && (
                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                  {new Date(orphan.created_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Similarity suggestions */}
            {suggestions.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Similar:</span>
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onMerge(s.id, orphan.id)}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent/50 text-[10px] hover:bg-accent cursor-pointer"
                    title={`Merge "${orphan.label}" into "${s.label}"`}
                  >
                    <Merge size={8} />
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* Connect inline form */}
            {connectingId === orphan.id ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  placeholder="Search target node..."
                  value={targetSearch}
                  onChange={(e) => setTargetSearch(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />
                <div className="max-h-24 overflow-y-auto border border-border rounded-md">
                  {allNodes
                    .filter(
                      (n) =>
                        n.id !== orphan.id &&
                        (n.label.toLowerCase().includes(targetSearch.toLowerCase()) ||
                          n.id.toLowerCase().includes(targetSearch.toLowerCase())),
                    )
                    .slice(0, 10)
                    .map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setSelectedTarget(n.id)}
                        className={`w-full text-left px-2 py-1 text-xs hover:bg-accent/50 cursor-pointer ${
                          selectedTarget === n.id ? "bg-accent text-accent-foreground" : ""
                        }`}
                      >
                        {n.label}
                      </button>
                    ))}
                </div>
                {selectedTarget && (
                  <select
                    value={relation}
                    onChange={(e) => setRelation(e.target.value)}
                    className="w-full rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {RELATION_TYPES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                )}
                <div className="flex gap-1.5">
                  <Button
                    size="xs"
                    className="text-xs"
                    disabled={!selectedTarget}
                    onClick={() => {
                      onCreateEdge(orphan.id, selectedTarget, relation);
                      setConnectingId(null);
                      setTargetSearch("");
                      setSelectedTarget("");
                      setRelation("related_to");
                    }}
                  >
                    <Link size={10} className="mr-1" />
                    Connect
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-xs"
                    onClick={() => {
                      setConnectingId(null);
                      setTargetSearch("");
                      setSelectedTarget("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="xs"
                  className="text-xs"
                  onClick={() => setConnectingId(orphan.id)}
                >
                  <Link size={10} className="mr-1" />
                  Connect
                </Button>
                {confirmDeleteId === orphan.id ? (
                  <>
                    <Button
                      variant="destructive"
                      size="xs"
                      className="text-xs"
                      onClick={() => {
                        onDeleteNode(orphan.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      className="text-xs"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="xs"
                    className="text-xs text-destructive"
                    onClick={() => setConfirmDeleteId(orphan.id)}
                  >
                    <Trash2 size={10} className="mr-1" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
