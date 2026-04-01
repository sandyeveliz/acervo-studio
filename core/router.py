"""Pre-LLM Router — decides what information the model needs before calling it.

Routes:
- static: model responds from base knowledge. No tools, no search.
- memory: graph traversal. Load warm context from known topics.
- search: web search first (future — returns static for now).
- ask: ask user for clarification (future — returns static for now).

The decision is made BEFORE the LLM call. The model only sees the result.

NOTE: This module is currently unused — routing is handled by the query planner
inside Acervo's prepare() pipeline. Kept for potential future use.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class Route(Enum):
    STATIC = "static"
    MEMORY = "memory"
    SEARCH = "search"
    ASK = "ask"


_SEARCH_PATTERNS = re.compile(
    r"hoy|ahora|actual|noticias|últim[oa]s?|reciente|"
    r"today|now|current|latest|news|recent",
    re.IGNORECASE,
)


def decide_route(user_msg: str, current_topic: str, memory=None) -> tuple[Route, str]:
    """Decide the pre-LLM route based on message and memory state.

    Args:
        memory: Acervo instance (optional). If None, always returns STATIC.

    Returns (route, reason) tuple.
    """
    if memory is None:
        return Route.STATIC, "no memory available"

    if current_topic != "none":
        node = memory.lookup_node(current_topic)

        # Topic exists with verified facts → use memory
        if node and node.get("facts"):
            return Route.MEMORY, f"topic '{current_topic}' has {len(node['facts'])} facts"

        # Check if any entity nodes have facts
        entity_nodes = [
            n for n in memory.graph.get_all_nodes()
            if n.get("kind", "entity") == "entity" and n.get("facts")
        ]
        if entity_nodes:
            return Route.MEMORY, f"{len(entity_nodes)} entity nodes with facts"

        # Topic exists but NO verified facts
        if node:
            return Route.ASK, f"topic '{current_topic}' exists but has no verified facts"

    # Search-indicating patterns (future)
    if _SEARCH_PATTERNS.search(user_msg):
        return Route.STATIC, "search patterns detected (not yet implemented)"

    return Route.STATIC, "base knowledge"
