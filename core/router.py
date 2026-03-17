"""Pre-LLM Router — decides what information the model needs before calling it.

Routes:
- static: model responds from base knowledge. No tools, no search.
- memory: graph traversal. Load warm context from known topics.
- search: web search first (future — returns static for now).
- ask: ask user for clarification (future — returns static for now).

The decision is made BEFORE the LLM call. The model only sees the result.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from memory.graph import TopicGraph, _make_id


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


def decide_route(user_msg: str, current_topic: str, graph: TopicGraph) -> tuple[Route, str]:
    """Decide the pre-LLM route based on message and graph state.

    Returns (route, reason) tuple.
    """
    if current_topic != "none":
        topic_id = _make_id(current_topic)
        node = graph._nodes.get(topic_id)

        # Topic exists with verified facts → use memory
        if node and node.get("facts"):
            return Route.MEMORY, f"topic '{current_topic}' has {len(node['facts'])} facts"

        # Check if any active nodes have facts
        active_nodes = [
            n for n in graph._nodes.values()
            if n.get("status") in ("hot", "warm") and n.get("facts")
        ]
        if active_nodes:
            return Route.MEMORY, f"{len(active_nodes)} active nodes with facts"

        # Topic exists but NO verified facts → ask user, don't guess
        if node:
            return Route.ASK, f"topic '{current_topic}' exists but has no verified facts"

    # Search-indicating patterns (future)
    if _SEARCH_PATTERNS.search(user_msg):
        return Route.STATIC, "search patterns detected (not yet implemented)"

    return Route.STATIC, "base knowledge"
