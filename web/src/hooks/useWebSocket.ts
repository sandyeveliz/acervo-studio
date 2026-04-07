import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  Message,
  PipelineStep,
  SessionStats,
  StepGroup,
  WsEvent,
  StreamCompletedEvent,
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

interface TraceEvent {
  type: string;
  timestamp: string;
  turn: number;
  [key: string]: unknown;
}

type Action =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "user_message"; text: string }
  | { type: "ws_event"; event: WsEvent }
  | { type: "trace_restore"; events: TraceEvent[] }
  | { type: "set_messages"; messages: Message[] }
  | { type: "reset" };

let _nextId = 0;
function nextId(): string {
  return `msg_${++_nextId}`;
}

// Events to skip in the pipeline step display
const SKIP_STEP_EVENTS = new Set([
  "stream_chunk_received",
  "turn_complete",
  "reset_complete",
  "stats",
  "error",
  "session_switched",
  "history_sync",
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

        case "pipeline_error": {
          const pe = evt as unknown as { step: string; error: string };
          const errorMsg: Message = {
            id: nextId(),
            role: "error",
            content: pe.error,
            timestamp: evt.timestamp ?? new Date().toISOString(),
          };
          return {
            ...state,
            isStreaming: false,
            currentStream: null,
            messages: [...state.messages, errorMsg],
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

        case "history_sync": {
          // Restore conversation history from the backend
          const e = evt as unknown as { messages: { role: string; content: string }[] };
          const restored: Message[] = [];
          const restoredGroups: StepGroup[] = [];
          for (const m of e.messages) {
            restored.push({
              id: nextId(),
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: new Date().toISOString(),
            });
            // Create an empty step group for each user message
            if (m.role === "user") {
              restoredGroups.push({ turnId: `turn_${_nextId}`, steps: [] });
            }
          }
          return {
            ...state,
            messages: restored,
            pipelineSteps: restoredGroups,
          };
        }

        case "reset_complete":
          return { ...INITIAL_STATE, connected: state.connected };

        case "context_built": {
          const cb = evt as unknown as Record<string, unknown>;
          const { type: _ct, timestamp: _cts, ...cbRaw } = cb;
          const cbStep: PipelineStep = {
            type: evt.type,
            label: getEventLabel(evt.type),
            detail: formatStepDetail(evt),
            timestamp: evt.timestamp ?? new Date().toISOString(),
            raw: cbRaw as Record<string, unknown>,
          };
          const cbGroups = [...state.pipelineSteps];
          if (cbGroups.length > 0) {
            const cbLast = { ...cbGroups[cbGroups.length - 1] };
            cbLast.steps = [...cbLast.steps, cbStep];
            cbGroups[cbGroups.length - 1] = cbLast;
          }
          return {
            ...state,
            pipelineSteps: cbGroups,
            stats: {
              ...state.stats,
              last_context: {
                hot_messages: cb.hot_messages as number,
                hot_tokens: cb.hot_tokens as number,
                warm_tokens: cb.warm_tokens as number,
                total_tokens: cb.total_tokens as number,
              },
            },
          };
        }

        default: {
          // Add as pipeline step if not a skipped event
          if (SKIP_STEP_EVENTS.has(evt.type)) return state;

          const { type: _t, timestamp: _ts, ...rawFields } = evt as Record<string, unknown>;
          const step: PipelineStep = {
            type: evt.type,
            label: getEventLabel(evt.type),
            detail: formatStepDetail(evt),
            timestamp: evt.timestamp ?? new Date().toISOString(),
            raw: rawFields as Record<string, unknown>,
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

    case "trace_restore": {
      // Rebuild pipeline step groups from persisted trace events.
      // Events are grouped by turn number, matching the step groups
      // created during history_sync.
      const groups = [...state.pipelineSteps];
      for (const evt of action.events) {
        const evtType = evt.type;
        if (SKIP_STEP_EVENTS.has(evtType)) continue;

        const { type: _t, timestamp: _ts, turn: _turn, ...rawFields } = evt;
        const step: PipelineStep = {
          type: evtType,
          label: getEventLabel(evtType),
          detail: formatStepDetail(evt as unknown as WsEvent),
          timestamp: evt.timestamp ?? new Date().toISOString(),
          raw: rawFields as Record<string, unknown>,
        };

        // Map turn number (1-based) to group index (0-based)
        const groupIdx = (evt.turn || 1) - 1;
        // Create missing groups if trace has more turns than history
        while (groupIdx >= groups.length) {
          groups.push({ turnId: `turn_restored_${groups.length}`, steps: [] });
        }
        const group = { ...groups[groupIdx] };
        group.steps = [...group.steps, step];
        groups[groupIdx] = group;
      }
      return { ...state, pipelineSteps: groups };
    }

    case "set_messages":
      return { ...state, messages: action.messages };

    case "reset":
      return { ...INITIAL_STATE, connected: state.connected };

    default:
      return state;
  }
}

function formatStepDetail(evt: WsEvent): string {
  const e = evt as unknown as Record<string, unknown>;
  switch (evt.type) {
    case "message_received": {
      const tk = e.msg_tokens as number | undefined;
      return tk ? `${tk}tk message, ${e.history_len} messages in history` : "";
    }
    case "context_built": {
      const total = e.total_tokens as number;
      const warm = e.warm_topic as string;
      if (warm) return `${total}tk sent to proxy for enrichment`;
      return `${total}tk context prepared (${e.hot_messages} messages)`;
    }
    case "acervo_request_sent":
      return `${e.message_count} messages routed to Acervo proxy`;
    case "acervo_enrich_result": {
      if (e.enriched) {
        return `+${e.warm_tokens}tk from memory, topic: "${e.topic}"`;
      }
      return e.topic
        ? `No context found for "${e.topic}" — LLM will use general knowledge`
        : "No context injected — LLM will use general knowledge";
    }
    case "stream_started": {
      const tk = e.history_len as number;
      return `${tk} messages, temp=${e.temperature}`;
    }
    case "stream_completed": {
      const tokens = e.completion_tokens as number;
      const speed = (e.speed_tps as number)?.toFixed(1);
      const latency = ((e.latency_ms as number) / 1000).toFixed(1);
      return `${tokens} tokens in ${latency}s (${speed} t/s)`;
    }
    case "tool_call_requested":
      return `LLM calling ${e.tool}`;
    case "tool_call_completed": {
      const preview = (e.result_preview as string) ?? "";
      const short = preview.length > 80 ? preview.slice(0, 80) + "..." : preview;
      return `${e.tool} returned: ${short}`;
    }
    case "conversation_indexed": {
      const ent = e.entities_extracted as number;
      const facts = e.facts_extracted as number;
      if (ent === 0 && facts === 0) return "No new knowledge in response — graph unchanged";
      return `Extracted ${ent} entities, ${facts} facts`;
    }
    case "pipeline_error":
      return `${e.error}`;
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
        // After history_sync restores messages, fetch stored trace events
        if (event.type === "history_sync") {
          fetch("http://localhost:8000/api/trace")
            .then((r) => r.json())
            .then((data) => {
              if (data.events?.length > 0) {
                dispatch({ type: "trace_restore", events: data.events });
              }
            })
            .catch(() => {});
        }
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

  const requestStats = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "get_stats" }));
  }, []);

  const retryLast = useCallback(() => {
    // Find the last user message before the error
    const msgs = state.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        // Remove the error message(s) after it
        const cleaned = msgs.slice(0, i + 1);
        dispatch({ type: "set_messages", messages: cleaned });
        // Re-send the user message
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "message", text: msgs[i].content }));
        }
        return;
      }
    }
  }, [state.messages]);

  return {
    ...state,
    sendMessage,
    resetSession,
    requestStats,
    retryLast,
  };
}
