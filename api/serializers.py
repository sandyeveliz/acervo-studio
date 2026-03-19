"""Serialize PipelineEvent dataclasses to JSON-friendly dicts."""

from __future__ import annotations

import re
import time
from dataclasses import asdict
from datetime import datetime
from typing import Any

from core.events import PipelineEvent, StreamChunkReceived

_CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")


def _to_snake(name: str) -> str:
    return _CAMEL_RE.sub("_", name).lower()


def serialize_event(event: PipelineEvent) -> dict[str, Any]:
    """Convert a PipelineEvent to a JSON-serializable dict with a `type` field."""
    data = asdict(event)

    # Convert datetime to ISO string
    for key, value in data.items():
        if isinstance(value, datetime):
            data[key] = value.isoformat()

    # Add type field from class name
    data["type"] = _to_snake(type(event).__name__)

    return data


class StreamThrottle:
    """Throttle stream_chunk sends to avoid backpressure."""

    def __init__(self, min_interval_ms: float = 30.0) -> None:
        self._min_interval = min_interval_ms / 1000.0
        self._last_send = 0.0

    def should_send(self, event: PipelineEvent) -> bool:
        """Return True if this event should be sent (not throttled)."""
        if not isinstance(event, StreamChunkReceived):
            return True
        now = time.monotonic()
        if now - self._last_send >= self._min_interval:
            self._last_send = now
            return True
        return False

    def reset(self) -> None:
        self._last_send = 0.0
