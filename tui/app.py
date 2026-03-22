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
    ContextBuilt,
    MessageReceived,
    PipelineError,
    StreamChunkReceived,
    StreamCompleted,
    StreamStarted,
    ToolCallCompleted,
    ToolCallRequested,
)
from core.pipeline import ConversationPipeline
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

        # Load agent config first (needed for workspace_path)
        self._agent_config = _load_agent_config()
        self._system_prompt = self._agent_config["system_prompt"].strip()
        self._temperature = self._agent_config.get("temperature", 0.7)
        workspace_path = self._agent_config.get("workspace_path", "")

        # File tools — workspace_path from agent config
        file_tools = None
        if workspace_path:
            from core.tools.file_ops import FileTools
            file_tools = FileTools(workspace_path)

        # Determine LLM base URL: use proxy when Acervo plugin is enabled
        if self._settings.plugins.acervo.enabled:
            base_url_override = self._settings.plugins.acervo.proxy_url
        else:
            base_url_override = None

        self._pipeline = ConversationPipeline(
            bus=self._bus,
            router=self._router,
            model_name=self._settings.lmstudio.model,
            mcp=self._mcp if self._mcp.has_servers else None,
            file_tools=file_tools,
            base_url_override=base_url_override,
        )
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

        # Step 1: Message received
        bus.subscribe(MessageReceived, lambda e: None)

        # Step 2: Context built
        def _on_context_built(e: ContextBuilt) -> None:
            chat.add_step("pipeline",
                f"Context  msgs={e.hot_messages}  {e.total_tokens}tk")

        bus.subscribe(ContextBuilt, _on_context_built)

        # Step 3: Tool calls
        def _on_tool_requested(e: ToolCallRequested) -> None:
            chat.add_step("pipeline", f"Tool call: {e.tool}")

        bus.subscribe(ToolCallRequested, _on_tool_requested)

        def _on_tool_completed(e: ToolCallCompleted) -> None:
            chat.add_step("pipeline",
                f"Tool result: {e.tool}",
                verbose_detail=e.result_preview[:200] if e.result_preview else "")

        bus.subscribe(ToolCallCompleted, _on_tool_completed)

        # Step 4: Streaming (LLM)
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

    def action_reset(self) -> None:
        self._history = [
            ChatMessage(role="system", content=self._system_prompt),
        ]
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
        await self._router.close()
        self.exit()
