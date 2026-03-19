/** Map event types to display labels for the pipeline step UI. */

export const EVENT_LABELS: Record<string, { label: string; source: string }> = {
  message_received: { label: "Message received", source: "pipeline" },
  topic_detect_step: { label: "Topic detection", source: "acervo" },
  topic_changed: { label: "Topic changed", source: "acervo" },
  router_decision: { label: "Router", source: "pipeline" },
  planner_decision: { label: "Query planner", source: "acervo" },
  acervo_decision: { label: "Context decision", source: "acervo" },
  executor_result: { label: "Executor", source: "graph" },
  synthesizer_output: { label: "Synthesizer", source: "graph" },
  context_built: { label: "Context built", source: "pipeline" },
  stream_started: { label: "LLM streaming", source: "llm" },
  stream_completed: { label: "Stream done", source: "llm" },
  extraction_started: { label: "Extracting...", source: "acervo" },
  extraction_completed: { label: "Extraction done", source: "acervo" },
  fact_filtered: { label: "Fact filtered", source: "graph" },
  compaction_completed: { label: "Compaction", source: "acervo" },
  graph_updated: { label: "Graph updated", source: "graph" },
  confirmation_pending: { label: "Confirm?", source: "pipeline" },
  confirmation_accepted: { label: "Confirmed", source: "pipeline" },
  training_sample_saved: { label: "Training saved", source: "pipeline" },
  pipeline_error: { label: "Error", source: "error" },
  debug_info: { label: "Debug", source: "pipeline" },
};

export function getEventLabel(type: string): string {
  return EVENT_LABELS[type]?.label ?? type;
}

export function getEventSource(type: string): string {
  return EVENT_LABELS[type]?.source ?? "pipeline";
}
