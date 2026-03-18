"""Stats + Entity Tags sidebar."""

from __future__ import annotations

from textual.containers import Vertical
from textual.widgets import Static


class StatsDisplay(Static):
    """Upper half — model, session, and last turn stats."""

    DEFAULT_CSS = """
    StatsDisplay {
        width: 100%;
        height: auto;
        padding: 1;
    }
    """

    def __init__(self) -> None:
        super().__init__("")
        self._turns: int = 0
        self._total_completion: int = 0
        self._last_latency: float = 0.0
        self._last_ttft: float = 0.0
        self._model: str = "—"
        self._system_tokens: int = 0
        self._streaming: bool = False
        self._stream_chunks: int = 0
        self._router = None  # Set by StatsPanel after mount
        self._refresh()

    def set_router(self, router) -> None:
        """Bind the model router for reading cumulative token usage."""
        self._router = router

    def reset(self) -> None:
        self._turns = 0
        self._total_completion = 0
        self._last_latency = 0.0
        self._last_ttft = 0.0
        self._system_tokens = 0
        self._streaming = False
        self._stream_chunks = 0
        if self._router:
            self._router.usage.reset()
        self._refresh()

    def set_model(self, model: str) -> None:
        self._model = model
        self._refresh()

    def set_system_tokens(self, tokens: int) -> None:
        self._system_tokens = tokens
        self._refresh()

    def record_turn(
        self, prompt_tokens: int, completion_tokens: int,
        latency_ms: float, ttft_ms: float,
    ) -> None:
        self._turns += 1
        self._total_completion += completion_tokens
        self._last_latency = latency_ms
        self._last_ttft = ttft_ms
        self._streaming = False
        self._refresh()

    def record_stream_start(self) -> None:
        self._streaming = True
        self._stream_chunks = 0
        self._refresh()

    def record_stream_chunk(self) -> None:
        self._stream_chunks += 1
        self._refresh()

    def _refresh(self) -> None:
        tps = 0.0
        if self._last_latency > 0 and self._last_ttft > 0:
            gen_time = self._last_latency - self._last_ttft
            if gen_time > 0 and self._stream_chunks > 0:
                tps = self._stream_chunks / (gen_time / 1000)

        # Read cumulative totals from the router
        total_tk = 0
        est_cost = 0.0
        provider = "—"
        if self._router:
            total_tk = self._router.usage.total_tokens
            est_cost = self._router.estimated_cost
            provider = self._router.active_provider

        lines = [
            "[bold]Model[/bold]",
            f"  {self._model}",
            f"  [dim]via {provider}[/dim]",
            "",
            "[bold]Session[/bold]",
            f"  Turns:        {self._turns}",
            f"  System:       {self._system_tokens} tk",
            f"  Total tokens: {total_tk:,}",
        ]
        if est_cost > 0:
            lines.append(f"  Est. cost:    ${est_cost:.6f}")
        else:
            lines.append(f"  Est. cost:    $0 (local)")

        lines.extend([
            "",
            "[bold]Last turn[/bold]",
            f"  Latency:  {self._last_latency:,.0f}ms",
            f"  TTFT:     {self._last_ttft:,.0f}ms",
        ])
        if tps > 0:
            lines.append(f"  Speed:    {tps:.1f} tk/s")
        if self._streaming:
            lines.extend(["", f"[bold green]● Streaming[/bold green]  {self._stream_chunks} chunks"])

        self.update("\n".join(lines))


# --- Entity type icons (ontology types, capitalized) ---

_TYPE_ICONS: dict[str, str] = {
    "Persona": "👤",
    "Lugar": "📍",
    "Organización": "🏢",
    "Proyecto": "📦",
    "Tecnología": "⚙",
    "Documento": "📄",
    "Regla": "📏",
    "Unknown": "❓",
    # Legacy lowercase (kept for backward compat)
    "lugar": "📍",
    "persona": "👤",
    "entidad": "🏢",
    "actividad": "⚽",
}

_STATUS_ICONS: dict[str, str] = {
    "hot": "🔴",
    "warm": "🟡",
    "cold": "🟢",
}


class TopicsDisplay(Static):
    """Lower half — graph node status and active entities."""

    DEFAULT_CSS = """
    TopicsDisplay {
        width: 100%;
        height: auto;
        padding: 1;
        border-top: tall $primary-background;
    }
    """

    def __init__(self) -> None:
        super().__init__("")
        self._extracting: bool = False
        self._graph = None
        self._refresh()

    def reset(self) -> None:
        self._extracting = False
        self._graph = None
        self._refresh()

    def set_extracting(self, extracting: bool) -> None:
        """Show/hide the processing indicator."""
        self._extracting = extracting
        self._refresh()

    def add_entities(self, entities: list[tuple[str, str]]) -> None:
        """Called after extraction — refresh display from graph."""
        self._extracting = False
        self._refresh()

    def update_graph_status(self, graph) -> None:
        """Update display from graph state after each turn."""
        self._graph = graph
        self._refresh()

    def _refresh(self) -> None:
        lines = ["[bold]Graph[/bold]"]

        if self._extracting:
            lines.append("  ⏳ extracting...")

        if not self._graph:
            if not self._extracting:
                lines.append("  [dim]no entities yet[/dim]")
            self.update("\n".join(lines))
            return

        # Summary line
        lines.append(
            f"  {self._graph.node_count} nodes · {self._graph.edge_count} edges"
        )
        lines.append("")

        # Group nodes by status
        for status, status_icon in _STATUS_ICONS.items():
            nodes = self._graph.get_nodes_by_status(status)
            if not nodes:
                continue
            lines.append(f"  {status_icon} [bold]{status.capitalize()}[/bold]")
            for node in nodes:
                label = node.get("label", "?")
                ntype = node.get("type", "?")
                icon = _TYPE_ICONS.get(ntype, "·")
                layer = node.get("layer", "")
                layer_tag = " [dim]U[/dim]" if layer == "UNIVERSAL" else ""
                lines.append(f"    {icon} {label}{layer_tag}")

        # Show inactive nodes count
        all_nodes = self._graph.get_all_nodes()
        active_count = sum(
            1 for n in all_nodes if n.get("status") in ("hot", "warm", "cold")
        )
        inactive = len(all_nodes) - active_count
        if inactive > 0:
            lines.append(f"\n  [dim]{inactive} other nodes[/dim]")

        self.update("\n".join(lines))


_MCP_STATUS_ICONS: dict[str, str] = {
    "ready": "[green]●[/green]",
    "error": "[red]●[/red]",
    "unknown": "[yellow]●[/yellow]",
}


class MCPStatusDisplay(Static):
    """MCP server status display."""

    DEFAULT_CSS = """
    MCPStatusDisplay {
        width: 100%;
        height: auto;
        padding: 1;
        border-top: tall $primary-background;
    }
    """

    def __init__(self) -> None:
        super().__init__("")
        self._mcp = None
        self._refresh()

    def set_mcp(self, mcp) -> None:
        self._mcp = mcp
        self._refresh()

    def refresh_status(self) -> None:
        self._refresh()

    def _refresh(self) -> None:
        lines = ["[bold]MCP Servers[/bold]"]

        if not self._mcp or not self._mcp.has_servers:
            lines.append("  [dim]no servers configured[/dim]")
            self.update("\n".join(lines))
            return

        for name in self._mcp.server_names:
            status = self._mcp.get_status(name)
            icon = _MCP_STATUS_ICONS.get(status, "○")
            lines.append(f"  {icon} {name}")
            error = self._mcp.get_error(name)
            if error:
                lines.append(f"    [dim red]{error[:40]}[/dim red]")

        self.update("\n".join(lines))


class StatsPanel(Vertical):
    """Sidebar container: stats on top, entity tags + MCP status on bottom."""

    DEFAULT_CSS = """
    StatsPanel {
        width: 34;
        height: 100%;
        background: $surface;
        border-left: tall $primary-background;
    }
    """

    def compose(self):
        yield StatsDisplay()
        yield TopicsDisplay()
        yield MCPStatusDisplay()

    def reset(self) -> None:
        self.query_one(StatsDisplay).reset()
        self.query_one(TopicsDisplay).reset()

    def set_router(self, router) -> None:
        self.query_one(StatsDisplay).set_router(router)

    def set_model(self, model: str) -> None:
        self.query_one(StatsDisplay).set_model(model)

    def set_system_tokens(self, tokens: int) -> None:
        self.query_one(StatsDisplay).set_system_tokens(tokens)

    def record_turn(self, prompt_tokens: int, completion_tokens: int,
                    latency_ms: float, ttft_ms: float) -> None:
        self.query_one(StatsDisplay).record_turn(
            prompt_tokens, completion_tokens, latency_ms, ttft_ms)

    def record_stream_start(self) -> None:
        self.query_one(StatsDisplay).record_stream_start()

    def record_stream_chunk(self) -> None:
        self.query_one(StatsDisplay).record_stream_chunk()

    def set_extracting(self, extracting: bool) -> None:
        self.query_one(TopicsDisplay).set_extracting(extracting)

    def add_entities(self, entities: list[tuple[str, str]]) -> None:
        self.query_one(TopicsDisplay).add_entities(entities)

    def update_graph_status(self, graph) -> None:
        self.query_one(TopicsDisplay).update_graph_status(graph)

    def set_mcp(self, mcp) -> None:
        self.query_one(MCPStatusDisplay).set_mcp(mcp)

    def refresh_mcp_status(self) -> None:
        self.query_one(MCPStatusDisplay).refresh_status()
