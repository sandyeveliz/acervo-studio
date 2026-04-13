import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Trash2,
  X,
  Merge,
  ArrowRight,
  Copy,
  Check,
  Plus,
  Pencil,
  Bot,
  User,
  Cog,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Ban,
} from "lucide-react";
import type { GraphNode, GraphEdge, GraphSource, GraphFact } from "@/lib/api";

const RELATION_TYPES = [
  "related_to", "part_of", "contains", "created_by", "member_of",
  "located_in", "depends_on", "uses_technology", "alternative_to",
  "deployed_on", "produces", "serves", "documented_in",
  "participated_in", "triggered_by", "resulted_in",
  "sequel_of", "prequel_of", "shares_characters_with",
];

const NODE_TYPES = [
  "person", "place", "organization", "event", "concept", "topic",
  "technology", "project", "product", "skill",
];

const LAYERS = ["PERSONAL", "UNIVERSAL"];

// ── v0.6.1 helpers ──

const SOURCE_ICONS: Record<GraphSource, typeof Bot> = {
  llm: Bot,
  user: User,
  system: Cog,
};

const SOURCE_LABELS: Record<GraphSource, string> = {
  llm: "LLM",
  user: "User",
  system: "System",
};

function confidenceColorClass(c: number | undefined): string {
  if (c == null) return "text-muted-foreground";
  if (c >= 0.8) return "text-emerald-500";
  if (c >= 0.6) return "text-amber-500";
  return "text-red-500";
}

function confidenceBgClass(c: number | undefined): string {
  if (c == null) return "bg-muted";
  if (c >= 0.8) return "bg-emerald-500";
  if (c >= 0.6) return "bg-amber-500";
  return "bg-red-500";
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Stable identifier for a fact: prefer fact.id, fall back to the fact text. */
function factKey(f: GraphFact): string {
  return f.id ?? f.fact;
}

interface NodeDetailPanelProps {
  node: GraphNode | null;
  allNodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteFact: (nodeId: string, fact: string) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onCreateEdge?: (source: string, target: string, relation: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onUpdateNode?: (nodeId: string, data: { label?: string; type?: string; description?: string; layer?: string }) => void;
  onEditEdge?: (edgeId: string, currentRelation: string) => void;
  editMode?: boolean;
  onSetEditMode?: (editing: boolean) => void;
  // v0.6.1
  onConfirmNode?: (nodeId: string) => void;
  onDeduplicateFacts?: (nodeIds: string[]) => void;
  onClearDedupFlag?: (nodeId: string, factId: string) => void;
}

export function NodeDetailPanel({
  node,
  allNodes,
  edges,
  onClose,
  onDeleteNode,
  onDeleteFact,
  onMerge,
  onSelectNode,
  onCreateEdge,
  onDeleteEdge,
  onUpdateNode,
  onEditEdge,
  editMode = false,
  onSetEditMode,
  onConfirmNode,
  onDeduplicateFacts,
  onClearDedupFlag,
}: NodeDetailPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [mergeSearch, setMergeSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [addEdgeMode, setAddEdgeMode] = useState(false);
  const [edgeSearch, setEdgeSearch] = useState("");
  const [edgeTargetId, setEdgeTargetId] = useState("");
  const [edgeRelation, setEdgeRelation] = useState("related_to");

  // Inline edit state
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLayer, setEditLayer] = useState("");

  const startEdit = () => {
    if (!node) return;
    setEditLabel(node.label);
    setEditType(node.type);
    setEditDescription(node.description ?? "");
    setEditLayer(node.layer ?? "");
    onSetEditMode?.(true);
  };

  const cancelEdit = () => {
    onSetEditMode?.(false);
  };

  const saveEdit = () => {
    if (!node || !onUpdateNode) return;
    onUpdateNode(node.id, {
      label: editLabel.trim() || undefined,
      type: editType || undefined,
      description: editDescription.trim() || undefined,
      layer: editLayer || undefined,
    });
    onSetEditMode?.(false);
  };

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
          <div className="flex-1 min-w-0">
            {editMode ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-sm font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <select
                    value={NODE_TYPES.includes(editType) ? editType : "__custom"}
                    onChange={(e) => setEditType(e.target.value)}
                    className="rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {NODE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="__custom">Custom...</option>
                  </select>
                  <select
                    value={editLayer}
                    onChange={(e) => setEditLayer(e.target.value)}
                    className="rounded-md border border-input bg-secondary/50 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">No layer</option>
                    {LAYERS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-medium truncate">{node.label}</h3>
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-[12px]">{node.type}</Badge>
                  {node.layer && <Badge variant="secondary" className="text-[12px]">{node.layer}</Badge>}
                  {node.source && (() => {
                    const SourceIcon = SOURCE_ICONS[node.source];
                    return (
                      <Badge variant="outline" className="text-[12px] gap-1">
                        <SourceIcon size={10} />
                        {SOURCE_LABELS[node.source]}
                      </Badge>
                    );
                  })()}
                  {node.confidence != null && (
                    <Badge
                      variant="outline"
                      className={`text-[12px] ${confidenceColorClass(node.confidence)}`}
                    >
                      {Math.round(node.confidence * 100)}%
                    </Badge>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-1 shrink-0 ml-2">
            {editMode ? (
              <>
                <Button variant="ghost" size="sm" onClick={saveEdit} className="h-7 px-2 text-xs">
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelEdit} className="h-7 px-2 text-xs">
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {onUpdateNode && (
                  <Button variant="ghost" size="sm" onClick={startEdit} className="h-7 w-7 p-0">
                    <Pencil size={14} />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
                  <X size={14} />
                </Button>
              </>
            )}
          </div>
        </div>

        <Separator />

        {/* Pending review banner */}
        {node.status === "pending_review" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-xs">
            <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            <span className="flex-1">
              Pending review
              {node.confidence != null && ` · confidence ${Math.round(node.confidence * 100)}%`}
            </span>
            {onConfirmNode && (
              <Button
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => onConfirmNode(node.id)}
              >
                <Check size={11} className="mr-1" />
                Confirm
              </Button>
            )}
          </div>
        )}

        {/* Description (edit mode or display) */}
        {editMode ? (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Node description..."
              rows={2}
              className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>
        ) : (
          node.description && (
            <p className="text-xs text-muted-foreground">{node.description}</p>
          )
        )}

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

        {/* Provenance (v0.6.1) */}
        {(node.source || node.confidence != null || node.updated_by || node.status) && (
          <Card>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">Provenance</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="grid grid-cols-2 gap-y-1.5 text-xs items-center">
                {node.source && (() => {
                  const SourceIcon = SOURCE_ICONS[node.source];
                  return (
                    <>
                      <span className="text-muted-foreground">Source</span>
                      <span className="flex items-center gap-1.5">
                        <SourceIcon size={11} />
                        {SOURCE_LABELS[node.source]}
                      </span>
                    </>
                  );
                })()}
                {node.confidence != null && (
                  <>
                    <span className="text-muted-foreground">Confidence</span>
                    <span className="flex items-center gap-1.5">
                      <span className={confidenceColorClass(node.confidence)}>
                        {Math.round(node.confidence * 100)}%
                      </span>
                      <span className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-[60px]">
                        <span
                          className={`block h-full ${confidenceBgClass(node.confidence)}`}
                          style={{ width: `${Math.round(node.confidence * 100)}%` }}
                        />
                      </span>
                    </span>
                  </>
                )}
                {node.updated_by && (
                  <>
                    <span className="text-muted-foreground">Last edited</span>
                    <span className="flex items-center gap-1.5">
                      {(() => {
                        const Icon = SOURCE_ICONS[node.updated_by] ?? Bot;
                        return <Icon size={11} />;
                      })()}
                      <span>
                        {SOURCE_LABELS[node.updated_by] ?? node.updated_by}
                        {node.updated_at && ` · ${formatRelativeTime(node.updated_at)}`}
                      </span>
                    </span>
                  </>
                )}
                {node.status && (
                  <>
                    <span className="text-muted-foreground">Status</span>
                    <span className="flex items-center gap-1.5">
                      {node.status === "pending_review" ? (
                        <>
                          <AlertTriangle size={11} className="text-amber-500" />
                          <span className="text-amber-500">Pending review</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={11} className="text-emerald-500" />
                          <span>Confirmed</span>
                        </>
                      )}
                    </span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Facts */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Facts ({node.facts?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            {(node.facts ?? []).map((f, i) => {
              const expired = f.expired_at && new Date(f.expired_at).getTime() < Date.now();
              const flagged = f.dedup_status === "flagged" || f.dedup_status === "duplicate";
              const SourceIcon = f.source ? SOURCE_ICONS[f.source] : null;
              return (
                <div key={f.id ?? i} className="group space-y-0.5">
                  <div className="flex items-start gap-2">
                    {f.confidence != null && (
                      <span
                        className={`mt-1 inline-block w-1 h-3 rounded-full shrink-0 ${confidenceBgClass(f.confidence)}`}
                        title={`confidence ${Math.round(f.confidence * 100)}%`}
                      />
                    )}
                    <p
                      className={`text-xs flex-1 ${expired ? "line-through text-muted-foreground" : ""}`}
                    >
                      {f.fact}
                    </p>
                    {SourceIcon && (
                      <SourceIcon
                        size={11}
                        className="text-muted-foreground shrink-0 mt-0.5"
                      />
                    )}
                    {expired && (
                      <Ban size={11} className="text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    {!flagged && (
                      <button
                        onClick={() => onDeleteFact(node.id, f.fact)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity cursor-pointer mt-0.5"
                        title="Remove fact"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  {/* Validity dates */}
                  {(f.valid_at || f.invalid_at || f.expired_at) && (
                    <p className="text-[10px] italic text-muted-foreground pl-3">
                      {f.expired_at ? (
                        <>expired {new Date(f.expired_at).toLocaleDateString()}</>
                      ) : (
                        <>
                          {f.valid_at && <>valid from {new Date(f.valid_at).toLocaleDateString()}</>}
                          {f.valid_at && f.invalid_at && " "}
                          {f.invalid_at && <>→ {new Date(f.invalid_at).toLocaleDateString()}</>}
                        </>
                      )}
                    </p>
                  )}

                  {/* Duplicate flag actions */}
                  {flagged && (
                    <div className="flex items-center gap-1.5 pl-3">
                      <Badge
                        variant="outline"
                        className="text-[9px] border-amber-500/40 text-amber-500"
                      >
                        possible duplicate
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() => onClearDedupFlag?.(node.id, factKey(f))}
                      >
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 px-1.5 text-[10px] text-destructive"
                        onClick={() => onDeleteFact(node.id, f.fact)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {(!node.facts || node.facts.length === 0) && (
              <p className="text-xs text-muted-foreground">No facts recorded</p>
            )}
            {onDeduplicateFacts && node.facts && node.facts.length > 0 && (
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-[11px] h-7"
                  onClick={() => onDeduplicateFacts([node.id])}
                >
                  <RefreshCw size={11} className="mr-1.5" />
                  Check duplicates
                </Button>
              </div>
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
                {nodeEdges.slice(0, 20).map((e) => {
                  const isSource = e.source === node.id;
                  const otherId = isSource ? e.target : e.source;
                  const otherNode = allNodes.find((n) => n.id === otherId);
                  const isPending = e.status === "pending_review";
                  return (
                    <div
                      key={e.id}
                      className={`flex items-center gap-1.5 text-xs group ${
                        isPending ? "px-1 py-0.5 -mx-1 rounded border border-amber-500/40 bg-amber-500/5" : ""
                      }`}
                      title={
                        e.confidence != null
                          ? `confidence ${Math.round(e.confidence * 100)}%`
                          : undefined
                      }
                    >
                      {isPending && (
                        <AlertTriangle size={10} className="text-amber-500 shrink-0" />
                      )}
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
                      <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0 ml-auto transition-opacity">
                        {onEditEdge && (
                          <button
                            onClick={() => onEditEdge(e.id, e.relation)}
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Edit relation"
                          >
                            <Pencil size={10} />
                          </button>
                        )}
                        {onDeleteEdge && (
                          <button
                            onClick={() => onDeleteEdge(e.id)}
                            className="text-muted-foreground hover:text-destructive cursor-pointer"
                            title="Remove edge"
                          >
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
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
                  <input
                    type="text"
                    placeholder="Search target node..."
                    value={edgeSearch}
                    onChange={(e) => setEdgeSearch(e.target.value)}
                    className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    autoFocus
                  />

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

                <input
                  type="text"
                  placeholder="Search nodes..."
                  value={mergeSearch}
                  onChange={(e) => setMergeSearch(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  autoFocus
                />

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

                {mergeTarget && selectedTarget && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{selectedTarget.label}</span>
                    <ArrowRight size={12} />
                    <span className="font-medium text-foreground">{node.label}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 text-xs"
                    disabled={!mergeTarget}
                    onClick={() => {
                      onMerge(node.id, mergeTarget);
                      setMergeMode(false);
                      setMergeTarget("");
                      setMergeSearch("");
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
