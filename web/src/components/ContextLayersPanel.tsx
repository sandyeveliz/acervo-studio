import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import type { ContextLayerNode, ContextLayersResponse } from "@/lib/api";

// ── Source icon mapping ──

function sourceIcon(source: string): string {
  switch (source) {
    case "world":
    case "web":
      return "\u{1F50D}"; // magnifying glass
    case "tool_result":
      return "\u{1F50D}";
    case "conversation":
    case "user_assertion":
      return "\u{1F4AC}"; // speech bubble
    default:
      return "\u{1F4C4}"; // page
  }
}

// ── Kind config ──

interface KindConfig {
  key: string;
  label: string;
  dotClass: string;
  textClass: string;
  defaultExpanded: boolean;
}

const KIND_CONFIGS: Record<string, Omit<KindConfig, "key">> = {
  entity: { label: "ENTITIES", dotClass: "bg-emerald-400", textClass: "text-emerald-400", defaultExpanded: true },
  file: { label: "FILES", dotClass: "bg-blue-400", textClass: "text-blue-400", defaultExpanded: false },
  symbol: { label: "SYMBOLS", dotClass: "bg-purple-400", textClass: "text-purple-400", defaultExpanded: false },
  section: { label: "SECTIONS", dotClass: "bg-amber-400", textClass: "text-amber-400", defaultExpanded: false },
};

function getKindConfig(kind: string): KindConfig {
  const base = KIND_CONFIGS[kind] ?? {
    label: kind.toUpperCase(),
    dotClass: "bg-muted-foreground",
    textClass: "text-muted-foreground",
    defaultExpanded: false,
  };
  return { key: kind, ...base };
}

// ── Node detail popup ──

function NodeDetailPopup({ node, onClose }: { node: ContextLayerNode; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(node, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg p-4 max-w-sm w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{node.label}</h3>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[12px] text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
        <div className="space-y-1.5 text-[13px] font-mono">
          <DetailRow label="id" value={node.id} />
          <DetailRow label="type" value={node.type} />
          <DetailRow label="kind" value={node.kind} />
          <DetailRow label="source" value={node.source} />
          <DetailRow label="verified" value={node.verified ? "yes" : "no"} />
          <DetailRow label="facts" value={`${node.facts_count}`} />
          <DetailRow label="edges" value={`${node.edges_count}`} />
          <DetailRow label="tokens" value={`~${node.token_count}`} />
          <DetailRow label="last active" value={node.last_active} />
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground/50 shrink-0">{label}:</span>
      <span className="text-foreground/80">{value}</span>
    </div>
  );
}

// ── Kind section ──

function KindSection({
  config,
  nodes,
  totalTokens,
  onNodeClick,
}: {
  config: KindConfig;
  nodes: ContextLayerNode[];
  totalTokens: number;
  onNodeClick: (node: ContextLayerNode) => void;
}) {
  const [expanded, setExpanded] = useState(config.defaultExpanded);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left cursor-pointer py-1"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-muted-foreground/50 shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-muted-foreground/50 shrink-0" />
        )}
        <span className={`w-2 h-2 rounded-full ${config.dotClass} shrink-0`} />
        <span className={`text-[13px] font-semibold font-mono ${config.textClass}`}>
          {config.label}
        </span>
        <span className="text-[13px] text-muted-foreground/60 font-mono ml-auto">
          {nodes.length}
        </span>
      </button>

      {expanded && (
        <div className="ml-5 space-y-0.5 mb-1.5">
          {nodes.length === 0 ? (
            <span className="text-[12px] text-muted-foreground/40 font-mono italic">empty</span>
          ) : (
            nodes.map((node) => (
              <button
                key={node.id}
                onClick={() => onNodeClick(node)}
                className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-muted/30 rounded px-1 -ml-1 cursor-pointer"
              >
                <span className="text-[12px] shrink-0">{sourceIcon(node.source)}</span>
                <span className="text-[13px] text-foreground/80 font-mono truncate">{node.label}</span>
                <span className="text-[11px] text-muted-foreground/40 font-mono shrink-0">
                  [{node.type}]
                </span>
                <span className="text-[11px] shrink-0 ml-auto">
                  {node.verified ? "\u2713" : "?"}
                </span>
              </button>
            ))
          )}
          {nodes.length > 0 && (
            <div className="text-[12px] text-muted-foreground/40 font-mono pt-0.5">
              ~{totalTokens}tk
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

interface ContextLayersPanelProps {
  data: ContextLayersResponse | null;
}

export function ContextLayersPanel({ data }: ContextLayersPanelProps) {
  const [selectedNode, setSelectedNode] = useState<ContextLayerNode | null>(null);

  if (!data) return null;

  // Render kinds in a stable order: entity first, then alphabetical
  const kindOrder = ["entity", "file", "symbol", "section"];
  const allKinds = Object.keys(data.by_kind).sort((a, b) => {
    const ai = kindOrder.indexOf(a);
    const bi = kindOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-0.5">
      <div className="text-[12px] text-muted-foreground/50 font-mono mb-1">Knowledge graph</div>

      {allKinds.map((kind) => {
        const group = data.by_kind[kind];
        return (
          <KindSection
            key={kind}
            config={getKindConfig(kind)}
            nodes={group.nodes}
            totalTokens={group.total_tokens}
            onNodeClick={setSelectedNode}
          />
        );
      })}

      {/* Totals */}
      <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 text-[13px] font-mono pt-1.5 border-t border-border/20 mt-1.5">
        <span className="text-muted-foreground/70">nodes</span>
        <span className="text-foreground/90">{data.totals.nodes}</span>
        <span className="text-muted-foreground/70">edges</span>
        <span className="text-foreground/90">{data.totals.edges}</span>
      </div>
      <div className="text-[12px] text-muted-foreground/50 font-mono">
        ~{data.totals.total_tokens}tk total
      </div>

      {/* Node detail popup */}
      {selectedNode && (
        <NodeDetailPopup node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}
    </div>
  );
}
