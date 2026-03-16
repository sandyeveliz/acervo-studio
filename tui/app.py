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
    DebugInfo,
    ExtractionCompleted,
    ExtractionStarted,
    GraphUpdated,
    MessageReceived,
    PipelineError,
    StreamChunkReceived,
    StreamCompleted,
    StreamStarted,
    TopicChanged,
    TopicDetectStep,
)
from core.pipeline import ConversationPipeline
from core.topic_detector import TopicDetector
from memory.extractor import EntityExtractor
from memory.graph import TopicGraph
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from tui.widgets.chat_panel import ChatPanel
from tui.widgets.log_stream import StatsPanel
from tui.widgets.trace_panel import TracePanel
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
    #top-row { height: 3fr; }
    #chat-panel { width: 1fr; }
    #trace-panel { height: 1fr; min-height: 6; }
    #input { dock: bottom; margin: 0; }
    """

    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+c", "quit", "Quit"),
        Binding("ctrl+r", "reset", "Reset"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._settings = load_settings()
        self._router = ModelRouter(self._settings)

        # Build pipeline components
        self._bus = EventBus()
        self._topic_detector = TopicDetector(self._router, self._settings.context)
        self._extractor = EntityExtractor(self._router)
        self._graph = TopicGraph()
        self._pipeline = ConversationPipeline(
            bus=self._bus,
            router=self._router,
            topic_detector=self._topic_detector,
            extractor=self._extractor,
            graph=self._graph,
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
        with Vertical():
            with Horizontal(id="top-row"):
                yield ChatPanel(id="chat-panel")
                yield StatsPanel()
            yield TracePanel(id="trace-panel")
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
        """Subscribe to pipeline events. All handlers use call_later for thread safety."""
        bus = self._bus
        trace = self.query_one("#trace-panel", TracePanel)
        stats = self.query_one(StatsPanel)
        chat = self.query_one("#chat-panel", ChatPanel)

        # Step 1: Message received
        bus.subscribe(MessageReceived, lambda e: self.call_later(
            trace.add_step, "message_in",
            f"[bold]Message received[/bold]  {e.msg_tokens} tk  ·  ctx {e.ctx_tokens:,} tk  ·  {e.history_len} msgs",
        ))

        # Step 2: Topic detection
        def _on_topic_step(e: TopicDetectStep) -> None:
            detail = f"[bold]Topic[/bold]  {e.verdict}  (L{e.level}, conf={e.confidence:.2f})"
            if e.keyword:
                detail += f"  keyword=\"{e.keyword}\""
            if e.similarity is not None:
                detail += f"  sim={e.similarity:.3f}"
            if e.answer:
                detail += f"  answer={e.answer}"
            if e.current_topic:
                detail += f"  prev=\"{e.current_topic}\""
            self.call_later(trace.add_step, "topic_detect", detail)

        bus.subscribe(TopicDetectStep, _on_topic_step)

        bus.subscribe(TopicChanged, lambda e: self.call_later(
            trace.add_step, "topic_changed",
            f"[bold]Topic set[/bold]  \"{e.new_topic}\"",
        ))

        # Step 3: Streaming
        bus.subscribe(StreamStarted, lambda e: (
            self.call_later(trace.add_step, "stream_start",
                f"[bold]LLM stream[/bold]  model={e.model}  msgs={e.history_len}  temp={e.temperature}"),
            self.call_later(self._on_stream_start),
        ))

        bus.subscribe(StreamChunkReceived, lambda e: self.call_later(
            self._on_stream_chunk, e.display_text,
        ))

        def _on_stream_complete(e: StreamCompleted) -> None:
            detail = (
                f"[bold]Response complete[/bold]  {e.completion_tokens} tk  ·  "
                f"{e.latency_ms:,.0f}ms  ·  TTFT {e.ttft_ms:,.0f}ms  ·  {e.speed_tps:.1f} tk/s"
            )
            if e.think_tokens > 0:
                detail += f"  ·  [dim]think={e.think_tokens} tk filtered[/dim]"
            self.call_later(trace.add_step, "stream_end", detail)
            self.call_later(self._on_stream_complete, e)

        bus.subscribe(StreamCompleted, _on_stream_complete)

        # Step 4: Extraction
        bus.subscribe(ExtractionStarted, lambda e: self.call_later(
            stats.set_extracting, True,
        ))

        def _on_extraction_done(e: ExtractionCompleted) -> None:
            entities = list(e.entities)
            if e.error:
                self.call_later(trace.add_step, "error",
                    f"[bold red]Extract failed[/bold red]  {e.error}")
            elif entities:
                names = ", ".join(f"{n}({t})" for n, t in entities)
                self.call_later(trace.add_step, "extract",
                    f"[bold]Extract[/bold]  {len(entities)} entities: {names}")
            else:
                self.call_later(trace.add_step, "extract",
                    "[dim]Extract → no entities[/dim]")
            self.call_later(stats.add_entities, entities)

        bus.subscribe(ExtractionCompleted, _on_extraction_done)

        # Step 5: Graph
        bus.subscribe(GraphUpdated, lambda e: self.call_later(
            trace.add_step, "graph",
            f"[bold]Graph updated[/bold]  {e.node_count} nodos  {e.edge_count} aristas",
        ))

        # Errors
        bus.subscribe(PipelineError, lambda e: self.call_later(
            trace.add_step, "error",
            f"[bold red]{e.step} error[/bold red]  {e.error}",
        ))

        # Debug
        bus.subscribe(DebugInfo, lambda e: self.call_later(
            trace.add_step, "topic_detect",
            f"  [dim]{e.message}[/dim]",
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

    def action_reset(self) -> None:
        self._history = [
            ChatMessage(role="system", content=self._system_prompt),
        ]
        self._topic_detector.current_topic = "none"
        self._stream_bubble = None
        self.query_one("#chat-panel", ChatPanel).remove_children()
        self.query_one(StatsPanel).reset()
        self.query_one("#trace-panel", TracePanel).reset()
        self._init_chat()

    async def action_quit(self) -> None:
        await self._router.close()
        self.exit()
