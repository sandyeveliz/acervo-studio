"""Query Planner — uses LLM to decide what information is needed before responding.

Replaces the deterministic router with an agentic planner that reasons about
which tool to use: GRAPH_ALL, GRAPH_SEARCH, VECTOR_SEARCH, WEB_SEARCH, or READY.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from providers.base import ChatMessage
from providers.model_router import ModelRouter
from utils.text import strip_think_blocks

log = logging.getLogger(__name__)

_PLANNER_PROMPT = """Sos un planificador de búsqueda. Analizá la pregunta y decidí qué información necesitás.

Pregunta: {user_message}
Entidad principal: {entity_name} ({entity_type})
Hechos disponibles: {facts_summary}

Herramientas disponibles:
- GRAPH_ALL: traer todos los hechos y conexiones de una entidad
- GRAPH_SEARCH: buscar nodos por tipo dentro de una entidad (tipos: lugar, persona, entidad, actividad, evento)
- VECTOR_SEARCH: búsqueda semántica cuando no sabés el tipo exacto
- WEB_SEARCH: para datos que cambian (resultados, precios, noticias, fechas futuras)
- READY: tenés suficiente información para responder sin buscar más

Respondé SOLO con un JSON en una línea, sin explicación:
{{"tool": "NOMBRE", "entity": "nombre_entidad", "query": "texto de búsqueda o filtro"}}

Ejemplos:
- "qué sabés de Cipolletti?" → {{"tool": "GRAPH_ALL", "entity": "Cipolletti", "query": ""}}
- "qué fiestas hay en Cipolletti?" → {{"tool": "GRAPH_SEARCH", "entity": "Cipolletti", "query": "actividad|evento|fiesta"}}
- "cuándo es el próximo partido?" → {{"tool": "WEB_SEARCH", "entity": "Club Cipolletti", "query": "próximo partido Club Cipolletti"}}
- pregunta sin tema específico ("hola", "cómo estás") → {{"tool": "READY", "entity": "", "query": ""}}
Responder siempre en español. JSON:"""


@dataclass
class PlanResult:
    tool: str  # GRAPH_ALL, GRAPH_SEARCH, VECTOR_SEARCH, WEB_SEARCH, READY
    entity: str
    query: str

    VALID_TOOLS = frozenset({"GRAPH_ALL", "GRAPH_SEARCH", "VECTOR_SEARCH", "WEB_SEARCH", "READY"})


class QueryPlanner:
    """Uses LLM to plan what information to retrieve before responding."""

    def __init__(self, router: ModelRouter) -> None:
        self._router = router

    async def plan(
        self,
        user_message: str,
        entity_name: str,
        entity_type: str,
        facts_summary: str,
    ) -> PlanResult:
        """Ask the LLM what tool to use. Returns PlanResult."""
        try:
            return await self._call_llm(
                user_message, entity_name, entity_type, facts_summary,
            )
        except Exception as e:
            log.warning("Planner failed, falling back to GRAPH_ALL: %s", e)
            return PlanResult(
                tool="GRAPH_ALL",
                entity=entity_name or "",
                query="",
            )

    async def _call_llm(
        self,
        user_message: str,
        entity_name: str,
        entity_type: str,
        facts_summary: str,
    ) -> PlanResult:
        prompt = _PLANNER_PROMPT.format(
            user_message=user_message[:300],
            entity_name=entity_name or "ninguna",
            entity_type=entity_type or "desconocido",
            facts_summary=facts_summary[:500] if facts_summary else "ninguno",
        )

        response = await self._router.chat_utility(
            [ChatMessage(role="user", content=prompt)],
            temperature=0.0,
            max_tokens=100,
        )

        raw = strip_think_blocks(response.content).strip()
        # Strip code fences
        raw = re.sub(r"```(?:json)?\s*", "", raw).strip()

        return self._parse(raw, entity_name)

    @staticmethod
    def _parse(raw: str, fallback_entity: str) -> PlanResult:
        """Parse JSON response from LLM. Fallback to GRAPH_ALL on failure."""
        # Find first JSON object
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            log.warning("Planner: no JSON found in response: %s", raw[:100])
            return PlanResult(tool="GRAPH_ALL", entity=fallback_entity, query="")

        try:
            data = json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            log.warning("Planner: invalid JSON: %s", raw[:100])
            return PlanResult(tool="GRAPH_ALL", entity=fallback_entity, query="")

        tool = str(data.get("tool", "GRAPH_ALL")).upper()
        if tool not in PlanResult.VALID_TOOLS:
            tool = "GRAPH_ALL"

        return PlanResult(
            tool=tool,
            entity=str(data.get("entity", fallback_entity or "")),
            query=str(data.get("query", "")),
        )
