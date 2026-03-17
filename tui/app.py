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
from core.context_index import ContextIndex
from core.events import (
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
from core.topic_detector import TopicDetector
from memory.extractor import ConversationExtractor
from memory.graph import TopicGraph
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from tui.widgets.chat_panel import ChatPanel
from tui.widgets.log_stream import StatsPanel
# TracePanel kept for future debug mode but not mounted by default
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
    ]

    def __init__(self) -> None:
        super().__init__()
        self._settings = load_settings()
        self._router = ModelRouter(self._settings)

        # Build pipeline components
        self._bus = EventBus()
        self._topic_detector = TopicDetector(self._router, self._settings.context)
        self._extractor = ConversationExtractor(self._router)
        self._graph = TopicGraph()
        self._context_index = ContextIndex(
            self._settings.context, self._graph, self._router,
        )
        self._pipeline = ConversationPipeline(
            bus=self._bus,
            router=self._router,
            topic_detector=self._topic_detector,
            extractor=self._extractor,
            graph=self._graph,
            context_index=self._context_index,
            model_name=self._settings.lmstudio.model,
        )

        # Load agent config
        self._agent_config = _load_agent_config()
        self._system_prompt = self._agent_config["system_prompt"].strip()
        self._temperature = self._agent_config.get("temperature", 0.7)
        self._history: list[ChatMessage] = [
            ChatMessage(role="system", content=self._system_prompt),
        ]

        # Streaming state for chunk handling
        self._stream_bubble = None

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

    def _subscribe_events(self) -> None:
        """Subscribe to pipeline events. Steps appear inline in the chat timeline."""
        bus = self._bus
        stats = self.query_one(StatsPanel)
        chat = self.query_one("#chat-panel", ChatPanel)

        # Step 2: Topic detection
        def _on_topic_step(e: TopicDetectStep) -> None:
            detail = f"Topic  {e.verdict}  (L{e.level}, conf={e.confidence:.2f})"
            if e.current_topic:
                detail += f"  prev=\"{e.current_topic}\""
            chat.add_step("topic_detect", detail)

        bus.subscribe(TopicDetectStep, _on_topic_step)

        bus.subscribe(TopicChanged, lambda e: chat.add_step(
            "topic_changed", f"Topic set  \"{e.new_topic}\"",
        ))

        # Step 2.5: Planner
        bus.subscribe(PlannerDecision, lambda e: chat.add_step(
            "topic_detect",
            f"Planner  {e.tool} · {e.entity}" + (f" · {e.query}" if e.query else ""),
        ))

        # Step 2.6: Executor
        bus.subscribe(ExecutorResult, lambda e: chat.add_step(
            "topic_detect",
            f"Executor  {e.source} → {e.node_count} nodos · {e.fact_count} hechos",
        ))

        # Step 2.7: Context built
        def _on_context_built(e: ContextBuilt) -> None:
            warm = f"  warm=\"{e.warm_topic}\" {e.warm_tokens}tk" if e.warm_topic else ""
            chat.add_step("topic_detect",
                f"Context  hot={e.hot_messages}msgs {e.hot_tokens}tk{warm}  total={e.total_tokens}tk")
            if e.context_summary:
                chat.add_context_message(e.context_summary, e.total_tokens)

        bus.subscribe(ContextBuilt, _on_context_built)

        # Step 3: Streaming
        def _on_stream_started(e: StreamStarted) -> None:
            chat.add_step("stream_start",
                f"LLM stream  {e.provider}:{e.model}  msgs={e.history_len}")
            self._on_stream_start()

        bus.subscribe(StreamStarted, _on_stream_started)
        bus.subscribe(StreamChunkReceived, lambda e: self._on_stream_chunk(e.display_text))

        def _on_stream_complete(e: StreamCompleted) -> None:
            self.call_later(self._on_stream_complete, e)

        bus.subscribe(StreamCompleted, _on_stream_complete)

        # Step 4: Extraction
        bus.subscribe(ExtractionStarted, lambda e: self.call_later(
            stats.set_extracting, True,
        ))

        def _on_extraction_done(e: ExtractionCompleted) -> None:
            entities = list(e.entities)
            if e.error:
                self.call_later(chat.add_step, "error",
                    f"[bold red]Extract failed[/bold red]  {e.error}")
            elif entities:
                names = ", ".join(f"{n}({t})" for n, t in entities)
                self.call_later(chat.add_step, "extract",
                    f"Extract  {len(entities)} entities: {names}")
            else:
                self.call_later(chat.add_step, "extract",
                    "Extract → no entities")
            self.call_later(stats.add_entities, entities)

        bus.subscribe(ExtractionCompleted, _on_extraction_done)

        # Step 4.5: Fact filtering (only show in debug)
        bus.subscribe(FactFiltered, lambda e: None)  # silent

        # Step 5: Graph
        bus.subscribe(GraphUpdated, lambda e: self.call_later(
            chat.add_step, "graph",
            f"Graph updated  {e.node_count} nodos  {e.edge_count} aristas",
        ))

        # Step 6: Confirmation
        bus.subscribe(ConfirmationPending, lambda e: self.call_later(
            chat.add_step, "topic_detect",
            f"Confirmation pending  {e.entity}: {e.fact}",
        ))
        bus.subscribe(ConfirmationAccepted, lambda e: self.call_later(
            chat.add_step, "graph",
            f"[green]Confirmed → graph updated[/green]  {e.entity}: {e.fact}",
        ))

        # Step 7: Training capture (silent)
        bus.subscribe(TrainingSampleSaved, lambda e: None)

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

    # ── Init / Input / Reset / Quit ──

    def _init_chat(self) -> None:
        chat = self.query_one("#chat-panel", ChatPanel)
        sys_tokens = count_tokens(self._system_prompt)
        chat.set_initial_tokens(sys_tokens)
        chat.add_message(
            f"[dim]{self._system_prompt}[/dim]",
            role="system",
        )

        stats = self.query_one(StatsPanel)
        stats.set_router(self._router)
        stats.set_model(self._settings.lmstudio.model)
        stats.set_system_tokens(sys_tokens)

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
        self._topic_detector.current_topic = "none"
        self._stream_bubble = None
        self.query_one("#chat-panel", ChatPanel).reset()
        self.query_one(StatsPanel).reset()
        self._init_chat()

    def action_copy_chat(self) -> None:
        """Copy chat content to clipboard."""
        chat = self.query_one("#chat-panel", ChatPanel)
        text = chat.get_copyable_text()
        if text:
            self.copy_to_clipboard(text)
            self.notify("Chat copied to clipboard", timeout=2)

    async def action_quit(self) -> None:
        # Save session summary before closing
        topic = self._topic_detector.current_topic
        await self._pipeline.force_compact(self._history, topic)
        await self._router.close()
        self.exit()
