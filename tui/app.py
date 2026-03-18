"""AVS-Agents TUI application — chat interface with LM Studio."""

from __future__ import annotations

from pathlib import Path

import yaml
from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import Footer, Header, Input
from textual.widgets._header import HeaderIcon

from config.settings import load_settings
from core.event_bus import EventBus
from core.events import (
    AcervoDecision,
    CompactionCompleted,
    ConfirmationAccepted,
    ConfirmationPending,
    ContextBuilt,
    ExecutorResult,
    ExtractionCompleted,
    ExtractionStarted,
    FactFiltered,
    GraphUpdated,
    MessageReceived,
    PipelineError,
    PlannerDecision,
    StreamChunkReceived,
    StreamCompleted,
    StreamStarted,
    TopicChanged,
    TopicDetectStep,
    TrainingSampleSaved,
)
from core.pipeline import ConversationPipeline
from acervo import Acervo
from providers.acervo_adapter import ModelRouterAdapter
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from providers.mcp_client import MCPManager
from tui.widgets.chat_panel import ChatPanel
from tui.widgets.log_stream import StatsPanel
from utils.token_counter import count_tokens

_AGENTS_DIR = Path(__file__).resolve().parent.parent / "config" / "agents"


def _load_agent_config(name: str = "default") -> dict:
    path = _AGENTS_DIR / f"{name}.yaml"
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


class AVSAgentsApp(App):
    TITLE = "AVS-Agents"
    SUB_TITLE = "Chat — LM Studio"

    CSS = """
    #main-row { height: 1fr; }
    #chat-panel { width: 1fr; }
    #input { dock: bottom; margin: 0; }
    """

    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+c", "quit", "Quit"),
        Binding("ctrl+r", "reset", "Reset"),
        Binding("ctrl+y", "copy_chat", "Copy chat"),
        Binding("ctrl+d", "toggle_verbose", "Debug"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._settings = load_settings()
        self._router = ModelRouter(self._settings)

        # Build pipeline components
        self._bus = EventBus()
        self._mcp = MCPManager()

        ctx = self._settings.context
        self._memory = Acervo(
            llm=ModelRouterAdapter(self._router),
            owner="Sandy",
            hot_layer_max_messages=ctx.hot_layer_max_messages,
            hot_layer_max_tokens=ctx.hot_layer_max_tokens,
            compaction_trigger_tokens=ctx.compaction_trigger_tokens,
            embed_threshold=ctx.topic_change_embed_threshold,
        )
        self._graph = self._memory.graph

        self._pipeline = ConversationPipeline(
            bus=self._bus,
            router=self._router,
            memory=self._memory,
            model_name=self._settings.lmstudio.model,
            mcp=self._mcp if self._mcp.has_servers else None,
        )

        # Load agent config
        self._agent_config = _load_agent_config()
        self._system_prompt = self._agent_config["system_prompt"].strip()
        self._temperature = self._agent_config.get("temperature", 0.7)
        self._history: list[ChatMessage] = [
            ChatMessage(role="system", content=self._system_prompt),
        ]

        # UI state
        self._stream_bubble = None
        self._verbose = False

    def compose(self) -> ComposeResult:
        yield Header(icon="⟳")
        with Horizontal(id="main-row"):
            yield ChatPanel(id="chat-panel")
            yield StatsPanel()
        yield Input(placeholder="Escribí un mensaje... (Ctrl+Q para salir)", id="input")
        yield Footer()

    def on_mount(self) -> None:
        try:
            icon = self.query_one(HeaderIcon)
            icon.action = "reset"
        except Exception:
            pass

        self._subscribe_events()
        self._init_chat()
        self._probe_mcp()

    @work
    async def _probe_mcp(self) -> None:
        """Probe MCP servers on startup to set initial status."""
        if self._mcp and self._mcp.has_servers:
            await self._mcp.probe_servers()
            self.call_later(self.query_one(StatsPanel).refresh_mcp_status)

    def _subscribe_events(self) -> None:
        """Subscribe to pipeline events. Steps appear inline in the chat timeline."""
        bus = self._bus
        stats = self.query_one(StatsPanel)
        chat = self.query_one("#chat-panel", ChatPanel)

        # Step 1: Message received — refresh graph status (after cycle_status)
        bus.subscribe(MessageReceived, lambda e: self.call_later(
            stats.update_graph_status, self._graph,
        ))

        # Step 2: Topic detection (Acervo)
        def _on_topic_step(e: TopicDetectStep) -> None:
            detail = f"Topic  {e.verdict}  (L{e.level}, conf={e.confidence:.2f})"
            if e.current_topic:
                detail += f"  topic=\"{e.current_topic}\""
            verbose = ""
            if e.keyword:
                verbose += f"keyword=\"{e.keyword}\"  "
            if e.similarity is not None:
                verbose += f"sim={e.similarity:.3f}  "
            if e.answer:
                verbose += f"answer=\"{e.answer}\""
            chat.add_step("acervo", detail, verbose_detail=verbose)

        bus.subscribe(TopicDetectStep, _on_topic_step)

        bus.subscribe(TopicChanged, lambda e: chat.add_step(
            "acervo", f"Topic → \"{e.new_topic}\"",
        ))

        # Step 2.5: Planner (Acervo)
        def _on_planner(e: PlannerDecision) -> None:
            detail = f"Plan  {e.tool} · {e.entity}"
            if e.query:
                detail += f" · \"{e.query}\""
            chat.add_step("acervo", detail)

        bus.subscribe(PlannerDecision, _on_planner)

        # Step 2.5b: Acervo decision
        _ACTION_LABELS = {
            "graph": "📗 Using graph data",
            "search": "🔍 Searching web...",
            "ask_user": "❓ No data — will ask user",
            "no_data": "📭 No data available",
        }

        def _on_acervo_decision(e: AcervoDecision) -> None:
            label = _ACTION_LABELS.get(e.action, e.action)
            verbose = f"has_context={e.has_context} needs_tool={e.needs_tool}"
            chat.add_step("acervo", label, verbose_detail=verbose)

        bus.subscribe(AcervoDecision, _on_acervo_decision)

        # Step 2.6: Executor (Pipeline)
        def _on_executor(e: ExecutorResult) -> None:
            if e.source == "web":
                detail = f"Web search → {e.node_count} results"
            elif e.source == "error":
                detail = f"[bold red]Error[/bold red]  {e.error_msg}"
                if e.error_msg:
                    self.call_later(self.notify,
                        f"Executor: {e.error_msg[:100]}", severity="error", timeout=5)
            elif e.source == "graph":
                detail = f"Graph → {e.node_count} nodos · {e.fact_count} hechos"
            else:
                detail = f"No results"
            chat.add_step("pipeline", detail)
            if e.source in ("web", "error"):
                self.call_later(stats.refresh_mcp_status)

        bus.subscribe(ExecutorResult, _on_executor)

        # Step 2.7: Context built (Acervo)
        def _on_context_built(e: ContextBuilt) -> None:
            warm = f"  warm=\"{e.warm_topic}\" {e.warm_tokens}tk" if e.warm_topic else ""
            chat.add_step("acervo",
                f"Context  hot={e.hot_messages}msgs {e.hot_tokens}tk{warm}  total={e.total_tokens}tk")
            if e.context_summary:
                chat.add_context_message(e.context_summary, e.total_tokens)

        bus.subscribe(ContextBuilt, _on_context_built)

        # Step 3: Streaming (LLM)
        def _on_stream_started(e: StreamStarted) -> None:
            detail = f"Streaming  {e.provider}:{e.model}  msgs={e.history_len}"
            verbose = f"endpoint={e.endpoint}  temp={e.temperature}"
            chat.add_step("llm", detail, verbose_detail=verbose)
            self._on_stream_start()

        bus.subscribe(StreamStarted, _on_stream_started)
        bus.subscribe(StreamChunkReceived, lambda e: self._on_stream_chunk(e.display_text))

        def _on_stream_complete(e: StreamCompleted) -> None:
            self.call_later(self._on_stream_complete, e)

        bus.subscribe(StreamCompleted, _on_stream_complete)

        # Step 4: Extraction (Acervo post-LLM)
        bus.subscribe(ExtractionStarted, lambda e: self.call_later(
            stats.set_extracting, True,
        ))

        def _on_extraction_done(e: ExtractionCompleted) -> None:
            entities = list(e.entities)
            if e.error:
                self.call_later(chat.add_step, "error",
                    f"[bold red]Extract failed[/bold red]  {e.error}")
            elif entities:
                # Show entity names with their graph status
                parts = []
                for name, etype in entities:
                    from acervo.graph import _make_id
                    node = self._graph.get_node(_make_id(name))
                    status = node.get("status", "?") if node else "new"
                    if status == "pending_verification":
                        parts.append(f"{name}({etype}) [dim]?[/dim]")
                    elif status == "hot":
                        parts.append(f"{name}({etype})")
                    else:
                        parts.append(f"{name}({etype}) [dim]{status}[/dim]")
                self.call_later(chat.add_step, "acervo",
                    f"Extract  {len(entities)} entities: {', '.join(parts)}")
            else:
                self.call_later(chat.add_step, "acervo",
                    "Extract → no entities")
            self.call_later(stats.add_entities, entities)

        bus.subscribe(ExtractionCompleted, _on_extraction_done)

        # Step 4.5: Fact filtering — show only in verbose mode
        def _on_fact_filtered(e: FactFiltered) -> None:
            if self._verbose:
                self.call_later(chat.add_step, "debug",
                    f"[dim]Fact filtered: {e.entity} — {e.reason}[/dim]",
                    verbose_detail=f"\"{e.fact}\"")

        bus.subscribe(FactFiltered, _on_fact_filtered)

        # Step 5: Graph
        def _on_graph_updated(e: GraphUpdated) -> None:
            # Show dedup info in verbose mode
            verbose = ""
            if self._verbose:
                dedup = self._graph.dedup_log
                if dedup:
                    verbose = "  ".join(f"dup: {e}→{f}" for e, f, _ in dedup[:3])
            self.call_later(chat.add_step, "graph",
                f"Graph updated  {e.node_count} nodos  {e.edge_count} aristas",
                verbose)
            self.call_later(stats.update_graph_status, self._graph)

        bus.subscribe(GraphUpdated, _on_graph_updated)

        # Step 6: Confirmation
        bus.subscribe(ConfirmationPending, lambda e: self.call_later(
            chat.add_step, "topic_detect",
            f"Confirmation pending  {e.entity}: {e.fact}",
        ))
        bus.subscribe(ConfirmationAccepted, lambda e: self.call_later(
            chat.add_step, "graph",
            f"[green]Confirmed → graph updated[/green]  {e.entity}: {e.fact}",
        ))

        # Step 7: Training capture — show only in verbose mode
        def _on_training(e: TrainingSampleSaved) -> None:
            if self._verbose:
                self.call_later(chat.add_step, "debug",
                    f"[dim]Training sample: {e.sample_type} · {e.entity}[/dim]")

        bus.subscribe(TrainingSampleSaved, _on_training)

        # Step 3.5: Compaction (only show when it actually compacts)
        def _on_compact(e: CompactionCompleted) -> None:
            if e.compacted:
                self.call_later(chat.add_step, "graph",
                    f"Compacted  overflow={e.overflow_tokens} tk saved")

        bus.subscribe(CompactionCompleted, _on_compact)

        # Errors
        bus.subscribe(PipelineError, lambda e: self.call_later(
            chat.add_step, "error",
            f"[bold red]{e.step} error[/bold red]  {e.error}",
        ))


    # ── Stream UI helpers ──

    def _on_stream_start(self) -> None:
        chat = self.query_one("#chat-panel", ChatPanel)
        stats = self.query_one(StatsPanel)
        self._stream_bubble = chat.add_streaming_message()
        stats.record_stream_start()

    def _on_stream_chunk(self, display_text: str) -> None:
        if self._stream_bubble:
            chat = self.query_one("#chat-panel", ChatPanel)
            chat.update_streaming(self._stream_bubble, display_text)
            self.query_one(StatsPanel).record_stream_chunk()

    def _on_stream_complete(self, event: StreamCompleted) -> None:
        if self._stream_bubble:
            chat = self.query_one("#chat-panel", ChatPanel)
            chat.finalize_streaming(
                self._stream_bubble,
                event.clean_text,
                event.latency_ms,
                event.ttft_ms,
                event.chunk_count,
            )
            self._stream_bubble = None

        stats = self.query_one(StatsPanel)
        stats.record_turn(
            prompt_tokens=0,
            completion_tokens=event.completion_tokens,
            latency_ms=event.latency_ms,
            ttft_ms=event.ttft_ms,
        )

        # Show extra stream stats in verbose mode
        if self._verbose and (event.think_tokens or event.speed_tps):
            chat = self.query_one("#chat-panel", ChatPanel)
            extra = []
            if event.think_tokens:
                extra.append(f"think={event.think_tokens}tk")
            if event.speed_tps:
                extra.append(f"speed={event.speed_tps:.1f}tk/s")
            self.call_later(chat.add_step, "debug",
                f"[dim]Stream detail: {' · '.join(extra)}[/dim]")

    # ── Init / Input / Reset / Quit ──

    def _init_chat(self) -> None:
        chat = self.query_one("#chat-panel", ChatPanel)
        sys_tokens = count_tokens(self._system_prompt)
        chat.set_initial_tokens(sys_tokens)

        # System prompt as collapsible (collapsed by default)
        preview = self._system_prompt[:80].replace("\n", " ")
        chat.add_collapsible_message(
            f"[dim]{self._system_prompt}[/dim]",
            title=f"SYS: {preview}...  ({sys_tokens} tk)",
            collapsed=True,
        )

        stats = self.query_one(StatsPanel)
        stats.set_router(self._router)
        stats.set_model(self._settings.lmstudio.model)
        stats.set_system_tokens(sys_tokens)
        stats.set_mcp(self._mcp)

        self.query_one("#input", Input).focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return

        self.query_one("#input", Input).value = ""
        self.query_one("#chat-panel", ChatPanel).add_message(text, role="user")
        self._history.append(ChatMessage(role="user", content=text))
        self._run_pipeline(text)

    @work(exclusive=True)
    async def _run_pipeline(self, user_text: str) -> None:
        """Delegate to pipeline. Append result to history."""
        clean_text = await self._pipeline.run_turn(
            user_text, self._history, self._temperature,
        )
        if clean_text:
            self._history.append(ChatMessage(role="assistant", content=clean_text))
            # If it's a confirmation response (not streamed), display it
            if clean_text.startswith("Guardado:"):
                chat = self.query_one("#chat-panel", ChatPanel)
                self.call_later(chat.add_message, clean_text, "assistant")

    def action_reset(self) -> None:
        self._history = [
            ChatMessage(role="system", content=self._system_prompt),
        ]
        self._memory.topic_detector.current_topic = "none"
        self._stream_bubble = None
        self.query_one("#chat-panel", ChatPanel).reset()
        self.query_one(StatsPanel).reset()
        self._init_chat()

    def action_toggle_verbose(self) -> None:
        """Toggle verbose/debug mode for pipeline steps."""
        self._verbose = not self._verbose
        chat = self.query_one("#chat-panel", ChatPanel)
        chat.set_verbose(self._verbose)
        state = "ON" if self._verbose else "OFF"
        self.notify(f"Debug mode {state}", timeout=2)

    def action_copy_chat(self) -> None:
        """Copy chat content to clipboard."""
        chat = self.query_one("#chat-panel", ChatPanel)
        text = chat.get_copyable_text()
        if text:
            self.copy_to_clipboard(text)
            self.notify("Chat copied to clipboard", timeout=2)

    async def action_quit(self) -> None:
        # Save session summary before closing
        topic = self._memory.topic_detector.current_topic
        await self._pipeline.force_compact(self._history, topic)
        await self._router.close()
        self.exit()
