import { useEffect, useRef, useCallback } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphNode, GraphEdge, GraphSource, GraphStatus } from "@/lib/api";

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

export { TYPE_COLORS };

const DEFAULT_COLOR = "#94a3b8"; // slate

// v0.6.1 visual conventions for source/status decorators.
export const SOURCE_BORDER_COLORS: Record<GraphSource, string | null> = {
  llm: null,           // no border — implicit default
  user: "#d4af37",     // gold
  system: "#94a3b8",   // gray
};

// Edge color override per source (until edge dash patterns land in Phase 2).
export const SOURCE_EDGE_COLORS: Record<GraphSource, string> = {
  llm: "rgba(148, 163, 184, 0.3)",
  user: "rgba(212, 175, 55, 0.55)",
  system: "rgba(148, 163, 184, 0.45)",
};

export const STATUS_RING_COLOR = "#f59e0b"; // amber for pending_review

export function getNodeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? DEFAULT_COLOR;
}

/** Map a hex color to rgba with the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Opacity floor 0.4 so low-confidence nodes don't disappear entirely. */
function confidenceToOpacity(confidence: number | undefined): number {
  if (confidence == null) return 1;
  return 0.4 + Math.max(0, Math.min(1, confidence)) * 0.6;
}

interface GraphViewerProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onRightClickNode?: (nodeId: string, x: number, y: number) => void;
  onRightClickEdge?: (edgeId: string, x: number, y: number) => void;
  typeFilter?: string | null;
  layerFilter?: string | null;
  sourceFilter?: GraphSource | null;
  statusFilter?: GraphStatus | null;
  mergeSourceId?: string | null;
}

export function GraphViewer({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onRightClickNode,
  onRightClickEdge,
  typeFilter,
  layerFilter,
  sourceFilter,
  statusFilter,
  mergeSourceId,
}: GraphViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);

  // Filter nodes by type, layer, source, and status
  const filteredNodes = nodes.filter((n) => {
    if (typeFilter && n.type !== typeFilter) return false;
    if (layerFilter && n.layer !== layerFilter) return false;
    if (sourceFilter && (n.source ?? "llm") !== sourceFilter) return false;
    if (statusFilter && (n.status ?? "confirmed") !== statusFilter) return false;
    return true;
  });
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

  // Build graph from data
  const buildGraph = useCallback(() => {
    const graph = new Graph({ multi: true });

    for (const node of filteredNodes) {
      graph.addNode(node.id, {
        label: node.label,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 6, // placeholder, will be set after edges are added
        color: getNodeColor(node.type),
        nodeType: node.type,
        // v0.6.1 provenance — read by nodeReducer for visual decorators
        confidence: node.confidence,
        nodeSource: node.source ?? "llm",
        nodeStatus: node.status ?? "confirmed",
      });
    }

    for (const edge of edges) {
      if (!filteredNodeIds.has(edge.source) || !filteredNodeIds.has(edge.target)) continue;
      // Apply edge filters (status/source) — same logic as nodes
      if (sourceFilter && (edge.source_type ?? "llm") !== sourceFilter) continue;
      if (statusFilter && (edge.status ?? "confirmed") !== statusFilter) continue;
      const key = edge.id || `${edge.source}-${edge.target}-${edge.relation}`;
      if (!graph.hasEdge(key)) {
        try {
          graph.addEdgeWithKey(key, edge.source, edge.target, {
            label: edge.relation,
            size: Math.max(1, (edge.weight ?? 1) * 1.5),
            color: SOURCE_EDGE_COLORS[edge.source_type ?? "llm"],
            edgeId: edge.id,
            // v0.6.1 provenance — read by edgeReducer
            confidence: edge.confidence,
            edgeSource: edge.source_type ?? "llm",
            edgeStatus: edge.status ?? "confirmed",
          });
        } catch {
          // skip duplicate edges
        }
      }
    }

    // Size nodes by degree (connection count)
    graph.forEachNode((nodeId) => {
      const degree = graph.degree(nodeId);
      graph.setNodeAttribute(nodeId, "size", Math.max(6, Math.min(24, 6 + degree * 2)));
    });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredNodes.length, edges.length, typeFilter, layerFilter, sourceFilter, statusFilter]);

  // Initialize sigma
  useEffect(() => {
    if (!containerRef.current || filteredNodes.length === 0) return;

    const graph = buildGraph();
    graphRef.current = graph;

    const sigma = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelRenderedSizeThreshold: 1,
      labelColor: { color: "#e2e8f0" },
      labelFont: "Geist Variable, sans-serif",
      labelSize: 12,
      defaultEdgeType: "line",
      defaultNodeColor: DEFAULT_COLOR,
      defaultEdgeColor: "rgba(148, 163, 184, 0.3)",
      renderEdgeLabels: true,
      edgeLabelFont: "Geist Variable, sans-serif",
      edgeLabelSize: 10,
      edgeLabelColor: { color: "#94a3b8" },
    });

    // Click handlers
    sigma.on("clickNode", ({ node }) => {
      onSelectNode(node);
    });

    sigma.on("clickStage", () => {
      onSelectNode(null);
    });

    // Right-click handlers
    sigma.on("rightClickNode", ({ node, event }) => {
      event.original.preventDefault();
      onRightClickNode?.(node, event.original.clientX, event.original.clientY);
    });

    sigma.on("rightClickEdge", ({ edge, event }) => {
      event.original.preventDefault();
      const edgeAttrs = graph.getEdgeAttributes(edge);
      onRightClickEdge?.(edgeAttrs.edgeId ?? edge, event.original.clientX, event.original.clientY);
    });

    sigma.on("rightClickStage", ({ event }) => {
      event.original.preventDefault();
    });

    sigmaRef.current = sigma;

    return () => {
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildGraph, filteredNodes.length, onSelectNode, onRightClickNode, onRightClickEdge]);

  // Highlight selected node's neighbors + merge source
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    sigma.setSetting("nodeReducer", (node, data) => {
      // ── v0.6.1 base decorators (apply before selection/merge filters) ──
      const confidence = data.confidence as number | undefined;
      const nodeSource = (data.nodeSource as GraphSource | undefined) ?? "llm";
      const nodeStatus = (data.nodeStatus as GraphStatus | undefined) ?? "confirmed";

      const opacity = confidenceToOpacity(confidence);
      const baseHex = (data.color as string) || DEFAULT_COLOR;
      const baseColor = baseHex.startsWith("#") ? hexToRgba(baseHex, opacity) : baseHex;
      const sourceBorder = SOURCE_BORDER_COLORS[nodeSource];
      // pending_review ring overrides any source border
      const borderColor =
        nodeStatus === "pending_review" ? STATUS_RING_COLOR : sourceBorder ?? undefined;
      const decorated = {
        ...data,
        color: baseColor,
        ...(borderColor ? { borderColor } : {}),
        ...(nodeStatus === "pending_review" ? { highlighted: true, zIndex: 2 } : {}),
      };

      // Merge source highlight overrides v0.6.1 decorators
      if (mergeSourceId && node === mergeSourceId) {
        return {
          ...decorated,
          highlighted: true,
          zIndex: 3,
          color: "#f59e0b",
          borderColor: "#f59e0b",
        };
      }

      if (!selectedNodeId) return decorated;
      if (node === selectedNodeId) {
        return { ...decorated, highlighted: true, zIndex: 2 };
      }
      const isNeighbor = graph.hasEdge(selectedNodeId, node) || graph.hasEdge(node, selectedNodeId);
      if (!isNeighbor) {
        return { ...decorated, color: "rgba(148, 163, 184, 0.15)", label: "" };
      }
      return decorated;
    });

    sigma.setSetting("edgeReducer", (edge, data) => {
      // ── v0.6.1 base decorators ──
      const confidence = data.confidence as number | undefined;
      const edgeStatus = (data.edgeStatus as GraphStatus | undefined) ?? "confirmed";
      const opacity = confidenceToOpacity(confidence);

      // Apply opacity to the existing rgba color
      const baseRgba = (data.color as string) || "rgba(148, 163, 184, 0.3)";
      const colorWithOpacity = baseRgba.replace(
        /rgba?\(([^)]+)\)/,
        (_, parts: string) => {
          const [r, g, b] = parts.split(",").map((s) => s.trim());
          return `rgba(${r}, ${g}, ${b}, ${opacity * 0.7})`;
        },
      );

      const decorated =
        edgeStatus === "pending_review"
          ? { ...data, color: STATUS_RING_COLOR, size: Math.max(2, (data.size as number) ?? 1) }
          : { ...data, color: colorWithOpacity };

      if (!selectedNodeId) return decorated;
      const src = graph.source(edge);
      const tgt = graph.target(edge);
      if (src === selectedNodeId || tgt === selectedNodeId) {
        return { ...decorated, color: edgeStatus === "pending_review" ? STATUS_RING_COLOR : "rgba(148, 163, 184, 0.6)", size: 2 };
      }
      return { ...decorated, hidden: true };
    });

    sigma.refresh();
  }, [selectedNodeId, mergeSourceId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-background"
      style={{ minHeight: "400px" }}
    />
  );
}
