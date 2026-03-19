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
  model: string;
  utility_model: string;
  turns: number;
  history_len: number;
  node_count: number;
  edge_count: number;
  mcp_active: boolean;
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
}

export interface StepGroup {
  turnId: string;
  steps: PipelineStep[];
}

export interface SessionStats {
  model: string;
  utility_model: string;
  turns: number;
  history_len: number;
  node_count: number;
  edge_count: number;
  mcp_active: boolean;
  last_latency_ms?: number;
  last_ttft_ms?: number;
  last_speed_tps?: number;
  last_completion_tokens?: number;
}
