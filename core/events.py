"""Typed pipeline events — the contract between core and TUI."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class PipelineEvent:
    """Base event. All events carry a timestamp."""
    timestamp: datetime = field(default_factory=datetime.now)


# ── Step 1: Message received ──

@dataclass(frozen=True)
class MessageReceived(PipelineEvent):
    user_text: str = ""
    msg_tokens: int = 0
    ctx_tokens: int = 0
    history_len: int = 0


# ── Step 2: Topic detection ──

@dataclass(frozen=True)
class TopicDetectStep(PipelineEvent):
    """Emitted for each sub-level of the detection cascade."""
    level: int = 0
    verdict: str = ""
    confidence: float = 0.0
    current_topic: str = ""
    # Optional detail fields depending on level
    keyword: str | None = None       # L1
    similarity: float | None = None  # L2
    answer: str | None = None        # L3
    detail: str = ""                 # human-readable extra info


@dataclass(frozen=True)
class TopicChanged(PipelineEvent):
    new_topic: str = ""
    previous_topic: str = ""


# ── Step 2.5: Pre-LLM routing ──

@dataclass(frozen=True)
class RouterDecision(PipelineEvent):
    route: str = "static"  # "static", "memory", "search", "ask"
    reason: str = ""


# ── Step 2.5: Query Planner ──

@dataclass(frozen=True)
class PlannerDecision(PipelineEvent):
    tool: str = ""  # GRAPH_ALL, GRAPH_SEARCH, VECTOR_SEARCH, WEB_SEARCH, READY
    entity: str = ""
    query: str = ""


# ── Step 2.5b: Acervo decision ──

@dataclass(frozen=True)
class AcervoDecision(PipelineEvent):
    has_context: bool = False    # graph had relevant data
    needs_tool: bool = False     # planner wants external tool
    action: str = ""             # "graph", "search", "ask_user", "no_data"


# ── Step 2.6: Executor ──

@dataclass(frozen=True)
class ExecutorResult(PipelineEvent):
    source: str = ""  # graph, vector, web, empty, ready, error
    node_count: int = 0
    fact_count: int = 0
    content_preview: str = ""  # first N chars of content for display
    error_msg: str = ""


# ── Step 2.6 (legacy): Synthesizer ──

@dataclass(frozen=True)
class SynthesizerOutput(PipelineEvent):
    hot_nodes: int = 0
    warm_nodes: int = 0
    output_tokens: int = 0


# ── Step 2.7: Context stack built ──

@dataclass(frozen=True)
class ContextBuilt(PipelineEvent):
    hot_messages: int = 0
    hot_tokens: int = 0
    warm_topic: str = ""
    warm_tokens: int = 0
    total_tokens: int = 0
    context_summary: str = ""  # human-readable summary of what's in the stack


# ── Step 3: LLM streaming ──

@dataclass(frozen=True)
class StreamStarted(PipelineEvent):
    model: str = ""
    provider: str = ""   # "lmstudio", "openrouter", etc.
    endpoint: str = ""   # "http://localhost:1234/v1"
    history_len: int = 0
    temperature: float = 0.7
    request_messages: str = ""  # JSON-serialized messages array (truncated for display)
    actual_llm_request: str = ""  # JSON from proxy: what the LLM actually received (full content)


@dataclass(frozen=True)
class StreamChunkReceived(PipelineEvent):
    display_text: str = ""


@dataclass(frozen=True)
class StreamCompleted(PipelineEvent):
    clean_text: str = ""
    completion_tokens: int = 0
    think_tokens: int = 0
    latency_ms: float = 0.0
    ttft_ms: float = 0.0
    speed_tps: float = 0.0
    chunk_count: int = 0


# ── Step 4: Entity extraction ──

@dataclass(frozen=True)
class ExtractionStarted(PipelineEvent):
    pass


@dataclass(frozen=True)
class ExtractionCompleted(PipelineEvent):
    entities: tuple = ()   # tuple of (name, type) pairs
    error: str | None = None


# ── Step 4.5: Fact filtering ──

@dataclass(frozen=True)
class FactFiltered(PipelineEvent):
    entity: str = ""
    fact: str = ""
    reason: str = ""  # "assistant_speaker" | "duplicate"


# ── Step 3.5: Compaction ──

@dataclass(frozen=True)
class CompactionCompleted(PipelineEvent):
    compacted: bool = False
    overflow_tokens: int = 0


# ── Step 5: Graph persistence ──

@dataclass(frozen=True)
class GraphUpdated(PipelineEvent):
    node_count: int = 0
    edge_count: int = 0


# ── Debug ──

@dataclass(frozen=True)
class DebugInfo(PipelineEvent):
    message: str = ""


# ── Confirmation ──

@dataclass(frozen=True)
class ConfirmationPending(PipelineEvent):
    entity: str = ""
    fact: str = ""

@dataclass(frozen=True)
class ConfirmationAccepted(PipelineEvent):
    entity: str = ""
    fact: str = ""


# ── Training ──

@dataclass(frozen=True)
class TrainingSampleSaved(PipelineEvent):
    sample_type: str = ""  # correction | confirmation | rejection
    entity: str = ""


# ── Tool use ──

@dataclass(frozen=True)
class ToolCallRequested(PipelineEvent):
    tool: str = ""
    arguments: str = ""  # JSON string of arguments

@dataclass(frozen=True)
class ToolCallCompleted(PipelineEvent):
    tool: str = ""
    arguments: str = ""  # JSON string of arguments
    result_preview: str = ""


# ── Acervo proxy ──

@dataclass(frozen=True)
class AcervoRequestSent(PipelineEvent):
    """Request routed through Acervo proxy."""
    proxy_url: str = ""
    message_count: int = 0


@dataclass(frozen=True)
class AcervoEnrichResult(PipelineEvent):
    """Enrichment result from Acervo proxy."""
    enriched: bool = False
    topic: str = ""
    warm_tokens: int = 0
    stages: tuple = ()  # human-readable stage logs from Acervo pipeline
    stage_data: str = ""  # JSON-encoded per-stage debug data from Acervo
    entities_extracted: int = 0
    facts_extracted: int = 0


# ── Conversational indexing ──

@dataclass(frozen=True)
class ConversationIndexed(PipelineEvent):
    """Post-LLM: knowledge extracted and persisted to graph."""
    topic: str = ""
    entities_extracted: int = 0
    facts_extracted: int = 0
    placeholder_promoted: bool = False
    source: str = ""       # "conversation" | "tool_result"
    verified: bool = False


# ── Errors ──

@dataclass(frozen=True)
class PipelineError(PipelineEvent):
    step: str = ""
    error: str = ""
