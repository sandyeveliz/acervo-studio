"""Telemetry collector — builds structured per-turn spans via EventBus.

Subscribes to PipelineEvent and collects timing/metric data per turn.
On turn completion (GraphUpdated), flushes one span to a JSONL file.
Periodically captures hardware snapshots (GPU/VRAM via nvidia-smi).
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from core.event_bus import EventBus
from core.events import (
    AcervoDecision,
    AcervoEnrichResult,
    ContextBuilt,
    ConversationIndexed,
    ExtractionCompleted,
    ExecutorResult,
    FactFiltered,
    GraphUpdated,
    MessageReceived,
    PipelineError,
    PipelineEvent,
    PlannerDecision,
    StreamCompleted,
    StreamStarted,
    TopicDetectStep,
)

log = logging.getLogger(__name__)

# Hardware snapshot interval
_HW_CACHE_TTL = 60.0  # seconds
_HW_TURN_INTERVAL = 5  # every N turns


class TelemetryCollector:
    """Collects pipeline telemetry spans per turn via EventBus subscription."""

    def __init__(
        self,
        persist_path: Path | None = None,
        session_id: str = "default",
        project: str | None = None,
    ) -> None:
        self._spans: list[dict[str, Any]] = []
        self._current: dict[str, Any] = {}
        self._persist_path = persist_path
        self._session_id = session_id
        self._project = project
        self._turn_count = 0
        self._prev_graph = (0, 0)  # (nodes, edges) for delta calc
        self._t0: float = 0.0  # perf_counter at turn start
        self._t_context: float = 0.0  # after context built
        self._t_stream: float = 0.0  # after stream completed
        # Hardware cache: (monotonic_time, data)
        self._hw_cache: tuple[float, dict] = (0.0, {})
        self._flush_timer: asyncio.TimerHandle | None = None
        if persist_path:
            self._load_from_disk()

    @property
    def project(self) -> str | None:
        return self._project

    @project.setter
    def project(self, value: str | None) -> None:
        self._project = value

    def subscribe(self, bus: EventBus) -> None:
        """Subscribe to all pipeline events on the given bus."""
        bus.subscribe(PipelineEvent, self._on_event)

    # ── Event handler ──

    def _on_event(self, event: PipelineEvent) -> None:
        """Route events to span fields."""

        if isinstance(event, MessageReceived):
            self._t0 = time.perf_counter()
            self._turn_count += 1
            self._current = {
                "turn_id": self._turn_count,
                "session_id": self._session_id,
                "project": self._project,
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "user_msg": event.user_text,
                "s1": {"intent": "", "topic": "", "confidence": 0.0, "latency_ms": 0, "ok": True},
                "s2": {"source": "", "nodes_activated": 0, "facts_found": 0, "latency_ms": 0, "ok": True},
                "s3": {"warm_tokens": 0, "hot_tokens": 0, "total_tokens": 0, "latency_ms": 0, "ok": True},
                "s15": {
                    "entities_created": 0,
                    "facts_created": 0,
                    "facts_filtered": [],
                    "latency_ms": 0,
                },
                "llm": {
                    "model": "",
                    "provider": "",
                    "latency_ms": 0,
                    "ttft_ms": 0,
                    "tokens_input": event.ctx_tokens,
                    "tokens_output": 0,
                    "think_tokens": 0,
                    "tokens_per_sec": 0.0,
                },
                "graph": {"node_count": 0, "edge_count": 0, "node_delta": 0, "edge_delta": 0},
                "failures": [],
            }

        elif isinstance(event, TopicDetectStep):
            if self._current:
                s1 = self._current["s1"]
                s1["topic"] = event.current_topic
                s1["confidence"] = round(event.confidence, 3)

        elif isinstance(event, PlannerDecision):
            if self._current:
                s1 = self._current["s1"]
                s1["intent"] = event.tool.lower()

        elif isinstance(event, AcervoDecision):
            if self._current:
                s1 = self._current["s1"]
                # Only set intent if planner didn't already set it
                if not s1["intent"]:
                    s1["intent"] = event.action

        elif isinstance(event, ExecutorResult):
            if self._current:
                s2 = self._current["s2"]
                s2["source"] = event.source
                s2["nodes_activated"] = event.node_count
                s2["facts_found"] = event.fact_count
                if event.source == "error":
                    s2["ok"] = False

        elif isinstance(event, ContextBuilt):
            if self._current:
                self._t_context = time.perf_counter()
                s3 = self._current["s3"]
                s3["warm_tokens"] = event.warm_tokens
                s3["hot_tokens"] = event.hot_tokens
                s3["total_tokens"] = event.total_tokens
                s3["latency_ms"] = round((self._t_context - self._t0) * 1000)
                # S1 latency = same as context build (topic detection happens during context phase)
                self._current["s1"]["latency_ms"] = s3["latency_ms"]

        elif isinstance(event, AcervoEnrichResult):
            if self._current:
                s15 = self._current["s15"]
                s15["entities_created"] += event.entities_extracted
                s15["facts_created"] += event.facts_extracted
                # Enrich S1 data from proxy's stage_data (S1 runs inside proxy)
                if event.stage_data:
                    try:
                        debug = json.loads(event.stage_data) if isinstance(event.stage_data, str) else event.stage_data
                        s1_det = debug.get("s1_detection", {})
                        if s1_det:
                            s1 = self._current["s1"]
                            s1["intent"] = s1_det.get("intent", s1["intent"])
                            s1["topic"] = s1_det.get("current_topic", s1["topic"])
                            s1["confidence"] = s1_det.get("hint_similarity", s1["confidence"]) or 0
                            s1["ok"] = s1_det.get("entities_extracted", 0) > 0 or s1_det.get("intent", "") != ""
                        s1_ms = debug.get("s1_latency_ms")
                        if s1_ms:
                            self._current["s1"]["latency_ms"] = s1_ms
                        # Override S3 data from proxy (proxy injects warm, Studio doesn't see it)
                        s3_ctx = debug.get("s3_context", {})
                        if s3_ctx:
                            s3 = self._current["s3"]
                            if s3_ctx.get("warm_tokens", 0) > s3["warm_tokens"]:
                                s3["warm_tokens"] = s3_ctx["warm_tokens"]
                                s3["total_tokens"] = s3_ctx.get("total_tokens", s3["total_tokens"])
                                s3["ok"] = s3_ctx.get("has_context", s3["ok"])
                        # Override S2 data from proxy
                        s2_gath = debug.get("s2_gathered", {})
                        if s2_gath:
                            s2 = self._current["s2"]
                            s2["nodes_activated"] = s2_gath.get("nodes_total", s2["nodes_activated"])
                        # Store stage_data reference for later retrieval
                        self._current["_stage_data"] = event.stage_data
                    except (json.JSONDecodeError, TypeError):
                        pass

        elif isinstance(event, StreamStarted):
            if self._current:
                llm = self._current["llm"]
                llm["model"] = event.model
                llm["provider"] = event.provider

        elif isinstance(event, StreamCompleted):
            if self._current:
                self._t_stream = time.perf_counter()
                llm = self._current["llm"]
                llm["latency_ms"] = round(event.latency_ms)
                llm["ttft_ms"] = round(event.ttft_ms)
                llm["tokens_output"] = event.completion_tokens
                llm["think_tokens"] = event.think_tokens
                llm["tokens_per_sec"] = round(event.speed_tps, 1)
                # When proxy handles extraction, GraphUpdated never fires.
                # Schedule a delayed flush — if GraphUpdated arrives first, it cancels this.
                self._schedule_flush()

        elif isinstance(event, ExtractionCompleted):
            if self._current:
                s15 = self._current["s15"]
                s15["entities_created"] += len(event.entities)
                if event.error:
                    self._current["failures"].append(f"extraction: {event.error}")

        elif isinstance(event, FactFiltered):
            if self._current:
                self._current["s15"]["facts_filtered"].append({
                    "entity": event.entity,
                    "fact": event.fact,
                    "reason": event.reason,
                })

        elif isinstance(event, ConversationIndexed):
            if self._current:
                s15 = self._current["s15"]
                s15["facts_created"] += event.facts_extracted

        elif isinstance(event, GraphUpdated):
            if self._current:
                # Cancel delayed flush — we have real graph data
                self._cancel_scheduled_flush()

                g = self._current["graph"]
                g["node_count"] = event.node_count
                g["edge_count"] = event.edge_count
                g["node_delta"] = event.node_count - self._prev_graph[0]
                g["edge_delta"] = event.edge_count - self._prev_graph[1]
                self._prev_graph = (event.node_count, event.edge_count)

                # S15 latency = time from stream end to now
                if self._t_stream > 0:
                    self._current["s15"]["latency_ms"] = round(
                        (time.perf_counter() - self._t_stream) * 1000
                    )

                # S2 latency = approximate (between context and stream start)
                # Not precisely measurable from events alone, set to 0

                # Hardware snapshot every N turns
                if self._turn_count % _HW_TURN_INTERVAL == 0:
                    hw = self._get_hardware_sync()
                    if hw:
                        self._current["hardware"] = hw

                # GraphUpdated is the last event — flush
                self._flush()

        elif isinstance(event, PipelineError):
            if self._current:
                self._current["failures"].append(f"{event.step}: {event.error}")
                self._current.get("s1", {})["ok"] = False

    # ── Flush scheduling ──

    def _schedule_flush(self) -> None:
        """Schedule a flush after 2s — gives GraphUpdated time to arrive."""
        self._cancel_scheduled_flush()
        try:
            loop = asyncio.get_running_loop()
            self._flush_timer = loop.call_later(2.0, self._delayed_flush)
        except RuntimeError:
            # No event loop — flush immediately (e.g. during tests)
            self._flush()

    def _cancel_scheduled_flush(self) -> None:
        if self._flush_timer is not None:
            self._flush_timer.cancel()
            self._flush_timer = None

    def _delayed_flush(self) -> None:
        """Called by timer — flush if GraphUpdated hasn't arrived yet."""
        self._flush_timer = None
        if self._current:
            self._flush()

    # ── Public API ──

    def get_spans(self, last: int | None = None) -> list[dict[str, Any]]:
        """Return collected spans, optionally the last N."""
        if last and last > 0:
            return self._spans[-last:]
        return list(self._spans)

    async def get_hardware_info(self) -> dict[str, Any] | None:
        """Get current hardware status (cached)."""
        now = time.monotonic()
        if now - self._hw_cache[0] < _HW_CACHE_TTL and self._hw_cache[1]:
            return self._hw_cache[1]

        hw = await asyncio.to_thread(self._get_hardware_sync)
        if hw:
            self._hw_cache = (now, hw)
        return hw

    # ── Hardware monitoring ──

    def _get_hardware_sync(self) -> dict[str, Any]:
        """Query nvidia-smi for GPU stats. Returns empty dict on failure."""
        result: dict[str, Any] = {
            "vram_used_mb": 0,
            "vram_total_mb": 0,
            "gpu_util_pct": 0,
            "model_loaded": False,
        }

        nvidia_smi = shutil.which("nvidia-smi")
        if not nvidia_smi:
            return result

        try:
            proc = subprocess.run(
                [nvidia_smi,
                 "--query-gpu=memory.used,memory.total,utilization.gpu",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            if proc.returncode == 0:
                parts = proc.stdout.strip().split(", ")
                if len(parts) >= 3:
                    result["vram_used_mb"] = int(parts[0].strip())
                    result["vram_total_mb"] = int(parts[1].strip())
                    result["gpu_util_pct"] = int(parts[2].strip())
        except Exception:
            pass

        return result

    # ── Persistence ──

    def _flush(self) -> None:
        """Append the completed span to memory and disk."""
        if not self._current:
            return

        span = self._current
        self._current = {}
        self._spans.append(span)

        if self._persist_path:
            try:
                self._persist_path.parent.mkdir(parents=True, exist_ok=True)
                with open(self._persist_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(span, ensure_ascii=False, default=str) + "\n")
            except Exception as e:
                log.warning("Failed to write telemetry span: %s", e)

    def _load_from_disk(self) -> None:
        """Load existing spans from JSONL on startup."""
        if not self._persist_path or not self._persist_path.exists():
            return
        try:
            with open(self._persist_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        span = json.loads(line)
                        self._spans.append(span)
                        # Track turn count and graph state
                        turn = span.get("turn_id", 0)
                        if turn > self._turn_count:
                            self._turn_count = turn
                        g = span.get("graph", {})
                        nc = g.get("node_count", 0)
                        ec = g.get("edge_count", 0)
                        if nc or ec:
                            self._prev_graph = (nc, ec)
                    except json.JSONDecodeError:
                        continue
        except Exception:
            pass
