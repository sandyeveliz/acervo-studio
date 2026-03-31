import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, X, Merge, ArrowRight, Copy, Check, Plus } from "lucide-react";
import type { GraphNode, GraphEdge } from "@/lib/api";

const RELATION_TYPES = [
  "related_to", "part_of", "contains", "created_by", "member_of",
  "located_in", "depends_on", "uses_technology", "alternative_to",
  "deployed_on", "produces", "serves", "documented_in",
  "participated_in", "triggered_by", "resulted_in",
  "sequel_of", "prequel_of", "shares_characters_with",
];

interface NodeDetailPanelProps {
  node: GraphNode | null;
  allNodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteFact: (nodeId: string, fact: string) => void;
  onMerge: (keepId: string, absorbId: string, alias: string | null) => void;
  onSelectNode: (nodeId: string) => void;
  onCreateEdge?: (source: string, target: string, relation: string) => void;
  onDeleteEdge?: (source: string, target: string, relation: string) => void;
}

export function NodeDetailPanel({ node, allNodes, edges, onClose, onDeleteNode, onDeleteFact, onMerge, onSelectNode, onCreateEdge, onDeleteEdge }: NodeDetailPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeAlias, setMergeAlias] = useState("");
  const [copied, setCopied] = useState(false);
  const [addEdgeMode, setAddEdgeMode] = useState(false);
  const [edgeSearch, setEdgeSearch] = useState("");
  const [edgeTargetId, setEdgeTargetId] = useState("");
  const [edgeRelation, setEdgeRelation] = useState("related_to");

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a node to view details
      </div>
    );
  }

  const filteredMergeTargets = allNodes.filter(
    (n) =>
      n.id !== node.id &&
      (n.label.toLowerCase().includes(mergeSearch.toLowerCase()) ||
        n.id.toLowerCase().includes(mergeSearch.toLowerCase())),
  );

  const selectedTarget = allNodes.find((n) => n.id === mergeTarget);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-medium">{node.label}</h3>
            <div className="flex gap-1.5 mt-1">
              <Badge variant="outline" className="text-[12px]">{node.type}</Badge>
              {node.layer && <Badge variant="secondary" className="text-[12px]">{node.layer}</Badge>}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
            <X size={14} />
          </Button>
        </div>

        <Separator />

        {/* Meta */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">Info</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-y-1.5 text-xs">
              <span className="text-muted-foreground">ID</span>
              <span className="font-mono truncate" title={node.id}>{node.id}</span>
              {node.owner && (
                <>
                  <span className="text-muted-foreground">Owner</span>
                  <span>{node.owner}</span>
                </>
              )}
              {node.confidence_for_owner != null && (
                <>
                  <span className="text-muted-foreground">Confidence</span>
                  <span>{(node.confidence_for_owner * 100).toFixed(0)}%</span>
                </>
              )}
              {node.session_count != null && (
                <>
                  <span className="text-muted-foreground">Sessions</span>
                  <span>{node.session_count}</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Facts */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Facts ({node.facts?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {(node.facts ?? []).map((f, i) => (
              <div key={i} className="flex items-start gap-2 group">
                <p className="text-xs flex-1">{f.fact}</p>
                <button
                  onClick={() => onDeleteFact(node.id, f.fact)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive-foreground transition-opacity cursor-pointer"
                  title="Remove fact"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {(!node.facts || node.facts.length === 0) && (
              <p className="text-xs text-muted-foreground">No facts recorded</p>
            )}
          </CardContent>
        </Card>

        {/* Edges */}
        {node && (() => {
          const nodeEdges = edges.filter(
            (e) => e.source === node.id || e.target === node.id,
          );
          return (
            <Card>
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Edges ({nodeEdges.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-1">
                {nodeEdges.length === 0 && (
                  <p className="text-xs text-muted-foreground">No edges (orphan)</p>
                )}
                {nodeEdges.slice(0, 20).map((e, i) => {
                  const isSource = e.source === node.id;
                  const otherId = isSource ? e.target : e.source;
                  const otherNode = allNodes.find((n) => n.id === otherId);
                  return (
                    <div key={i} className="flex items-center gap-1.5 text-xs group">
                      {isSource ? (
                        <>
                          <span className="text-muted-foreground">{e.relation}</span>
                          <ArrowRight size={10} className="text-muted-foreground" />
                          <button
                            onClick={() => onSelectNode(otherId)}
                            className="text-primary underline cursor-pointer hover:text-primary/80 truncate"
                          >
                            {otherNode?.label ?? otherId}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onSelectNode(otherId)}
                            className="text-primary underline cursor-pointer hover:text-primary/80 truncate"
                          >
                            {otherNode?.label ?? otherId}
                          </button>
                          <ArrowRight size={10} className="text-muted-foreground" />
                          <span className="text-muted-foreground">{e.relation}</span>
                        </>
                      )}
                      {e.layer && (
                        <Badge variant="outline" className="text-[9px] ml-auto shrink-0">
                          {e.layer}
                        </Badge>
                      )}
                      {onDeleteEdge && (
                        <button
                          onClick={() => onDeleteEdge(e.source, e.target, e.relation)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity cursor-pointer shrink-0"
                          title="Remove edge"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {nodeEdges.length > 20 && (
                  <p className="text-[11px] text-muted-foreground">
                    +{nodeEdges.length - 20} more
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Add Relation */}
        {onCreateEdge && (
          <Card>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Plus size={12} />
                Add relation
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              {!addEdgeMode ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setAddEdgeMode(true)}
                >
                  <Plus size={12} className="mr-1.5" />
                  Add relation to this node...
                </Button>
              ) : (
                <div className="space-y-3">
                  {/* Target search */}
                  <input
                    type="text"
                    placeholder="Search target node..."
                    value={edgeSearch}
                    onChange={(e) => setEdgeSearch(e.target.value)}
                    className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    autoFocus
                  />

                  {/* Target list */}
                  <div className="max-h-32 overflow-y-auto border border-border rounded-md">
                    {allNodes
                      .filter(
                        (n) =>
                          n.id !== node.id &&
                          (n.label.toLowerCase().includes(edgeSearch.toLowerCase()) ||
                            n.id.toLowerCase().includes(edgeSearch.toLowerCase())),
                      )
                      .slice(0, 20)
                      .map((n) => (
                        <button
                          key={n.id}
                          onClick={() => setEdgeTargetId(n.id)}
                          className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-accent/50 cursor-pointer flex items-center justify-between ${
                            edgeTargetId === n.id ? "bg-accent text-accent-foreground" : ""
                          }`}
                        >
                          <span className="truncate">{n.label}</span>
                          <Badge variant="outline" className="text-[9px] ml-1.5 shrink-0">
                            {n.type}
                          </Badge>
                        </button>
                      ))}
                  </div>

                  {/* Relation type */}
                  {edgeTargetId && (
                    <select
                      value={edgeRelation}
                      onChange={(e) => setEdgeRelation(e.target.value)}
                      className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {RELATION_TYPES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 text-xs"
                      disabled={!edgeTargetId}
                      onClick={() => {
                        onCreateEdge(node.id, edgeTargetId, edgeRelation);
                        setAddEdgeMode(false);
                        setEdgeTargetId("");
                        setEdgeSearch("");
                        setEdgeRelation("related_to");
                      }}
                    >
                      <Plus size={12} className="mr-1" />
                      Add
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setAddEdgeMode(false);
                        setEdgeTargetId("");
                        setEdgeSearch("");
                        setEdgeRelation("related_to");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Copy JSON */}
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(node, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={12} className="mr-1.5" /> : <Copy size={12} className="mr-1.5" />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>

        {/* Merge */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Merge size={12} />
              Merge with another node
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {!mergeMode ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setMergeMode(true)}
              >
                <Merge size={12} className="mr-1.5" />
                Merge into this node...
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] text-muted-foreground">
                  Select a node to absorb into <strong>{node.label}</strong>. Its facts and edges will be merged, and it will be deleted.
                </p>

                {/* Search */}
                <input
                  type="text"
                  placeholder="Search nodes..."
                  value={mergeSearch}
                  onChange={(e) => setMergeSearch(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />

                {/* Node list */}
                <div className="max-h-32 overflow-y-auto border border-border rounded-md">
                  {filteredMergeTargets.slice(0, 20).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setMergeTarget(n.id)}
                      className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-accent/50 cursor-pointer flex items-center justify-between ${
                        mergeTarget === n.id ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      <span className="truncate">{n.label}</span>
                      <Badge variant="outline" className="text-[9px] ml-1.5 shrink-0">{n.type}</Badge>
                    </button>
                  ))}
                  {filteredMergeTargets.length === 0 && (
                    <p className="text-[13px] text-muted-foreground px-2.5 py-2">No matching nodes</p>
                  )}
                </div>

                {/* Alias field */}
                {mergeTarget && selectedTarget && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{selectedTarget.label}</span>
                      <ArrowRight size={12} />
                      <span className="font-medium text-foreground">{node.label}</span>
                    </div>
                    <input
                      type="text"
                      placeholder={`Alias (e.g. "${selectedTarget.label}")`}
                      value={mergeAlias}
                      onChange={(e) => setMergeAlias(e.target.value)}
                      className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 text-xs"
                    disabled={!mergeTarget}
                    onClick={() => {
                      onMerge(node.id, mergeTarget, mergeAlias || null);
                      setMergeMode(false);
                      setMergeTarget("");
                      setMergeSearch("");
                      setMergeAlias("");
                    }}
                  >
                    <Merge size={12} className="mr-1" />
                    Merge
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setMergeMode(false);
                      setMergeTarget("");
                      setMergeSearch("");
                      setMergeAlias("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Danger zone */}
        <div className="pt-2">
          {!confirmDelete ? (
            <Button
              variant="destructive"
              size="sm"
              className="w-full text-xs"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={12} className="mr-1.5" />
              Delete Node
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => {
                  onDeleteNode(node.id);
                  setConfirmDelete(false);
                }}
              >
                Confirm Delete
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
