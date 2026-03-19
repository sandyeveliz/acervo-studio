import { useEffect, useRef, useCallback } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphNode, GraphEdge } from "@/lib/api";

const TYPE_COLORS: Record<string, string> = {
  person: "#60a5fa",      // blue
  persona: "#60a5fa",
  place: "#34d399",       // emerald
  lugar: "#34d399",
  organization: "#fbbf24", // amber
  organizacion: "#fbbf24",
  event: "#f87171",       // red
  evento: "#f87171",
  concept: "#a78bfa",     // violet
  concepto: "#a78bfa",
  topic: "#fb923c",       // orange
  tema: "#fb923c",
};

const DEFAULT_COLOR = "#94a3b8"; // slate

function getNodeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? DEFAULT_COLOR;
}

interface GraphViewerProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

export function GraphViewer({ nodes, edges, selectedNodeId, onSelectNode }: GraphViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);

  // Build graph from data
  const buildGraph = useCallback(() => {
    const graph = new Graph({ multi: true });

    for (const node of nodes) {
      const factCount = node.facts?.length ?? 0;
      graph.addNode(node.id, {
        label: node.label,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.max(6, Math.min(20, 6 + factCount * 2)),
        color: getNodeColor(node.type),
        nodeType: node.type,
      });
    }

    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        const key = `${edge.source}-${edge.target}-${edge.relation}`;
        if (!graph.hasEdge(key)) {
          try {
            graph.addEdgeWithKey(key, edge.source, edge.target, {
              label: edge.relation,
              size: Math.max(1, (edge.weight ?? 1) * 1.5),
              color: "rgba(148, 163, 184, 0.3)",
            });
          } catch {
            // skip duplicate edges
          }
        }
      }
    }

    // Apply force layout
    if (graph.order > 0) {
      forceAtlas2.assign(graph, {
        iterations: 100,
        settings: {
          gravity: 1,
          scalingRatio: 10,
          barnesHutOptimize: graph.order > 50,
        },
      });
    }

    return graph;
  }, [nodes, edges]);

  // Initialize sigma
  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    const graph = buildGraph();
    graphRef.current = graph;

    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelRenderedSizeThreshold: 8,
      labelColor: { color: "#e2e8f0" },
      labelFont: "Geist Variable, sans-serif",
      labelSize: 12,
      defaultEdgeType: "line",
      defaultNodeColor: DEFAULT_COLOR,
      defaultEdgeColor: "rgba(148, 163, 184, 0.3)",
    });

    // Click handler
    sigma.on("clickNode", ({ node }) => {
      onSelectNode(node);
    });

    sigma.on("clickStage", () => {
      onSelectNode(null);
    });

    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [buildGraph, nodes.length, onSelectNode]);

  // Highlight selected node's neighbors
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    sigma.setSetting("nodeReducer", (node, data) => {
      if (!selectedNodeId) return data;
      if (node === selectedNodeId) {
        return { ...data, highlighted: true, zIndex: 1 };
      }
      const isNeighbor = graph.hasEdge(selectedNodeId, node) || graph.hasEdge(node, selectedNodeId);
      if (!isNeighbor) {
        return { ...data, color: "rgba(148, 163, 184, 0.15)", label: "" };
      }
      return data;
    });

    sigma.setSetting("edgeReducer", (edge, data) => {
      if (!selectedNodeId) return data;
      const src = graph.source(edge);
      const tgt = graph.target(edge);
      if (src === selectedNodeId || tgt === selectedNodeId) {
        return { ...data, color: "rgba(148, 163, 184, 0.6)", size: 2 };
      }
      return { ...data, hidden: true };
    });

    sigma.refresh();
  }, [selectedNodeId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-background"
      style={{ minHeight: "400px" }}
    />
  );
}
