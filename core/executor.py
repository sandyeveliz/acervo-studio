"""Plan Executor — executes web search via MCP.

Simplified after Acervo decoupling: graph operations are handled by the
Acervo proxy. This module only handles MCP web search fallback.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    content: str  # Text to inject as warm layer
    source: str  # web, empty, error
    node_count: int = 0
    fact_count: int = 0
    error_msg: str = ""


class PlanExecutor:
    """Executes web search via MCP. Never fails — returns empty on error."""

    def __init__(self, mcp=None) -> None:
        self._mcp = mcp

    async def web_search(self, query: str) -> ExecutionResult:
        """Web search via MCP server."""
        if not self._mcp or not self._mcp.has_servers:
            log.info("WEB_SEARCH: no MCP servers configured, query: %s", query)
            return ExecutionResult(content="", source="empty")

        if not query:
            return ExecutionResult(content="", source="empty")

        log.info("WEB_SEARCH: searching via MCP for '%s'", query)
        try:
            content = await self._mcp.search_web(query)
        except Exception as e:
            log.error("WEB_SEARCH error: %s", e)
            return ExecutionResult(content="", source="error", error_msg=str(e))

        if not content:
            log.info("WEB_SEARCH: no results from MCP")
            return ExecutionResult(content="", source="empty")

        result_count = content.count("\n\n")
        return ExecutionResult(
            content=content,
            source="web",
            node_count=result_count,
            fact_count=0,
        )
