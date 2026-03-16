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


# ── Step 3: LLM streaming ──

@dataclass(frozen=True)
class StreamStarted(PipelineEvent):
    model: str = ""
    history_len: int = 0
    temperature: float = 0.7


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


# ── Step 5: Graph persistence ──

@dataclass(frozen=True)
class GraphUpdated(PipelineEvent):
    node_count: int = 0
    edge_count: int = 0


# ── Debug ──

@dataclass(frozen=True)
class DebugInfo(PipelineEvent):
    message: str = ""


# ── Errors ──

@dataclass(frozen=True)
class PipelineError(PipelineEvent):
    step: str = ""
    error: str = ""
