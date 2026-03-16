"""Entity extractor — pure async service, no TUI dependency.

Call `await extractor.extract(user_msg, assistant_msg)` and get entities back.
No callbacks, no side effects, no threading.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from providers.model_router import ModelRouter
from utils.text import strip_think_blocks

log = logging.getLogger(__name__)

_EXTRACT_PROMPT = """Extract named entities as JSON. Types: lugar, persona, entidad, actividad.

User: hablemos de River Plate y Gallardo
Assistant: River Plate es un club de fútbol de Buenos Aires dirigido por Gallardo.
JSON: [{{"name":"River Plate","type":"entidad"}},{{"name":"Gallardo","type":"persona"}},{{"name":"Buenos Aires","type":"lugar"}},{{"name":"fútbol","type":"actividad"}}]

User: qué onda el clima hoy?
Assistant: Hoy está soleado y templado.
JSON: []

User: {user_msg}
Assistant: {assistant_msg}
JSON:"""


@dataclass
class Entity:
    """A single extracted entity."""
    name: str
    type: str  # "lugar" | "persona" | "entidad" | "actividad"


class EntityExtractor:
    """Extracts entities from conversation turns.

    Pure async service. No App dependency, no callbacks, no fire-and-forget.
    The pipeline calls extract() and awaits the result.
    """

    VALID_TYPES = frozenset(("lugar", "persona", "entidad", "actividad"))

    def __init__(self, router: ModelRouter) -> None:
        self._router = router

    async def extract(self, user_msg: str, assistant_msg: str) -> list[Entity]:
        """Extract entities from a turn. Returns empty list on failure."""
        try:
            return await self._call_llm(user_msg, assistant_msg)
        except Exception as e:
            log.warning("Entity extraction failed: %s", e)
            return []

    @staticmethod
    def _parse_first_json_array(text: str) -> list[dict] | None:
        """Find and parse the first JSON array in the text."""
        start = text.find("[")
        if start == -1:
            return None

        # Find matching closing bracket by counting nesting
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "[":
                depth += 1
            elif text[i] == "]":
                depth -= 1
                if depth == 0:
                    try:
                        data = json.loads(text[start:i + 1])
                        if isinstance(data, list):
                            return data
                    except json.JSONDecodeError:
                        return None
        return None

    async def _call_llm(self, user_msg: str, assistant_msg: str) -> list[Entity]:
        from providers.base import ChatMessage

        prompt = _EXTRACT_PROMPT.format(
            user_msg=user_msg[:500],
            assistant_msg=assistant_msg[:500],
        )

        response = await self._router.chat_utility(
            [ChatMessage(role="user", content=prompt)],
            temperature=0.0,
            max_tokens=300,
        )

        raw = strip_think_blocks(response.content).strip()
        # Strip markdown code fences
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip()

        # Extract the FIRST valid JSON array from the response
        data = self._parse_first_json_array(raw)
        if data is None:
            return []

        entities = []
        for item in data:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            etype = str(item.get("type", "")).strip().lower()
            if name and etype in self.VALID_TYPES:
                entities.append(Entity(name=name, type=etype))

        return entities
