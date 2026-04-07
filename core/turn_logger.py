"""Turn logger — persists a structured JSONL record per pipeline turn.

Subscribes to the EventBus and collects events as they arrive.
On turn completion, flushes one JSON line with the full turn summary.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from core.event_bus import EventBus
from core.events import (
    AcervoDecision,
    ContextBuilt,
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


class TurnLogger:
    """Collects pipeline events per turn, writes JSONL on turn completion."""

    def __init__(self, session_name: str, log_path: str | Path) -> None:
        self._session = session_name
        self._path = Path(log_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._turn_count = self._count_existing_turns()
        self._current: dict[str, Any] = {}
        self._flush_timer: asyncio.TimerHandle | None = None

    def subscribe(self, bus: EventBus) -> None:
        """Subscribe to all pipeline events on the given bus."""
        bus.subscribe(PipelineEvent, self._on_event)

    def _count_existing_turns(self) -> int:
        """Count existing turn records so numbering continues."""
        if not self._path.exists():
            return 0
        count = 0
        with open(self._path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    count += 1
        return count

    def _on_event(self, event: PipelineEvent) -> None:
        """Collect event data into the current turn dict."""

        if isinstance(event, MessageReceived):
            # Start a new turn
            self._current = {
                "turn": self._turn_count + 1,
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "session": self._session,
                "user_input": event.user_text,
                "msg_tokens": event.msg_tokens,
                "history_len": event.history_len,
            }

        elif isinstance(event, TopicDetectStep):
            self._current["topic"] = event.current_topic
            self._current["topic_confidence"] = event.confidence

        elif isinstance(event, PlannerDecision):
            self._current["planner"] = {
                "tool": event.tool,
                "entity": event.entity,
                "query": event.query,
            }

        elif isinstance(event, AcervoDecision):
            self._current["decision"] = {
                "action": event.action,
                "has_context": event.has_context,
            }

        elif isinstance(event, ExecutorResult):
            self._current["executor"] = {
                "source": event.source,
                "node_count": event.node_count,
                "fact_count": event.fact_count,
            }

        elif isinstance(event, ContextBuilt):
            self._current["context"] = {
                "hot_messages": event.hot_messages,
                "hot_tokens": event.hot_tokens,
                "warm_tokens": event.warm_tokens,
                "total_tokens": event.total_tokens,
                "warm_topic": event.warm_topic,
            }

        elif isinstance(event, StreamStarted):
            self._current.setdefault("llm", {})["model"] = event.model
            self._current["llm"]["skipped"] = "(skipped" in event.model

        elif isinstance(event, StreamCompleted):
            llm = self._current.setdefault("llm", {})
            llm["completion_tokens"] = event.completion_tokens
            llm["think_tokens"] = event.think_tokens
            llm["latency_ms"] = round(event.latency_ms, 1)
            llm["ttft_ms"] = round(event.ttft_ms, 1)
            llm["speed_tps"] = round(event.speed_tps, 1)
            self._current["assistant_response"] = event.clean_text
            # When proxy handles extraction, GraphUpdated never fires — schedule flush
            self._schedule_flush()

        elif isinstance(event, ExtractionCompleted):
            self._current["extraction"] = {
                "entities": list(event.entities),
                "error": event.error,
            }

        elif isinstance(event, FactFiltered):
            facts = self._current.setdefault("facts_filtered", [])
            facts.append({"entity": event.entity, "fact": event.fact, "reason": event.reason})

        elif isinstance(event, GraphUpdated):
            self._cancel_scheduled_flush()
            self._current["graph_after"] = {
                "node_count": event.node_count,
                "edge_count": event.edge_count,
            }
            # GraphUpdated is the last meaningful event in a turn — flush
            self._flush()

        elif isinstance(event, PipelineError):
            self._current.setdefault("errors", []).append({
                "step": event.step,
                "error": event.error,
            })

    def _schedule_flush(self) -> None:
        """Schedule a flush after 2s — gives GraphUpdated time to arrive."""
        self._cancel_scheduled_flush()
        try:
            loop = asyncio.get_running_loop()
            self._flush_timer = loop.call_later(2.0, self._flush)
        except RuntimeError:
            self._flush()

    def _cancel_scheduled_flush(self) -> None:
        if self._flush_timer is not None:
            self._flush_timer.cancel()
            self._flush_timer = None

    def _flush(self) -> None:
        """Write the current turn as one JSONL line."""
        if not self._current:
            return

        self._turn_count += 1
        try:
            with open(self._path, "a", encoding="utf-8") as f:
                f.write(json.dumps(self._current, ensure_ascii=False) + "\n")
        except Exception as e:
            log.warning("Failed to write turn log: %s", e)

        self._current = {}

    def read_turns(self, last: int | None = None) -> list[dict]:
        """Read turn records from the log file."""
        if not self._path.exists():
            return []

        turns = []
        with open(self._path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        turns.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue

        if last and last > 0:
            turns = turns[-last:]
        return turns
