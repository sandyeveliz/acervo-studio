import { useState, useEffect, useCallback } from "react";
import { Network } from "lucide-react";
import { graphApi, type GraphNode, type GraphEdge, type GraphStats } from "@/lib/api";
import { GraphViewer } from "@/components/graph/GraphViewer";
import { NodeDetailPanel } from "@/components/graph/NodeDetailPanel";
import { GraphToolbar } from "@/components/graph/GraphToolbar";

export function GraphPage() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [nodesRes, edgesRes, statsRes] = await Promise.all([
        graphApi.getNodes(),
        graphApi.getEdges(),
        graphApi.getStats(),
      ]);
      setNodes(nodesRes.nodes);
      setEdges(edgesRes.edges);
      setStats(statsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Load full node detail when selected
  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNode(null);
      return;
    }
    graphApi.getNode(selectedNodeId).then(setSelectedNode).catch(() => setSelectedNode(null));
  }, [selectedNodeId]);

  const handleDeleteNode = async (nodeId: string) => {
    await graphApi.deleteNode(nodeId);
    setSelectedNodeId(null);
    loadGraph();
  };

  const handleDeleteFact = async (nodeId: string, fact: string) => {
    await graphApi.deleteFact(nodeId, fact);
    // Reload node detail
    const updated = await graphApi.getNode(nodeId);
    setSelectedNode(updated);
  };

  const handleMerge = async (keepId: string, absorbId: string, alias: string | null) => {
    await graphApi.mergeNodes(keepId, absorbId, alias ?? undefined);
    setSelectedNodeId(keepId);
    loadGraph();
  };

  const handleExport = async () => {
    const data = await graphApi.exportGraph();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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

  // Filter nodes by search
  const filteredNodes = searchQuery
    ? nodes.filter((n) =>
        n.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.type.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : nodes;

  // Filter edges to only include visible nodes
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = searchQuery
    ? edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
    : edges;

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
        <button onClick={loadGraph} className="text-xs underline cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Network size={48} strokeWidth={1.5} />
        <h2 className="text-lg font-medium text-foreground">Knowledge Graph</h2>
        <p className="text-sm">No nodes in the graph yet. Start chatting to build knowledge.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <GraphToolbar
        stats={stats}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onExport={handleExport}
        onImport={handleImport}
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <GraphViewer
            nodes={filteredNodes}
            edges={filteredEdges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </div>
        <div className="w-80 border-l border-border">
          <NodeDetailPanel
            node={selectedNode}
            allNodes={nodes}
            onClose={() => setSelectedNodeId(null)}
            onDeleteNode={handleDeleteNode}
            onDeleteFact={handleDeleteFact}
            onMerge={handleMerge}
          />
        </div>
      </div>
    </div>
  );
}
