import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  Message,
  PipelineStep,
  SessionStats,
  StepGroup,
  WsEvent,
  StreamCompletedEvent,
  GraphUpdatedEvent,
  StatsEvent,
} from "@/lib/types";
import { getEventLabel } from "@/lib/eventNames";

// ── State ──

interface ChatState {
  messages: Message[];
  currentStream: string | null;
  pipelineSteps: StepGroup[];
  stats: SessionStats;
  isStreaming: boolean;
  isProcessing: boolean;
  connected: boolean;
}

const INITIAL_STATS: SessionStats = {
  model: "",
  utility_model: "",
  turns: 0,
  history_len: 0,
  node_count: 0,
  edge_count: 0,
  mcp_active: false,
};

const INITIAL_STATE: ChatState = {
  messages: [],
  currentStream: null,
  pipelineSteps: [],
  stats: INITIAL_STATS,
  isStreaming: false,
  isProcessing: false,
  connected: false,
};

// ── Actions ──

type Action =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "user_message"; text: string }
  | { type: "ws_event"; event: WsEvent }
  | { type: "reset" };

let _nextId = 0;
function nextId(): string {
  return `msg_${++_nextId}`;
}

// Events to skip in the pipeline step display
const SKIP_STEP_EVENTS = new Set([
  "stream_chunk_received",
  "stream_started",
  "turn_complete",
  "reset_complete",
  "stats",
  "error",
]);

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: true };

    case "disconnected":
      return { ...state, connected: false, isProcessing: false, isStreaming: false };

    case "user_message": {
      const msg: Message = {
        id: nextId(),
        role: "user",
        content: action.text,
        timestamp: new Date().toISOString(),
      };
      const turnId = `turn_${_nextId}`;
      return {
        ...state,
        messages: [...state.messages, msg],
        pipelineSteps: [...state.pipelineSteps, { turnId, steps: [] }],
      };
    }

    case "ws_event": {
      const evt = action.event;

      switch (evt.type) {
        case "message_received":
          return { ...state, isProcessing: true };

        case "stream_chunk_received": {
          const e = evt as unknown as { display_text: string };
          return { ...state, isStreaming: true, currentStream: e.display_text };
        }

        case "stream_completed": {
          const e = evt as StreamCompletedEvent;
          const assistantMsg: Message = {
            id: nextId(),
            role: "assistant",
            content: e.clean_text,
            timestamp: evt.timestamp ?? new Date().toISOString(),
          };
          return {
            ...state,
            isStreaming: false,
            currentStream: null,
            messages: [...state.messages, assistantMsg],
            stats: {
              ...state.stats,
              last_latency_ms: e.latency_ms,
              last_ttft_ms: e.ttft_ms,
              last_speed_tps: e.speed_tps,
              last_completion_tokens: e.completion_tokens,
            },
          };
        }

        case "graph_updated": {
          const e = evt as GraphUpdatedEvent;
          return {
            ...state,
            stats: { ...state.stats, node_count: e.node_count, edge_count: e.edge_count },
          };
        }

        case "turn_complete":
          return {
            ...state,
            isProcessing: false,
            stats: { ...state.stats, turns: state.stats.turns + 1 },
          };

        case "stats": {
          const e = evt as StatsEvent;
          return {
            ...state,
            stats: { ...state.stats, ...e },
          };
        }

        case "reset_complete":
          return { ...INITIAL_STATE, connected: state.connected };

        default: {
          // Add as pipeline step if not a skipped event
          if (SKIP_STEP_EVENTS.has(evt.type)) return state;

          const step: PipelineStep = {
            type: evt.type,
            label: getEventLabel(evt.type),
            detail: formatStepDetail(evt),
            timestamp: evt.timestamp ?? new Date().toISOString(),
          };

          const groups = [...state.pipelineSteps];
          if (groups.length > 0) {
            const last = { ...groups[groups.length - 1] };
            last.steps = [...last.steps, step];
            groups[groups.length - 1] = last;
          }
          return { ...state, pipelineSteps: groups };
        }
      }
    }

    case "reset":
      return { ...INITIAL_STATE, connected: state.connected };

    default:
      return state;
  }
}

function formatStepDetail(evt: WsEvent): string {
  const e = evt as unknown as Record<string, unknown>;
  switch (evt.type) {
    case "topic_detect_step":
      return `${e.verdict} (L${e.level}, conf=${(e.confidence as number)?.toFixed(2)})${e.current_topic ? ` topic="${e.current_topic}"` : ""}`;
    case "topic_changed":
      return `→ "${e.new_topic}"`;
    case "planner_decision":
      return `${e.tool} · ${e.entity}${e.query ? ` · "${e.query}"` : ""}`;
    case "acervo_decision":
      return `action=${e.action} context=${e.has_context ? "yes" : "no"}`;
    case "executor_result":
      return `${e.source}: ${e.node_count} nodes, ${e.fact_count} facts`;
    case "context_built":
      return `hot=${e.hot_tokens}tk warm=${e.warm_tokens}tk total=${e.total_tokens}tk`;
    case "extraction_completed":
      return (e.entities as [string, string][])?.map(([n, t]) => `${n} (${t})`).join(", ") || "none";
    case "graph_updated":
      return `${e.node_count} nodes, ${e.edge_count} edges`;
    case "pipeline_error":
      return `[${e.step}] ${e.error}`;
    case "fact_filtered":
      return `${e.entity}: "${e.fact}" (${e.reason})`;
    case "compaction_completed":
      return e.compacted ? `compacted (overflow: ${e.overflow_tokens}tk)` : "skipped";
    default:
      return "";
  }
}

// ── Hook ──

const WS_URL = "ws://localhost:8000/ws/chat";
const RECONNECT_DELAY = 1000;
const MAX_RETRIES = 5;

export function useWebSocket() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
      dispatch({ type: "connected" });
      // Request initial stats
      ws.send(JSON.stringify({ type: "get_stats" }));
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WsEvent;
        dispatch({ type: "ws_event", event });
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      dispatch({ type: "disconnected" });
      if (mountedRef.current && retriesRef.current < MAX_RETRIES) {
        retriesRef.current++;
        setTimeout(connect, RECONNECT_DELAY);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    dispatch({ type: "user_message", text });
    wsRef.current.send(JSON.stringify({ type: "message", text }));
  }, []);

  const resetSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    dispatch({ type: "reset" });
    wsRef.current.send(JSON.stringify({ type: "reset" }));
  }, []);

  return {
    ...state,
    sendMessage,
    resetSession,
  };
}
