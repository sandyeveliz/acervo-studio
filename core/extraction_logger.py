"""Extraction logger — logs every graph mutation as a JSONL event.

Subscribes to pipeline events and writes granular extraction events
to .acervo/data/extraction_log.jsonl for the Graph quality analysis UI.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from core.event_bus import EventBus
from core.events import (
    AcervoEnrichResult,
    ConversationIndexed,
    ExtractionCompleted,
    GraphUpdated,
    MessageReceived,
    PipelineEvent,
)

log = logging.getLogger(__name__)


class ExtractionLogger:
    """Logs extraction events to a JSONL file for graph quality analysis."""

    def __init__(self, log_path: Path) -> None:
        self._path = log_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._turn_count = 0
        self._user_message = ""

    def subscribe(self, bus: EventBus) -> None:
        bus.subscribe(PipelineEvent, self._on_event)

    def _on_event(self, event: PipelineEvent) -> None:
        if isinstance(event, MessageReceived):
            self._turn_count += 1
            self._user_message = event.user_text[:80]

        elif isinstance(event, ExtractionCompleted):
            if event.entities:
                for name, etype in event.entities:
                    self._write({
                        "component": "CE",
                        "action": "created_node",
                        "node_label": name,
                        "node_type": etype,
                        "source": "conversation",
                    })

        elif isinstance(event, ConversationIndexed):
            self._write({
                "component": "CE",
                "action": "enriched_node",
                "node_label": event.topic,
                "node_type": None,
                "source": event.source,
                "details": {
                    "entities_extracted": event.entities_extracted,
                    "facts_extracted": event.facts_extracted,
                    "verified": event.verified,
                },
            })

        elif isinstance(event, AcervoEnrichResult):
            if event.entities_extracted > 0:
                self._write({
                    "component": "CE",
                    "action": "enriched_batch",
                    "node_label": event.topic,
                    "node_type": None,
                    "source": "acervo_proxy",
                    "details": {
                        "entities": event.entities_extracted,
                        "facts": event.facts_extracted,
                        "stages": list(event.stages),
                    },
                })

        elif isinstance(event, GraphUpdated):
            self._write({
                "component": "SYS",
                "action": "graph_snapshot",
                "node_label": "",
                "node_type": None,
                "source": "system",
                "details": {
                    "node_count": event.node_count,
                    "edge_count": event.edge_count,
                },
            })

    def _write(self, data: dict[str, Any]) -> None:
        entry = {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "turn": self._turn_count,
            "user_message_preview": self._user_message,
            **data,
        }
        try:
            with open(self._path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            log.debug("Failed to write extraction log: %s", e)
