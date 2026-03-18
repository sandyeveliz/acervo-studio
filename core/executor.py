"""Plan Executor — executes the planner's decision against the graph.

Takes a PlanResult and returns content to inject into the context stack.
Has automatic fallback: GRAPH_SEARCH → VECTOR_SEARCH, etc.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from acervo.synthesizer import synthesize, _render_node, _get_neighbor_ids, _find_user_identity
from core.query_planner import PlanResult
from acervo.graph import TopicGraph, _make_id

log = logging.getLogger(__name__)


@dataclass
class ExecutionResult:
    content: str  # Text to inject as warm layer
    source: str  # graph, vector, web, empty, ready, error
    node_count: int = 0
    fact_count: int = 0
    error_msg: str = ""


class PlanExecutor:
    """Executes a PlanResult against the graph. Never fails — returns empty on error."""

    def __init__(
        self,
        graph: TopicGraph,
        mcp=None,
    ) -> None:
        self._graph = graph
        self._mcp = mcp  # MCPManager or None

    async def execute(self, plan: PlanResult) -> ExecutionResult:
        """Execute the plan. Returns content for the context stack."""
        try:
            if plan.tool == "READY":
                return self._exec_ready()
            elif plan.tool == "GRAPH_ALL":
                return self._exec_graph_all(plan.entity)
            elif plan.tool == "GRAPH_SEARCH":
                return self._exec_graph_search(plan.entity, plan.query)
            elif plan.tool == "VECTOR_SEARCH":
                return self._exec_vector_search(plan.query)
            elif plan.tool == "WEB_SEARCH":
                return await self._exec_web_search(plan.entity, plan.query)
            else:
                log.warning("Unknown tool: %s, falling back to GRAPH_ALL", plan.tool)
                return self._exec_graph_all(plan.entity)
        except Exception as e:
            log.error("Executor error: %s", e)
            return ExecutionResult(content="", source="error", error_msg=str(e))

    def _exec_ready(self) -> ExecutionResult:
        """No search needed — use identity context only."""
        identity = _find_user_identity(self._graph)
        content = ""
        if identity:
            content = f"Nota: en sesiones anteriores el usuario se identifico como {identity}."
        return ExecutionResult(content=content, source="ready")

    def _exec_graph_all(self, entity: str) -> ExecutionResult:
        """Bring the entity node + all 1-level neighbors with facts."""
        nid = _make_id(entity) if entity else ""
        node = self._graph.get_node(nid) if nid else None

        if not node:
            # Try fuzzy match — find a node whose label contains the entity
            for n in self._graph.get_all_nodes():
                if entity.lower() in n.get("label", "").lower():
                    node = n
                    nid = n["id"]
                    break

        if not node:
            log.info("GRAPH_ALL: entity '%s' not found in graph", entity)
            return ExecutionResult(content="", source="empty")

        # Activate the node as hot for synthesizer
        self._graph.set_node_status(nid, "hot")

        # Use synthesize() which handles hot nodes + neighbor traversal
        content = synthesize(self._graph, entity)
        node_count = content.count("# ") if content else 0
        fact_count = content.count("- ") if content else 0

        if not content:
            return ExecutionResult(content="", source="empty")

        return ExecutionResult(
            content=content,
            source="graph",
            node_count=node_count,
            fact_count=fact_count,
        )

    def _exec_graph_search(self, entity: str, query: str) -> ExecutionResult:
        """Search graph nodes adjacent to entity, filtered by type/keyword."""
        nid = _make_id(entity) if entity else ""
        node = self._graph.get_node(nid) if nid else None

        if not node:
            # Fallback to GRAPH_ALL
            return self._exec_graph_all(entity)

        # Get neighbors
        neighbor_ids = _get_neighbor_ids({nid}, self._graph)
        query_parts = set(query.lower().replace("|", " ").split())

        sections: list[str] = []

        # Always include the main entity
        main_section = _render_node(node, self._graph)
        if main_section:
            sections.append(main_section)

        # Filter neighbors by type or keyword match
        for nbr_id in neighbor_ids:
            nbr = self._graph.get_node(nbr_id)
            if not nbr:
                continue

            nbr_type = nbr.get("type", "").lower()
            nbr_label = nbr.get("label", "").lower()
            nbr_facts = " ".join(f.get("fact", "") for f in nbr.get("facts", [])).lower()

            # Match if type matches query, or label/facts contain query terms
            matches = (
                nbr_type in query_parts
                or any(q in nbr_label for q in query_parts)
                or any(q in nbr_facts for q in query_parts)
            )

            if matches:
                section = _render_node(nbr, self._graph)
                if section:
                    sections.append(section)

        if not sections:
            # No matches — fallback to vector search
            return self._exec_vector_search(query)

        content = "\n\n".join(sections)
        return ExecutionResult(
            content=content,
            source="graph",
            node_count=len(sections),
            fact_count=content.count("- "),
        )

    def _exec_vector_search(self, query: str) -> ExecutionResult:
        """Semantic search via ChromaDB. Stub for now."""
        log.info("VECTOR_SEARCH not yet implemented, query: %s", query)
        return ExecutionResult(
            content="",
            source="empty",
        )

    async def _exec_web_search(self, entity: str, query: str) -> ExecutionResult:
        """Web search via MCP server."""
        if not self._mcp or not self._mcp.has_servers:
            log.info("WEB_SEARCH: no MCP servers configured, query: %s", query)
            return ExecutionResult(content="", source="empty")

        search_query = query or entity
        if not search_query:
            return ExecutionResult(content="", source="empty")

        log.info("WEB_SEARCH: searching via MCP for '%s'", search_query)
        content = await self._mcp.search_web(search_query)

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
