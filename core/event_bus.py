"""Async event bus — decouples pipeline from TUI."""

from __future__ import annotations

import asyncio
from typing import Any, Callable, Type

from core.events import PipelineEvent

EventHandler = Callable[[PipelineEvent], Any]


class EventBus:
    """Minimal pub/sub. Handlers can be sync or async."""

    def __init__(self) -> None:
        self._handlers: dict[Type[PipelineEvent], list[EventHandler]] = {}

    def subscribe(self, event_type: Type[PipelineEvent], handler: EventHandler) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    async def emit(self, event: PipelineEvent) -> None:
        """Emit an event to all subscribers of its type + base type."""
        for handler in self._handlers.get(type(event), []):
            result = handler(event)
            if asyncio.iscoroutine(result):
                await result

        # Fire catch-all handlers registered on PipelineEvent base
        if type(event) is not PipelineEvent:
            for handler in self._handlers.get(PipelineEvent, []):
                result = handler(event)
                if asyncio.iscoroutine(result):
                    await result
