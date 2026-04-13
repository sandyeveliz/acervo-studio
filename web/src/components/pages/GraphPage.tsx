import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Network } from "lucide-react";
import {
  graphApi,
  type GraphNode,
  type GraphEdge,
  type GraphStats,
  type GraphAnalysis,
  type GraphSource,
  type GraphStatus,
  type ValidationLogEntry,
} from "@/lib/api";
import { GraphViewer } from "@/components/graph/GraphViewer";
import { NodeDetailPanel } from "@/components/graph/NodeDetailPanel";
import { GraphToolbar } from "@/components/graph/GraphToolbar";
import { GraphStatsBar } from "@/components/graph/GraphStatsBar";
import { QualityIssuesPanel } from "@/components/graph/QualityIssuesPanel";
import { ExtractionLog } from "@/components/graph/ExtractionLog";
import { GraphContextMenu } from "@/components/graph/GraphContextMenu";
import { ValidationPanel } from "@/components/graph/ValidationPanel";
import { OrphansPanel } from "@/components/graph/OrphansPanel";
import { StatsPanel } from "@/components/graph/StatsPanel";
import { CreateNodeDialog } from "@/components/graph/CreateNodeDialog";
import { EditEdgeDialog } from "@/components/graph/EditEdgeDialog";
import { ReviewQueuePanel } from "@/components/graph/ReviewQueuePanel";
import { GraphLegend } from "@/components/graph/GraphLegend";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useGraphEvents } from "@/hooks/useGraphEvents";

export function GraphPage() {
  // Core graph data
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [analysis, setAnalysis] = useState<GraphAnalysis | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<GraphSource | null>(null);
  const [statusFilter, setStatusFilter] = useState<GraphStatus | null>(null);

  // v0.6.1 UI toggles + transient banner for dedup feedback
  const [showLegend, setShowLegend] = useState(false);
  const [dedupBanner, setDedupBanner] = useState<string | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    type: "node" | "edge";
    targetId: string;
    x: number;
    y: number;
  } | null>(null);

  // Orphans & validation
  const [orphans, setOrphans] = useState<GraphNode[]>([]);
  const [orphansUnavailable, setOrphansUnavailable] = useState(false);
  const [validationLog, setValidationLog] = useState<ValidationLogEntry[]>([]);
  const [validationUnavailable, setValidationUnavailable] = useState(false);

  // Dialogs
  const [createNodeOpen, setCreateNodeOpen] = useState(false);
  const [editEdge, setEditEdge] = useState<{
    edgeId: string;
    relation: string;
    sourceLabel: string;
    targetLabel: string;
  } | null>(null);

  // Merge flow state
  const [mergeSource, setMergeSource] = useState<string | null>(null);

  // Edit mode (skip auto-refresh while editing)
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);
  editModeRef.current = editMode;

  // ── Data loading ──

  const loadGraph = useCallback(async () => {
    // Skip if user is editing a node
    if (editModeRef.current) return;

    try {
      setLoading(true);
      setError(null);
      const [nodesRes, edgesRes, statsRes, orphansRes, validationRes, analysisRes] =
        await Promise.all([
          graphApi.getNodes(),
          graphApi.getEdges(),
          graphApi.getStats(),
          graphApi.getOrphans().catch(() => null),
          graphApi.getValidationLog().catch(() => null),
          graphApi.getAnalysis().catch(() => null),
        ]);
      setNodes(nodesRes.nodes);
      setEdges(edgesRes.edges);
      setStats(statsRes);

      if (orphansRes) {
        setOrphans(orphansRes.nodes);
        setOrphansUnavailable(false);
      } else {
        setOrphansUnavailable(true);
      }

      if (validationRes) {
        setValidationLog(validationRes.entries);
        setValidationUnavailable(false);
      } else {
        setValidationUnavailable(true);
      }

      setAnalysis(analysisRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Real-time: refresh when WebSocket signals graph changes
  useGraphEvents(loadGraph);

  // Load full node detail when selected
  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNode(null);
      return;
    }
    graphApi
      .getNode(selectedNodeId)
      .then(setSelectedNode)
      .catch(() => setSelectedNode(null));
  }, [selectedNodeId]);

  // ── Handlers ──

  const handleDeleteNode = async (nodeId: string) => {
    await graphApi.deleteNode(nodeId);
    setSelectedNodeId(null);
    setContextMenu(null);
    loadGraph();
  };

  const handleDeleteFact = async (nodeId: string, fact: string) => {
    await graphApi.deleteFact(nodeId, fact);
    const updated = await graphApi.getNode(nodeId);
    setSelectedNode(updated);
  };

  const handleMerge = async (sourceId: string, targetId: string) => {
    await graphApi.mergeNodes(sourceId, targetId);
    setSelectedNodeId(sourceId);
    setMergeSource(null);
    loadGraph();
  };

  const handleCreateEdge = async (source: string, target: string, relation: string) => {
    try {
      await graphApi.createEdge({ source, target, relation });
      loadGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create edge");
    }
  };

  const handleDeleteEdge = async (edgeId: string) => {
    try {
      await graphApi.deleteEdge(edgeId);
      loadGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete edge");
    }
  };

  const handleUpdateNode = async (
    nodeId: string,
    data: { label?: string; type?: string; description?: string; layer?: string },
  ) => {
    try {
      const updated = await graphApi.updateNode(nodeId, data);
      setSelectedNode(updated);
      loadGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update node");
    }
  };

  const handleUpdateEdge = async (edgeId: string, newRelation: string) => {
    try {
      await graphApi.updateEdge(edgeId, { relation: newRelation });
      setEditEdge(null);
      loadGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update edge");
    }
  };

  // ── v0.6.1 handlers ──

  const handleConfirmNode = async (nodeId: string) => {
    try {
      const updated = await graphApi.confirmNode(nodeId);
      setSelectedNode(updated);
      loadGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm node");
    }
  };

  const handleConfirmEdge = async (edgeId: string) => {
    try {
      await graphApi.confirmEdge(edgeId);
      loadGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm edge");
    }
  };

  const handleDeduplicateFacts = async (nodeIds?: string[]) => {
    try {
      const result = await graphApi.deduplicateFacts(
        nodeIds && nodeIds.length > 0 ? { node_ids: nodeIds } : {},
      );
      const scope = nodeIds && nodeIds.length > 0 ? "node" : "graph";
      setDedupBanner(
        `Dedup ${scope}: checked ${result.checked}, removed ${result.removed}, flagged ${result.flagged}`,
      );
      setTimeout(() => setDedupBanner(null), 5000);
      loadGraph();
      // If the dedup was scoped to a node, refresh that node's detail too
      if (nodeIds?.length === 1 && selectedNodeId === nodeIds[0]) {
        const updated = await graphApi.getNode(nodeIds[0]);
        setSelectedNode(updated);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deduplicate facts");
    }
  };

  const handleClearDedupFlag = async (nodeId: string, factId: string) => {
    try {
      const updated = await graphApi.clearDedupFlag(nodeId, factId);
      setSelectedNode(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear dedup flag");
    }
  };

  const handleCreateNode = async (data: {
    label: string;
    type: string;
    description?: string;
    layer?: string;
    facts?: { fact: string; source?: string }[];
  }) => {
    await graphApi.createNode(data);
    loadGraph();
  };

  const handleExport = async () => {
    const data = await graphApi.exportGraph();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `graph-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (jsonStr: string) => {
    try {
      const data = JSON.parse(jsonStr);
      await graphApi.importGraph(data);
      loadGraph();
    } catch {
      setError("Invalid JSON file");
    }
  };

  const handleExportTraining = async () => {
    try {
      const blob = await graphApi.exportTraining();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `training-export-${new Date().toISOString().slice(0, 10)}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export training data");
    }
  };

  // Validation actions
  const handleApproveValidation = async (entryId: string) => {
    try {
      await graphApi.approveValidation(entryId);
      setValidationLog((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, action: "approved" as const } : e)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    }
  };

  const handleCorrectValidation = async (
    entryId: string,
    correctedType: string,
    correctedRelation?: string,
  ) => {
    try {
      await graphApi.correctValidation(entryId, {
        corrected_type: correctedType,
        corrected_relation: correctedRelation,
      });
      setValidationLog((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { ...e, action: "corrected" as const, corrected_type: correctedType, corrected_relation: correctedRelation }
            : e,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to correct");
    }
  };

  const handleDiscardValidation = async (entryId: string) => {
    try {
      await graphApi.discardValidation(entryId);
      setValidationLog((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, action: "discarded" as const } : e)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to discard");
    }
  };

  // Context menu handlers
  const handleRightClickNode = useCallback((nodeId: string, x: number, y: number) => {
    setContextMenu({ type: "node", targetId: nodeId, x, y });
  }, []);

  const handleRightClickEdge = useCallback((edgeId: string, x: number, y: number) => {
    setContextMenu({ type: "edge", targetId: edgeId, x, y });
  }, []);

  // Node click — in merge mode, complete merge. Otherwise, select.
  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      setContextMenu(null);

      if (mergeSource && nodeId && nodeId !== mergeSource) {
        // Complete merge
        handleMerge(mergeSource, nodeId);
        return;
      }

      setSelectedNodeId(nodeId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mergeSource],
  );

  // Context menu → edit node: select it and enable edit mode
  const handleContextEditNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setEditMode(true);
  };

  // Context menu / detail panel → edit edge: open EditEdgeDialog
  const handleContextEditEdge = (edgeId: string, _currentRelation?: string) => {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    setEditEdge({
      edgeId,
      relation: edge.relation,
      sourceLabel: sourceNode?.label ?? edge.source,
      targetLabel: targetNode?.label ?? edge.target,
    });
  };

  // Context menu → mark for merge
  const handleMarkForMerge = (nodeId: string) => {
    setMergeSource(nodeId);
  };

  // Extraction log node click
  const handleLogNodeClick = (label: string) => {
    const match = nodes.find(
      (n) => n.label.toLowerCase() === label.toLowerCase(),
    );
    if (match) setSelectedNodeId(match.id);
  };

  // ── Derived data ──

  // Filtered nodes for search
  const filteredNodes = useMemo(() => {
    if (!searchQuery) return nodes;
    return nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.type.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [nodes, searchQuery]);

  // Filtered edges to match visible nodes
  const filteredEdges = useMemo(() => {
    if (!searchQuery) return edges;
    const visibleIds = new Set(filteredNodes.map((n) => n.id));
    return edges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );
  }, [edges, filteredNodes, searchQuery]);

  // Available types and layers for filter dropdowns
  const availableTypes = useMemo(
    () => [...new Set(nodes.map((n) => n.type))].sort(),
    [nodes],
  );
  const availableLayers = useMemo(
    () => [...new Set(nodes.map((n) => n.layer).filter(Boolean) as string[])].sort(),
    [nodes],
  );

  // Pending validation count
  const pendingValidations = validationLog.filter((e) => !e.action).length;

  // v0.6.1 review queue count (nodes + edges with status === pending_review)
  const pendingReviewCount = useMemo(() => {
    const n = nodes.filter((x) => x.status === "pending_review").length;
    const e = edges.filter((x) => x.status === "pending_review").length;
    return n + e;
  }, [nodes, edges]);

  // Merge source node label
  const mergeSourceNode = mergeSource ? nodes.find((n) => n.id === mergeSource) : null;

  // ── Render ──

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Network size={48} strokeWidth={1.5} className="animate-pulse" />
        <p className="text-sm">Loading graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Network size={48} strokeWidth={1.5} />
        <p className="text-sm text-destructive-foreground">{error}</p>
        <button
          onClick={loadGraph}
          className="text-xs underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const isEmpty = nodes.length === 0;

  return (
    <div className="flex flex-col h-full">
      <GraphToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onExport={handleExport}
        onImport={handleImport}
        onRefresh={loadGraph}
        onExportTraining={handleExportTraining}
        onCreateNode={() => setCreateNodeOpen(true)}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        layerFilter={layerFilter}
        onLayerFilterChange={setLayerFilter}
        availableTypes={availableTypes}
        availableLayers={availableLayers}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        showLegend={showLegend}
        onToggleLegend={() => setShowLegend((s) => !s)}
        onDedupGlobal={() => handleDeduplicateFacts()}
      />
      {stats && <GraphStatsBar stats={stats} nodes={nodes} edges={edges} />}

      <div className="flex flex-1 min-h-0">
        {/* Left panel: graph canvas + bottom analysis tabs */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
            {/* Merge mode banner */}
            {mergeSource && mergeSourceNode && (
              <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center gap-3 bg-amber-500/90 text-white px-4 py-2 text-xs font-medium">
                <span>
                  Select second node to merge with <strong>{mergeSourceNode.label}</strong>
                </span>
                <button
                  onClick={() => setMergeSource(null)}
                  className="underline cursor-pointer hover:opacity-80"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Dedup result banner (transient) */}
            {dedupBanner && (
              <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center gap-3 bg-emerald-600/90 text-white px-4 py-2 text-xs font-medium">
                <span>{dedupBanner}</span>
                <button
                  onClick={() => setDedupBanner(null)}
                  className="underline cursor-pointer hover:opacity-80"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* v0.6.1 floating legend */}
            <GraphLegend visible={showLegend} />

            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                <Network size={48} strokeWidth={1.5} />
                <h2 className="text-lg font-medium text-foreground">Knowledge Graph</h2>
                <p className="text-sm">No nodes yet. Start chatting or create one manually.</p>
              </div>
            ) : (
              <GraphViewer
                nodes={filteredNodes}
                edges={filteredEdges}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelectNode}
                onRightClickNode={handleRightClickNode}
                onRightClickEdge={handleRightClickEdge}
                typeFilter={typeFilter}
                layerFilter={layerFilter}
                sourceFilter={sourceFilter}
                statusFilter={statusFilter}
                mergeSourceId={mergeSource}
              />
            )}
          </div>

          {/* Bottom tabs */}
          <div className="border-t border-border">
            <Tabs defaultValue="issues" className="w-full">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent h-8 px-3">
                {analysis && (
                  <TabsTrigger value="issues" className="text-xs h-7">
                    Issues ({analysis.issues.length})
                  </TabsTrigger>
                )}
                {analysis && (
                  <TabsTrigger value="log" className="text-xs h-7">
                    Extraction Log ({analysis.extraction_log.length})
                  </TabsTrigger>
                )}
                <TabsTrigger value="review" className="text-xs h-7">
                  Review
                  {pendingReviewCount > 0 && (
                    <Badge variant="destructive" className="ml-1.5 text-[9px] px-1 py-0 h-4">
                      {pendingReviewCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="validation" className="text-xs h-7">
                  Validation
                  {pendingValidations > 0 && (
                    <Badge variant="destructive" className="ml-1.5 text-[9px] px-1 py-0 h-4">
                      {pendingValidations}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="orphans" className="text-xs h-7">
                  Orphans
                  {orphans.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-[9px] px-1 py-0 h-4">
                      {orphans.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="stats" className="text-xs h-7">
                  Stats
                </TabsTrigger>
              </TabsList>

              {analysis && (
                <TabsContent value="issues" className="p-2 mt-0">
                  <QualityIssuesPanel
                    issues={analysis.issues}
                    onSelectNode={setSelectedNodeId}
                    onMerge={handleMerge}
                    onDeleteNode={handleDeleteNode}
                  />
                </TabsContent>
              )}
              {analysis && (
                <TabsContent value="log" className="p-2 mt-0">
                  <ExtractionLog
                    events={analysis.extraction_log}
                    onSelectNode={handleLogNodeClick}
                  />
                </TabsContent>
              )}
              <TabsContent value="review" className="mt-0">
                <ReviewQueuePanel
                  nodes={nodes}
                  edges={edges}
                  onSelectNode={setSelectedNodeId}
                  onConfirmNode={handleConfirmNode}
                  onConfirmEdge={handleConfirmEdge}
                  onDeleteNode={handleDeleteNode}
                  onDeleteEdge={handleDeleteEdge}
                />
              </TabsContent>
              <TabsContent value="validation" className="mt-0">
                <ValidationPanel
                  entries={validationLog}
                  unavailable={validationUnavailable}
                  onApprove={handleApproveValidation}
                  onCorrect={handleCorrectValidation}
                  onDiscard={handleDiscardValidation}
                />
              </TabsContent>
              <TabsContent value="orphans" className="mt-0">
                <OrphansPanel
                  orphans={orphans}
                  allNodes={nodes}
                  unavailable={orphansUnavailable}
                  onSelectNode={setSelectedNodeId}
                  onCreateEdge={handleCreateEdge}
                  onDeleteNode={handleDeleteNode}
                  onMerge={handleMerge}
                />
              </TabsContent>
              <TabsContent value="stats" className="mt-0">
                <StatsPanel stats={stats} nodes={nodes} />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Right panel: node detail */}
        <div className="w-80 border-l border-border">
          <NodeDetailPanel
            node={selectedNode}
            allNodes={nodes}
            edges={edges}
            onClose={() => setSelectedNodeId(null)}
            onDeleteNode={handleDeleteNode}
            onDeleteFact={handleDeleteFact}
            onMerge={handleMerge}
            onSelectNode={setSelectedNodeId}
            onCreateEdge={handleCreateEdge}
            onDeleteEdge={handleDeleteEdge}
            onUpdateNode={handleUpdateNode}
            onEditEdge={handleContextEditEdge}
            editMode={editMode}
            onSetEditMode={setEditMode}
            onConfirmNode={handleConfirmNode}
            onDeduplicateFacts={handleDeduplicateFacts}
            onClearDedupFlag={handleClearDedupFlag}
          />
        </div>
      </div>

      {/* Context menu overlay */}
      {contextMenu && (
        <GraphContextMenu
          type={contextMenu.type}
          targetId={contextMenu.targetId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onEditNode={handleContextEditNode}
          onDeleteNode={handleDeleteNode}
          onMarkForMerge={handleMarkForMerge}
          onEditEdge={handleContextEditEdge}
          onDeleteEdge={handleDeleteEdge}
        />
      )}

      {/* Create node dialog */}
      <CreateNodeDialog
        open={createNodeOpen}
        onClose={() => setCreateNodeOpen(false)}
        onCreateNode={handleCreateNode}
      />

      {/* Edit edge dialog */}
      {editEdge && (() => {
        const fullEdge = edges.find((e) => e.id === editEdge.edgeId);
        return (
          <EditEdgeDialog
            open={true}
            edgeId={editEdge.edgeId}
            currentRelation={editEdge.relation}
            sourceLabel={editEdge.sourceLabel}
            targetLabel={editEdge.targetLabel}
            onClose={() => setEditEdge(null)}
            onSave={handleUpdateEdge}
            confidence={fullEdge?.confidence}
            edgeSource={fullEdge?.source_type}
            status={fullEdge?.status}
            onConfirm={handleConfirmEdge}
          />
        );
      })()}
    </div>
  );
}
