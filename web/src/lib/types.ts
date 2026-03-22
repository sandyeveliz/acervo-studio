/** WebSocket message types matching core/events.py */

// ── Client → Server ──

export interface ClientMessage {
  type: "message" | "reset" | "get_stats";
  text?: string;
}

// ── Server → Client events ──

export interface WsEvent {
  type: string;
  timestamp?: string;
}

export interface MessageReceivedEvent extends WsEvent {
  type: "message_received";
  user_text: string;
  msg_tokens: number;
  ctx_tokens: number;
  history_len: number;
}

export interface TopicDetectStepEvent extends WsEvent {
  type: "topic_detect_step";
  level: number;
  verdict: string;
  confidence: number;
  current_topic: string;
  keyword?: string;
  similarity?: number;
  answer?: string;
  detail: string;
}

export interface TopicChangedEvent extends WsEvent {
  type: "topic_changed";
  new_topic: string;
  previous_topic: string;
}

export interface PlannerDecisionEvent extends WsEvent {
  type: "planner_decision";
  tool: string;
  entity: string;
  query: string;
}

export interface AcervoDecisionEvent extends WsEvent {
  type: "acervo_decision";
  has_context: boolean;
  needs_tool: boolean;
  action: string;
}

export interface ExecutorResultEvent extends WsEvent {
  type: "executor_result";
  source: string;
  node_count: number;
  fact_count: number;
  content_preview: string;
  error_msg: string;
}

export interface ContextBuiltEvent extends WsEvent {
  type: "context_built";
  hot_messages: number;
  hot_tokens: number;
  warm_topic: string;
  warm_tokens: number;
  total_tokens: number;
  context_summary: string;
}

export interface StreamStartedEvent extends WsEvent {
  type: "stream_started";
  model: string;
  provider: string;
  endpoint: string;
  history_len: number;
  temperature: number;
}

export interface StreamChunkEvent extends WsEvent {
  type: "stream_chunk_received";
  display_text: string;
}

export interface StreamCompletedEvent extends WsEvent {
  type: "stream_completed";
  clean_text: string;
  completion_tokens: number;
  think_tokens: number;
  latency_ms: number;
  ttft_ms: number;
  speed_tps: number;
  chunk_count: number;
}

export interface ExtractionCompletedEvent extends WsEvent {
  type: "extraction_completed";
  entities: [string, string][];
  error?: string;
}

export interface GraphUpdatedEvent extends WsEvent {
  type: "graph_updated";
  node_count: number;
  edge_count: number;
}

export interface ToolCallRequestedEvent extends WsEvent {
  type: "tool_call_requested";
  tool: string;
  arguments: string;
}

export interface ToolCallCompletedEvent extends WsEvent {
  type: "tool_call_completed";
  tool: string;
  arguments: string;
  result_preview: string;
}

export interface PipelineErrorEvent extends WsEvent {
  type: "pipeline_error";
  step: string;
  error: string;
}

export interface TurnCompleteEvent extends WsEvent {
  type: "turn_complete";
}

export interface StatsEvent extends WsEvent {
  type: "stats";
  session_name: string;
  model: string;
  utility_model: string;
  turns: number;
  history_len: number;
  mcp_active: boolean;
  mcp_servers?: { name: string; status: string; error: string }[];
  acervo_enabled?: boolean;
}



// ── App state types ──

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface PipelineStep {
  type: string;
  label: string;
  detail: string;
  timestamp: string;
  raw: Record<string, unknown>;
}

export interface StepGroup {
  turnId: string;
  steps: PipelineStep[];
}

export interface McpServer {
  name: string;
  status: string;
  error: string;
}

export interface SessionStats {
  session_name?: string;
  model: string;
  utility_model: string;
  turns: number;
  history_len: number;
  mcp_active: boolean;
  mcp_servers?: McpServer[];
  acervo_enabled?: boolean;
  last_latency_ms?: number;
  last_ttft_ms?: number;
  last_speed_tps?: number;
  last_completion_tokens?: number;
  last_context?: {
    hot_messages: number;
    hot_tokens: number;
    warm_tokens: number;
    total_tokens: number;
  };
}

export interface TurnMetric {
  turn_number: number;
  timestamp: string;
  warm_tokens: number;
  hot_tokens: number;
  total_context_tokens: number;
  node_count: number;
  edge_count: number;
  nodes_activated: number;
  entities_extracted: number;
  facts_added: number;
  facts_deduped: number;
  topic: string;
  plan_tool: string;
  context_hit: boolean;
}

export interface TurnLogEntry {
  turn: number;
  timestamp: string;
  session: string;
  user_input: string;
  assistant_response?: string;
  topic?: string;
  topic_confidence?: number;
  planner?: { tool: string; entity: string; query: string };
  decision?: { action: string; has_context: boolean };
  executor?: { source: string; node_count: number; fact_count: number };
  context?: { hot_messages: number; hot_tokens: number; warm_tokens: number; total_tokens: number; warm_topic: string };
  llm?: { model: string; completion_tokens: number; latency_ms: number; speed_tps: number; skipped: boolean };
  extraction?: { entities: [string, string][]; error?: string | null };
  facts_filtered?: { entity: string; fact: string; reason: string }[];
  graph_after?: { node_count: number; edge_count: number };
  errors?: { step: string; error: string }[];
}

export interface MetricsData {
  session_id: string;
  started_at: string;
  turn_count: number;
  aggregates: {
    avg_total_tokens: number;
    avg_warm_tokens: number;
    context_hit_rate: number;
    graph_growth_rate: number;
    fact_density: number;
    total_entities_extracted: number;
    total_facts_added: number;
    total_facts_deduped: number;
  };
  turns: TurnMetric[];
}
