import { useState } from "react";
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight } from "lucide-react";

interface PipelineStepperProps {
  raw: Record<string, unknown>;
}

// ── Stage debug data types (3-stage pipeline) ──

interface S1Data {
  verdict: string;
  level: number;
  confidence: number;
  current_topic: string;
  detected_topic: string | null;
  keyword: string | null;
  similarity: number | null;
  detail: string;
  placeholder_created: boolean | null;
}

interface S2Node {
  id: string;
  label: string;
  type: string;
  facts: string[];
}

interface S2Chunk {
  text: string;
  score: number;
  source: string;
  label: string;
  tokens: number;
}

interface S2Data {
  nodes: S2Node[];
  files: string[];
  vector_hits: { node_id: string; score: number }[];
  chunks_total: number;
  chunks_selected: number;
  chunks: S2Chunk[];
}

interface S3Data {
  warm_tokens: number;
  hot_tokens: number;
  total_tokens: number;
  warm_budget: number;
  chunks_used: number;
  warm_source: string;
  warm_content_preview: string;
  has_context: boolean;
  verified_chunks: number | null;
  conversation_chunks: number | null;
}

interface StageDebug {
  s1_detection?: S1Data;
  s2_gathered?: S2Data;
  s3_context?: S3Data;
}

// ── Parse stage_data from raw ──

function parseStageDebug(raw: Record<string, unknown>): StageDebug {
  const sd = raw.stage_data;
  if (!sd) return {};
  if (typeof sd === "string") {
    try {
      return JSON.parse(sd);
    } catch {
      return {};
    }
  }
  if (typeof sd === "object") return sd as StageDebug;
  return {};
}

// ── Narrative generators per stage ──

function s1Narrative(data: S1Data): { summary: string; context: string } {
  const topic = data.current_topic || "unknown";
  const conf = data.confidence.toFixed(2);
  const isNew = data.verdict === "CHANGED";
  const isContinuation = data.verdict === "CONTINUATION" || data.verdict === "SAME";

  let summary: string;
  if (isNew) {
    summary = `Found topic: "${topic}" (confidence: ${conf}, new topic)`;
  } else if (isContinuation) {
    summary = `Continuing topic: "${topic}" (confidence: ${conf})`;
  } else {
    summary = `Topic: "${topic}" (${data.verdict.toLowerCase()}, conf: ${conf})`;
  }

  let context = "";
  if (data.placeholder_created) {
    context = "Creating placeholder node for future reference";
  } else if (isNew) {
    context = "Activated related nodes in knowledge graph";
  } else if (isContinuation) {
    context = "Reusing existing context from previous turn";
  }

  return { summary, context };
}

function s2Narrative(data: S2Data): { summary: string; context: string } {
  const nodeCount = data.nodes.length;
  const chunkCount = data.chunks_selected || data.chunks_total;

  if (nodeCount === 0) {
    return {
      summary: "Searched knowledge base — no matches found",
      context: "No stored facts relevant to this query",
    };
  }

  const nodeNames = data.nodes.map((n) => n.label).join(", ");
  const summary = `Searched knowledge base — found ${nodeCount} node${nodeCount !== 1 ? "s" : ""}, ${chunkCount} chunk${chunkCount !== 1 ? "s" : ""}`;

  // Determine verification status
  const hasVerified = data.chunks.some((c) => c.source.startsWith("verified"));
  const hasConversation = data.chunks.some((c) => !c.source.startsWith("verified"));
  let context: string;
  if (hasVerified && hasConversation) {
    context = `Nodes: ${nodeNames} (mixed verified + conversation)`;
  } else if (hasVerified) {
    context = `Nodes: ${nodeNames} (verified sources)`;
  } else {
    context = `Nodes: ${nodeNames} (from conversation, unverified)`;
  }

  return { summary, context };
}

function s3Narrative(data: S3Data): { summary: string; context: string } {
  if (!data.has_context || data.warm_tokens === 0) {
    return {
      summary: "No context to inject — LLM will rely on training data",
      context: "",
    };
  }

  const summary = `Built enriched context: ${data.warm_tokens}tk from memory`;

  const verified = data.verified_chunks ?? 0;
  const unverified = data.conversation_chunks ?? 0;
  const usedPct = Math.round((data.warm_tokens / data.warm_budget) * 100);
  const parts: string[] = [];

  if (verified > 0 && unverified > 0) {
    parts.push(`${verified} verified + ${unverified} unverified chunks`);
  } else if (verified > 0) {
    parts.push(`${verified} verified chunk${verified !== 1 ? "s" : ""} as [VERIFIED CONTEXT]`);
  } else if (unverified > 0) {
    parts.push(`${unverified} unverified chunk${unverified !== 1 ? "s" : ""} as [CONVERSATION CONTEXT]`);
  }

  parts.push(`Total: ${data.total_tokens}tk (budget: ${data.warm_budget}tk, ${usedPct}% used)`);

  return { summary, context: parts.join("\n") };
}

// ── Raw data viewers (collapsed by default) ──

function S1RawDetail({ data }: { data: S1Data }) {
  return (
    <div className="space-y-1 text-[12px] font-mono text-muted-foreground/60">
      <Row label="verdict" value={data.verdict} />
      <Row label="level" value={`L${data.level}`} />
      <Row label="confidence" value={data.confidence.toFixed(2)} />
      <Row label="current topic" value={data.current_topic} />
      {data.detected_topic && <Row label="detected" value={data.detected_topic} />}
      {data.keyword && <Row label="keyword" value={data.keyword} />}
      {data.similarity != null && <Row label="similarity" value={data.similarity.toFixed(3)} />}
      {data.detail && <Row label="detail" value={data.detail} />}
      {data.placeholder_created && <Row label="placeholder" value="created" highlight />}
    </div>
  );
}

function S2RawDetail({ data }: { data: S2Data }) {
  return (
    <div className="space-y-1.5 text-[12px] font-mono text-muted-foreground/60">
      {data.nodes.length > 0 && (
        <div>
          <span className="text-muted-foreground/50">nodes ({data.nodes.length}):</span>
          <div className="ml-2 mt-0.5 space-y-0.5">
            {data.nodes.map((n, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-amber-400/60">{n.type || "entity"}</span>
                <span className="text-muted-foreground/70">{n.label}</span>
                {n.facts.length > 0 && (
                  <span className="text-muted-foreground/40">{n.facts.length} facts</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {data.chunks && data.chunks.length > 0 && (
        <div>
          <span className="text-muted-foreground/50">
            ranked chunks ({data.chunks_selected}/{data.chunks_total} selected):
          </span>
          <div className="ml-2 mt-0.5 space-y-0.5">
            {data.chunks.map((c, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-amber-400/50">{c.score.toFixed(2)}</span>
                <span className="text-muted-foreground/40">{c.source}</span>
                <span className="text-muted-foreground/50 truncate">{c.label}</span>
                <span className="text-muted-foreground/40">{c.tokens}tk</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.vector_hits.length > 0 && (
        <div>
          <span className="text-muted-foreground/50">vector hits ({data.vector_hits.length}):</span>
          <div className="ml-2 mt-0.5">
            {data.vector_hits.map((v, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-foreground/50">{v.node_id}</span>
                <span className="text-muted-foreground/40">score={v.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.files.length > 0 && (
        <div>
          <span className="text-muted-foreground/50">files ({data.files.length}):</span>
          <div className="ml-2 mt-0.5">
            {data.files.map((f, i) => (
              <div key={i} className="text-muted-foreground/50 truncate">{f}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function S3RawDetail({ data }: { data: S3Data }) {
  return (
    <div className="space-y-1 text-[12px] font-mono text-muted-foreground/60">
      <Row label="chunks used" value={`${data.chunks_used}`} />
      <Row label="warm budget" value={`${data.warm_budget}tk`} />
      <Row label="warm" value={`${data.warm_tokens}tk`} />
      <Row label="hot" value={`${data.hot_tokens}tk`} />
      <Row label="total" value={`${data.total_tokens}tk`} />
      <Row label="source" value={data.warm_source} highlight />
      {data.verified_chunks != null && <Row label="verified" value={`${data.verified_chunks} chunks`} />}
      {data.conversation_chunks != null && data.conversation_chunks > 0 && (
        <Row label="unverified" value={`${data.conversation_chunks} chunks`} highlight />
      )}
      {data.warm_content_preview && (
        <div className="mt-1.5">
          <span className="text-muted-foreground/50">warm content:</span>
          <pre className="mt-0.5 text-muted-foreground/50 whitespace-pre-wrap break-words max-h-32 overflow-y-auto leading-4">
            {data.warm_content_preview}
          </pre>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground/40 shrink-0">{label}:</span>
      <span className={highlight ? "text-amber-400/70" : "text-muted-foreground/70"}>{value}</span>
    </div>
  );
}

// ── Narrative step renderers ──

const RAW_RENDERERS: Record<string, (data: unknown) => React.ReactNode> = {
  s1_detection: (data) => <S1RawDetail data={data as S1Data} />,
  s2_gathered: (data) => <S2RawDetail data={data as S2Data} />,
  s3_context: (data) => <S3RawDetail data={data as S3Data} />,
};

type StepStatus = "done" | "active" | "pending";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done")
    return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
  if (status === "active")
    return <Loader2 size={14} className="text-amber-400 animate-spin shrink-0" />;
  return <Circle size={14} className="text-muted-foreground/30 shrink-0" />;
}

interface NarrativeStepDef {
  id: string;
  debugKey: keyof StageDebug;
  narrativeFn: (data: unknown) => { summary: string; context: string };
  fallbackParse: (stage: string) => string;
}

const NARRATIVE_STEPS: NarrativeStepDef[] = [
  {
    id: "S1",
    debugKey: "s1_detection",
    narrativeFn: (d) => s1Narrative(d as S1Data),
    fallbackParse: (s) => s,
  },
  {
    id: "S2",
    debugKey: "s2_gathered",
    narrativeFn: (d) => s2Narrative(d as S2Data),
    fallbackParse: (s) => s,
  },
  {
    id: "S3",
    debugKey: "s3_context",
    narrativeFn: (d) => s3Narrative(d as S3Data),
    fallbackParse: (s) => s,
  },
];

function NarrativeStepRow({
  def,
  status,
  fallback,
  debugData,
  isLast,
}: {
  def: NarrativeStepDef;
  status: StepStatus;
  fallback: string;
  debugData: unknown;
  isLast: boolean;
}) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const hasDebug = debugData != null;
  const renderer = RAW_RENDERERS[def.debugKey];

  // Generate narrative from structured data, or fall back to raw string
  const narrative = hasDebug
    ? def.narrativeFn(debugData)
    : { summary: fallback, context: "" };

  return (
    <div className="flex gap-2">
      {/* Vertical line + icon */}
      <div className="flex flex-col items-center">
        <StepIcon status={status} />
        {!isLast && (
          <div className={`w-px flex-1 min-h-3 ${status === "pending" ? "bg-muted-foreground/15" : "bg-emerald-400/30"}`} />
        )}
      </div>

      {/* Content */}
      <div className="pb-2.5 -mt-0.5 flex-1 min-w-0">
        {/* Summary line */}
        <div className="text-sm text-muted-foreground/90 leading-5">
          {narrative.summary || <span className="text-muted-foreground/40 italic">waiting...</span>}
        </div>

        {/* Context line(s) */}
        {narrative.context && (
          <div className="text-[12px] text-muted-foreground/60 font-mono leading-4 mt-0.5 whitespace-pre-line">
            {narrative.context}
          </div>
        )}

        {/* Collapsible raw data */}
        {hasDebug && renderer && (
          <div className="mt-1">
            <button
              onClick={() => setRawExpanded(!rawExpanded)}
              className="flex items-center gap-1 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/60 font-mono cursor-pointer"
            >
              {rawExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Raw {def.id} data
            </button>
            {rawExpanded && (
              <div className="mt-1 ml-3 pl-2 border-l border-border/20">
                {renderer(debugData)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ──

export function PipelineStepper({ raw }: PipelineStepperProps) {
  const stages = (raw.stages as string[]) ?? [];
  if (stages.length === 0) return null;

  const debug = parseStageDebug(raw);

  return (
    <div className="mt-1 ml-1">
      {NARRATIVE_STEPS.map((def, i) => {
        const stage = stages[i];
        let status: StepStatus = "pending";

        if (stage) {
          status = "done";
        } else if (i === stages.length) {
          status = "active";
        }

        return (
          <NarrativeStepRow
            key={def.id}
            def={def}
            status={status}
            fallback={stage || ""}
            debugData={debug[def.debugKey]}
            isLast={i === NARRATIVE_STEPS.length - 1}
          />
        );
      })}
    </div>
  );
}
