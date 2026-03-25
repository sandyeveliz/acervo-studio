/** Map event types to display labels for the pipeline step UI.
 *
 * source controls the badge color in TraceCard:
 *   "avs" = Acervo Studio backend (emerald)
 *   "acr" = Acervo context engine (amber)
 *   "llm" = LLM provider (purple)
 *   "mcp" = External tools (blue)
 *   "error" = errors (red)
 */

export const EVENT_LABELS: Record<string, { label: string; source: string }> = {
  message_received: { label: "Received message", source: "avs" },
  context_built: { label: "Prepared context", source: "avs" },
  topic_detect_step: { label: "Detected topic", source: "acr" },
  topic_changed: { label: "Topic changed", source: "acr" },
  planner_decision: { label: "Planned action", source: "acr" },
  executor_result: { label: "Executed query", source: "acr" },
  stream_started: { label: "Sending to LLM", source: "llm" },
  stream_completed: { label: "Response complete", source: "llm" },
  tool_call_requested: { label: "Calling tool", source: "mcp" },
  tool_call_completed: { label: "Tool returned", source: "mcp" },
  acervo_request_sent: { label: "Routed through proxy", source: "acr" },
  acervo_enrich_result: { label: "Enrichment", source: "acr" },
  conversation_indexed: { label: "Learning from response", source: "acr" },
  extraction_started: { label: "Extracting knowledge", source: "avs" },
  extraction_completed: { label: "Extraction done", source: "avs" },
  graph_updated: { label: "Graph updated", source: "avs" },
  pipeline_error: { label: "Error", source: "error" },
  debug_info: { label: "Debug", source: "avs" },
};

export function getEventLabel(type: string): string {
  return EVENT_LABELS[type]?.label ?? type;
}

export function getEventSource(type: string): string {
  return EVENT_LABELS[type]?.source ?? "pipeline";
}
