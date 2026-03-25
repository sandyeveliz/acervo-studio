"""Trace event store — persists pipeline events for frontend recovery.

Events are kept in memory for fast access and appended to a JSONL file
so they survive backend restarts. The store subscribes to PipelineEvent
via the EventBus and serializes each event automatically.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from core.event_bus import EventBus
from core.events import PipelineEvent, StreamChunkReceived
from api.serializers import serialize_event

logger = logging.getLogger(__name__)

# Events that are too chatty or ephemeral to persist
_SKIP_EVENTS = {"stream_chunk_received"}


class TraceStore:
    """In-memory + file-backed store for pipeline trace events."""

    def __init__(self, persist_path: Path | None = None) -> None:
        self._events: list[dict[str, Any]] = []
        self._turn: int = 0
        self._persist_path = persist_path
        if persist_path:
            self._load_from_disk()

    def subscribe(self, bus: EventBus) -> None:
        """Subscribe to all pipeline events on the given bus."""
        async def _on_event(event: PipelineEvent) -> None:
            self.add(event)
        _on_event._is_trace_handler = True  # type: ignore[attr-defined]
        # Remove any previous trace handler (e.g. from StrictMode double-mount)
        existing = bus._handlers.get(PipelineEvent, [])
        bus._handlers[PipelineEvent] = [
            h for h in existing if not getattr(h, "_is_trace_handler", False)
        ]
        bus.subscribe(PipelineEvent, _on_event)

    def add(self, event: PipelineEvent) -> None:
        """Serialize and store a pipeline event."""
        data = serialize_event(event)
        event_type = data.get("type", "")

        # Skip noisy events
        if event_type in _SKIP_EVENTS:
            return

        # Track turn number
        if event_type == "message_received":
            self._turn += 1
        data["turn"] = self._turn

        self._events.append(data)
        self._append_to_disk(data)

    def get_all(self) -> list[dict[str, Any]]:
        """Return all stored events."""
        return list(self._events)

    def clear(self) -> None:
        """Clear all events (memory + disk)."""
        self._events.clear()
        self._turn = 0
        if self._persist_path and self._persist_path.exists():
            self._persist_path.unlink()

    # ── Disk persistence ──

    def _append_to_disk(self, data: dict) -> None:
        if not self._persist_path:
            return
        try:
            self._persist_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._persist_path, "a", encoding="utf-8") as f:
                # Convert datetime objects to strings for JSON
                line = json.dumps(data, default=str, ensure_ascii=False)
                f.write(line + "\n")
        except Exception:
            pass  # Non-critical

    def _load_from_disk(self) -> None:
        if not self._persist_path or not self._persist_path.exists():
            return
        try:
            with open(self._persist_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        self._events.append(data)
                        # Track max turn
                        turn = data.get("turn", 0)
                        if turn > self._turn:
                            self._turn = turn
                    except json.JSONDecodeError:
                        continue
        except Exception:
            pass  # Non-critical
