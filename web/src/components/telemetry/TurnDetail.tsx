import { useState, useMemo } from "react";
import { CheckCircle, Edit3, Download } from "lucide-react";
import { annotationApi, type TelemetrySpan, type TraceEvent, type Annotation } from "@/lib/api";
import { StageCard, RawPanel, DetailRow } from "./StageCard";
import { PipelineTimeline } from "./PipelineTimeline";
import { AnnotationPanel } from "./AnnotationPanel";

interface TurnDetailProps {
  span: TelemetrySpan;
  events: TraceEvent[];
  annotation?: Annotation;
  onSaveAnnotation: (ann: Partial<Annotation>) => void;
}

const EMPTY_EXPECTED = { entities: [], relations: [], facts: [] };

export function TurnDetail({ span, events, annotation, onSaveAnnotation }: TurnDetailProps) {
  const [observations, setObservations] = useState(annotation?.observations ?? "");

  // Extract stage_data from trace events (debug dict from proxy)
  const stageData = useMemo(() => {
    const enrichEvt = events.find((e) => e.type === "acervo_enrich_result");
    if (!enrichEvt) return {};
    const raw = (enrichEvt as Record<string, unknown>).stage_data;
    if (typeof raw === "string" && raw) {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
  }, [events]);

  // Extract LLM request/response from trace events
  const streamStarted = events.find((e) => e.type === "stream_started");
  const streamCompleted = events.find((e) => e.type === "stream_completed");

  const s1Data = (stageData as Record<string, unknown>).s1_detection as Record<string, unknown> | undefined;
  const s2Data = (stageData as Record<string, unknown>).s2_gathered as Record<string, unknown> | undefined;
  const s3Data = (stageData as Record<string, unknown>).s3_context as Record<string, unknown> | undefined;

  const status = annotation?.status ?? "pending";
  const totalMs = span.s1.latency_ms + span.s2.latency_ms + span.llm.latency_ms + span.s15.latency_ms;

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">Turn #{span.turn_id}</span>
          <span className="text-xs text-muted-foreground">{span.timestamp}</span>
          {span.llm.model && (
            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{span.llm.model}</span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            status === "annotated" ? "bg-emerald-500/10 text-emerald-500" :
            status === "editing" ? "bg-amber-500/10 text-amber-500" :
            "bg-muted text-muted-foreground"
          }`}>{status}</span>
        </div>
        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
          <span>S1 {span.s15.entities_created}E</span>
          <span>S2 {span.s2.nodes_activated}/{span.s2.facts_found}</span>
          <span>LLM {span.llm.latency_ms > 1000 ? `${(span.llm.latency_ms / 1000).toFixed(1)}s` : `${span.llm.latency_ms}ms`}</span>
          <span>+{span.graph.node_delta}n +{span.graph.edge_delta}e</span>
          <span>Total: {totalMs > 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`}</span>
        </div>
      </div>

      {/* User message */}
      <RawPanel title="User Message" data={span.user_msg} />

      {/* Pipeline timeline */}
      <PipelineTimeline span={span} />

      {/* S1 — Intent + Extraction */}
      <StageCard
        stage="s1"
        label="S1 — Intent + Extraction"
        latencyMs={span.s1.latency_ms}
        ok={span.s1.ok}
        defaultOpen
        badge={`${s1Data ? (s1Data.entities_extracted ?? 0) : 0}E ${s1Data ? (s1Data.relations_extracted ?? 0) : 0}R`}
      >
        <div className="space-y-2 pt-2">
          <DetailRow label="Intent" value={span.s1.intent || "(none)"} />
          <DetailRow label="Topic" value={span.s1.topic || "(none)"} />
          <DetailRow label="Confidence" value={span.s1.confidence.toFixed(2)} />

          {/* Expected intent + topic */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Expected Intent</label>
              <select
                value={annotation?.s1_expected?.intent ?? ""}
                onChange={(e) => onSaveAnnotation({
                  s1_expected: { ...(annotation?.s1_expected ?? EMPTY_EXPECTED), intent: e.target.value },
                  status: "editing",
                })}
                className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded"
              >
                <option value="">—</option>
                {["overview", "specific", "followup", "chat"].map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Expected Topic</label>
              <input
                value={annotation?.s1_expected?.topic?.label ?? ""}
                onChange={(e) => onSaveAnnotation({
                  s1_expected: {
                    ...(annotation?.s1_expected ?? EMPTY_EXPECTED),
                    topic: { action: e.target.value ? "changed" : "same", label: e.target.value || undefined },
                  },
                  status: "editing",
                })}
                className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded"
                placeholder="topic label"
              />
            </div>
          </div>

          {/* Annotation panel: actual vs expected entities/relations/facts */}
          <AnnotationPanel
            actual={{
              entities: (s1Data?.entities as { name: string; type: string; layer?: string }[]) ?? [],
              relations: (s1Data?.relations as { source: string; target: string; relation: string }[]) ?? [],
              facts: (s1Data?.facts as { entity: string; fact: string; speaker?: string }[]) ?? [],
            }}
            expected={annotation?.s1_expected ?? EMPTY_EXPECTED}
            onChange={(expected) => onSaveAnnotation({ s1_expected: { ...expected, intent: annotation?.s1_expected?.intent, topic: annotation?.s1_expected?.topic }, status: "editing" })}
          />

          <RawPanel title="S1 Prompt Sent" data={(stageData as Record<string, unknown>).s1_prompt} />
          <RawPanel title="S1 Raw Response" data={(stageData as Record<string, unknown>).s1_raw_response} />
        </div>
      </StageCard>

      {/* S2 — Context Activation */}
      <StageCard stage="s2" label="S2 — Context Activation" latencyMs={span.s2.latency_ms} ok={span.s2.ok}
        badge={`${span.s2.nodes_activated} nodes`}
      >
        <div className="space-y-2 pt-2">
          <DetailRow label="Source" value={span.s2.source || "(none)"} />
          <DetailRow label="Nodes Activated" value={span.s2.nodes_activated} />
          <DetailRow label="Facts Found" value={span.s2.facts_found} />

          {/* S2 expected: notes */}
          <div className="mt-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Expected Notes</label>
            <textarea
              value={annotation?.s2_expected?.notes ?? ""}
              onChange={(e) => onSaveAnnotation({
                s2_expected: { nodes_should_activate: annotation?.s2_expected?.nodes_should_activate ?? [], notes: e.target.value },
                status: "editing",
              })}
              rows={2}
              className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded resize-none"
              placeholder="Notes about context activation..."
            />
          </div>

          <RawPanel title="Gathered Nodes" data={s2Data?.nodes} />
          <RawPanel title="Vector Hits" data={s2Data?.vector_hits} />
        </div>
      </StageCard>

      {/* S3 — Budget Assembly */}
      <StageCard stage="s3" label="S3 — Budget Assembly" latencyMs={span.s3.latency_ms} ok={span.s3.ok}
        badge={`${span.s3.total_tokens}tk`}
      >
        <div className="space-y-2 pt-2">
          <DetailRow label="Warm Tokens" value={span.s3.warm_tokens} />
          <DetailRow label="Hot Tokens" value={span.s3.hot_tokens} />
          <DetailRow label="Total" value={span.s3.total_tokens} />
          <DetailRow label="Budget" value={s3Data?.warm_budget ?? "—"} />
          <DetailRow label="Has Context" value={s3Data?.has_context ? "Yes" : "No"} />

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Context Adequate?</label>
              <select
                value={annotation?.s3_expected?.context_adequate ? "yes" : "no"}
                onChange={(e) => onSaveAnnotation({
                  s3_expected: { context_adequate: e.target.value === "yes", notes: annotation?.s3_expected?.notes ?? "" },
                  status: "editing",
                })}
                className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
              <textarea
                value={annotation?.s3_expected?.notes ?? ""}
                onChange={(e) => onSaveAnnotation({
                  s3_expected: { context_adequate: annotation?.s3_expected?.context_adequate ?? true, notes: e.target.value },
                  status: "editing",
                })}
                rows={2}
                className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded resize-none"
                placeholder="Notes about context..."
              />
            </div>
          </div>

          <RawPanel title="Context Preview (warm layer)" data={s3Data?.warm_content_preview} />
          <RawPanel title="Final Prompt to LLM" data={(streamStarted as Record<string, unknown>)?.actual_llm_request ?? (streamStarted as Record<string, unknown>)?.request_messages} />
        </div>
      </StageCard>

      {/* LLM — Chat Response */}
      <StageCard stage="llm" label="LLM — Chat Response" latencyMs={span.llm.latency_ms}
        badge={`${span.llm.tokens_output}tk ${span.llm.tokens_per_sec}t/s`}
      >
        <div className="space-y-2 pt-2">
          <DetailRow label="Model" value={span.llm.model} mono />
          <DetailRow label="Provider" value={span.llm.provider} mono />
          <DetailRow label="TTFT" value={`${span.llm.ttft_ms}ms`} />
          <DetailRow label="Speed" value={`${span.llm.tokens_per_sec} t/s`} />
          <DetailRow label="Tokens In" value={span.llm.tokens_input} />
          <DetailRow label="Tokens Out" value={span.llm.tokens_output} />

          {/* LLM expected: quality rating + notes */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Quality (1-5)</label>
              <select
                value={annotation?.llm_expected?.response_quality ?? 0}
                onChange={(e) => onSaveAnnotation({
                  llm_expected: {
                    response_quality: Number(e.target.value),
                    used_context_correctly: annotation?.llm_expected?.used_context_correctly ?? true,
                    notes: annotation?.llm_expected?.notes ?? "",
                  },
                  status: "editing",
                })}
                className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded"
              >
                <option value={0}>—</option>
                {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
              <textarea
                value={annotation?.llm_expected?.notes ?? ""}
                onChange={(e) => onSaveAnnotation({
                  llm_expected: {
                    response_quality: annotation?.llm_expected?.response_quality ?? 0,
                    used_context_correctly: annotation?.llm_expected?.used_context_correctly ?? true,
                    notes: e.target.value,
                  },
                  status: "editing",
                })}
                rows={2}
                className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded resize-none"
                placeholder="Notes about response..."
              />
            </div>
          </div>

          <RawPanel title="LLM Request (full prompt)" data={(streamStarted as Record<string, unknown>)?.actual_llm_request ?? (streamStarted as Record<string, unknown>)?.request_messages} />
          <RawPanel title="LLM Response" data={(streamCompleted as Record<string, unknown>)?.clean_text} />
        </div>
      </StageCard>

      {/* S1.5 — Graph Curation */}
      <StageCard
        stage="s15"
        label="S1.5 — Graph Curation"
        latencyMs={span.s15.latency_ms}
        defaultOpen
        badge={`+${span.s15.entities_created}E +${span.s15.facts_created}F`}
      >
        <div className="space-y-2 pt-2">
          <DetailRow label="Entities Created" value={span.s15.entities_created} />
          <DetailRow label="Facts Created" value={span.s15.facts_created} />
          {span.s15.facts_filtered.length > 0 && (
            <DetailRow label="Facts Filtered" value={span.s15.facts_filtered.length} />
          )}

          {/* Show the LLM response that S1.5 is extracting from */}
          <RawPanel
            title="Assistant Response (input to S1.5)"
            data={(stageData as Record<string, unknown>).assistant_msg ?? (streamCompleted as Record<string, unknown>)?.clean_text}
            defaultOpen
          />

          {/* S1.5 Annotation panel */}
          <AnnotationPanel
            actual={{
              entities: [],
              relations: [],
              facts: [],
            }}
            expected={annotation?.s15_expected ?? EMPTY_EXPECTED}
            onChange={(expected) => onSaveAnnotation({
              s15_expected: { ...expected, merges: annotation?.s15_expected?.merges ?? [], notes: annotation?.s15_expected?.notes ?? "" },
              status: "editing",
            })}
          />

          <div className="mt-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">S1.5 Notes</label>
            <textarea
              value={annotation?.s15_expected?.notes ?? ""}
              onChange={(e) => onSaveAnnotation({
                s15_expected: { ...(annotation?.s15_expected ?? { ...EMPTY_EXPECTED, merges: [], notes: "" }), notes: e.target.value },
                status: "editing",
              })}
              rows={2}
              className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded resize-none"
              placeholder="Notes about what S1.5 should have extracted..."
            />
          </div>

          <RawPanel title="S1.5 Actions Taken" data={(stageData as Record<string, unknown>).s15_actions} />
          <RawPanel title="S1.5 Prompt Sent" data={(stageData as Record<string, unknown>).s15_prompt} />
          <RawPanel title="S1.5 Raw Model Response" data={(stageData as Record<string, unknown>).s15_raw_response} />
        </div>
      </StageCard>

      {/* Observations */}
      <div className="border border-border rounded-lg p-3">
        <label className="text-xs font-medium text-muted-foreground">Observations</label>
        <textarea
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          onBlur={() => {
            if (observations !== (annotation?.observations ?? "")) {
              onSaveAnnotation({ observations, status: annotation?.status === "annotated" ? "annotated" : "editing" });
            }
          }}
          rows={3}
          className="w-full mt-1 px-2 py-1 text-xs bg-background border border-border rounded resize-none"
          placeholder="Free text notes about this turn... (e.g. 'missed the organization entity', 'topic detection was wrong')"
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => onSaveAnnotation({ status: "annotated" })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer"
        >
          <CheckCircle size={12} />
          Mark as Annotated
        </button>
        {status === "annotated" && (
          <button
            onClick={() => onSaveAnnotation({ status: "editing" })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Edit3 size={12} />
            Re-open
          </button>
        )}

        {/* Export buttons — always available, no annotation required */}
        <button
          onClick={async () => {
            try {
              const res = await annotationApi.exportTurn(span.turn_id, "json");
              const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
              downloadBlob(blob, `turn_${span.turn_id}.json`);
            } catch { /* silent */ }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Download size={12} />
          Export JSON
        </button>
        <button
          onClick={async () => {
            try {
              const res = await annotationApi.exportTurn(span.turn_id, "jsonl");
              if (res.examples && res.examples.length > 0) {
                const blob = new Blob(
                  [res.examples.map((e: unknown) => JSON.stringify(e)).join("\n")],
                  { type: "application/jsonl" },
                );
                downloadBlob(blob, `turn_${span.turn_id}_training.jsonl`);
              }
            } catch { /* silent */ }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Download size={12} />
          Export JSONL
        </button>
      </div>

      {/* JSONL Preview */}
      {annotation?.s1_expected && (annotation.s1_expected.entities.length > 0 || annotation.s1_expected.relations.length > 0) && (
        <RawPanel
          title="JSONL Training Preview (S1)"
          data={JSON.stringify({
            messages: [
              { role: "system", content: "(S1 system prompt)" },
              { role: "user", content: "(S1 user content)" },
              { role: "assistant", content: JSON.stringify(annotation.s1_expected) },
            ],
          }, null, 2)}
        />
      )}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
