import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { PipelineStep } from "@/lib/types";
import { getEventLabel, getEventSource } from "@/lib/eventNames";
import { SourceBadge, getSourceConfig } from "./sourceBadges";
import { ContextStackView } from "./ContextStackView";
import { PipelineStepper } from "./PipelineStepper";
import { copyEntryAsMarkdown, formatTime } from "./copyTrace";

// ── Specialized detail viewers ──

function StreamDetail({ raw }: { raw: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const text = raw.clean_text as string | undefined;

  return (
    <div className="mt-1 ml-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[13px] text-purple-400/80 hover:text-purple-400 font-mono cursor-pointer"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        raw response ({raw.completion_tokens}tk, {(raw.speed_tps as number)?.toFixed(1)}t/s)
      </button>
      {open && text && (
        <pre className="mt-1.5 text-[13px] text-muted-foreground/70 whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono ml-3 leading-5">
          {text}
        </pre>
      )}
    </div>
  );
}

function ExecutorDetail({ raw }: { raw: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const content = (raw.content as string) ?? (raw.result as string) ?? "";
  if (!content) return null;
  const preview = content.length > 300 ? content.slice(0, 300) + "…" : content;

  return (
    <div className="mt-1 ml-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[13px] text-emerald-400/80 hover:text-emerald-400 font-mono cursor-pointer"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        result preview
      </button>
      {open && (
        <pre className="mt-1.5 text-[13px] text-muted-foreground/70 whitespace-pre-wrap break-words max-h-32 overflow-y-auto font-mono ml-3 leading-5">
          {preview}
        </pre>
      )}
    </div>
  );
}

function RequestBodyView({ raw }: { raw: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [showActual, setShowActual] = useState(true);
  const [copied, setCopied] = useState(false);

  // Parse both pipeline-side and proxy-side request data
  const pipelineJson = raw.request_messages as string | undefined;
  const actualJson = raw.actual_llm_request as string | undefined;

  let pipelineMessages: { role: string; content: string; content_length: number }[] = [];
  let actualData: {
    messages: { role: string; content: string; content_length: number }[];
    message_count: number;
    model?: string;
    temperature?: number;
    stream?: boolean;
    has_tools?: boolean;
  } | null = null;

  try {
    if (pipelineJson) pipelineMessages = JSON.parse(pipelineJson);
  } catch { /* ignore */ }
  try {
    if (actualJson) actualData = JSON.parse(actualJson);
  } catch { /* ignore */ }

  const hasActual = actualData && actualData.messages.length > 0;
  const messages = hasActual && showActual ? actualData!.messages : pipelineMessages;
  if (messages.length === 0) return null;

  const roleColor: Record<string, string> = {
    system: "text-amber-400/70",
    user: "text-blue-400/70",
    assistant: "text-emerald-400/70",
    tool: "text-purple-400/70",
  };

  const handleCopy = async () => {
    // Copy the actual proxy request if available, otherwise pipeline messages
    const copyData = hasActual && showActual ? actualJson! : (pipelineJson ?? "");
    await navigator.clipboard.writeText(copyData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const label = hasActual && showActual
    ? `LLM received (${messages.length} messages)`
    : `sent to proxy (${messages.length} messages)`;

  return (
    <div className="mt-1 ml-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[13px] text-purple-400/80 hover:text-purple-400 font-mono cursor-pointer"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {label}
        </button>
        {open && hasActual && (
          <button
            onClick={() => setShowActual(!showActual)}
            className="text-[12px] text-muted-foreground/50 hover:text-muted-foreground/70 font-mono cursor-pointer"
          >
            [{showActual ? "show pipeline view" : "show LLM view"}]
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1.5 ml-3 space-y-2">
          {messages.map((m, i) => (
            <div key={i} className="text-[12px] font-mono">
              <span className={roleColor[m.role] ?? "text-muted-foreground/60"}>
                {m.role}
              </span>
              <span className="text-muted-foreground/50 ml-1">
                ({m.content_length ?? m.content.length} chars)
              </span>
              <pre className="mt-0.5 text-muted-foreground/60 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-4 ml-2">
                {m.content}
              </pre>
            </div>
          ))}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/60 font-mono cursor-pointer"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? "copied" : "copy full JSON"}
          </button>
        </div>
      )}
    </div>
  );
}

function RawDataToggle({ raw }: { raw: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const keys = Object.keys(raw).filter((k) => k !== "type" && k !== "timestamp");
  if (keys.length === 0) return null;

  return (
    <div className="mt-1 ml-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[13px] text-muted-foreground/40 hover:text-muted-foreground/60 font-mono cursor-pointer"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        raw
      </button>
      {open && (
        <pre className="mt-1.5 text-[13px] text-muted-foreground/60 whitespace-pre-wrap break-words max-h-32 overflow-y-auto font-mono ml-3 leading-5 p-2">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Context line generator ──

function getContextLine(step: PipelineStep): string | null {
  const r = step.raw;
  switch (step.type) {
    case "stream_started": {
      const actual = r.actual_llm_request as string | undefined;
      if (actual) {
        try {
          const data = JSON.parse(actual);
          const msgCount = data.message_count || data.messages?.length || 0;
          const hasTools = data.has_tools;
          return `Context injected: ${msgCount} messages${hasTools ? " + tools" : ""}`;
        } catch { /* ignore */ }
      }
      return null;
    }
    case "conversation_indexed": {
      const ent = r.entities_extracted as number;
      const facts = r.facts_extracted as number;
      if (ent === 0 && facts === 0) return null;
      return `Graph updated with new knowledge from this conversation`;
    }
    case "context_built": {
      const warm = r.warm_topic as string;
      if (warm) return "Proxy will enrich with knowledge graph context";
      const total = r.total_tokens as number;
      return total > 0 ? `History window: ${r.hot_messages} previous messages` : null;
    }
    default:
      return null;
  }
}

// ── TraceCard ──

const SPECIAL_TYPES = new Set([
  "context_built",
  "executor_result",
  "stream_completed",
  "stream_started",
  "acervo_enrich_result",
]);

export function TraceCard({ step }: { step: PipelineStep }) {
  const [copied, setCopied] = useState(false);
  const source = getEventSource(step.type);
  const config = getSourceConfig(source);
  const time = formatTime(step.timestamp);
  const contextLine = getContextLine(step);

  const handleCopy = async () => {
    await copyEntryAsMarkdown(step);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasRaw = !SPECIAL_TYPES.has(step.type) && Object.keys(step.raw).length > 1;

  return (
    <div className={`border-l-2 ${config.borderClass} py-1.5 pl-3 hover:bg-muted/30 transition-colors`}>
      {/* Header row */}
      <div className="flex items-center gap-2 text-sm font-mono leading-6">
        <span className="text-[12px] text-muted-foreground/60 shrink-0">{time}</span>
        <SourceBadge source={source} />
        <span className="font-medium text-muted-foreground/90 shrink-0">
          {step.detail || getEventLabel(step.type)}
        </span>
        <button
          onClick={handleCopy}
          className="ml-auto text-muted-foreground/30 hover:text-muted-foreground/60 cursor-pointer shrink-0"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      </div>

      {/* Context line */}
      {contextLine && (
        <div className="text-[12px] text-muted-foreground/50 font-mono ml-4 mt-0.5 leading-4">
          {contextLine}
        </div>
      )}

      {/* Expandable detail by event type */}
      {step.type === "context_built" && <ContextStackView raw={step.raw} />}
      {step.type === "acervo_enrich_result" && <PipelineStepper raw={step.raw} />}
      {step.type === "stream_started" && <RequestBodyView raw={step.raw} />}
      {step.type === "stream_completed" && <StreamDetail raw={step.raw} />}
      {step.type === "executor_result" && <ExecutorDetail raw={step.raw} />}
      {hasRaw && <RawDataToggle raw={step.raw} />}
    </div>
  );
}
