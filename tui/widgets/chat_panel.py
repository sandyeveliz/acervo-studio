"""Chat message display widget."""

from __future__ import annotations

from textual.containers import VerticalScroll
from textual.widgets import Static

from utils.token_counter import count_tokens


class MessageBubble(Static):
    """Single chat message with role styling."""

    DEFAULT_CSS = """
    MessageBubble {
        width: 100%;
        padding: 0 1;
        margin: 0 0 1 0;
    }
    MessageBubble.user {
        color: $text;
        background: $primary-background;
        border-left: thick $primary;
    }
    MessageBubble.assistant {
        color: $text;
        background: $surface;
        border-left: thick $success;
    }
    MessageBubble.system {
        color: $text-muted;
        background: $surface;
        border-left: thick $warning;
    }
    MessageBubble.error {
        color: $text;
        background: $error 20%;
        border-left: thick $error;
    }
    """

    def __init__(self, content: str, role: str = "assistant") -> None:
        super().__init__(content, classes=role)
        self._role = role


class ChatPanel(VerticalScroll):
    """Scrollable panel that displays conversation messages."""

    DEFAULT_CSS = """
    ChatPanel {
        height: 1fr;
        padding: 1;
    }
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._context_tokens: int = 0

    def set_initial_tokens(self, tokens: int) -> None:
        """Set the initial context size (system prompt tokens)."""
        self._context_tokens = tokens

    def add_message(
        self, content: str, role: str = "assistant", extra_line: str = ""
    ) -> MessageBubble:
        """Add a complete message with token stats."""
        msg_tokens = count_tokens(content)
        self._context_tokens += msg_tokens

        prefix = {"user": "You", "assistant": "AI", "system": "SYS", "error": "ERR"}.get(role, role)
        stats = f"\n[dim]  {msg_tokens} tk  ·  ctx {self._context_tokens:,} tk[/dim]"
        if extra_line:
            stats = f"\n[dim]  {extra_line}[/dim]{stats}"

        bubble = MessageBubble(f"[bold]{prefix}:[/bold] {content}{stats}", role=role)
        self.mount(bubble)
        self.scroll_end(animate=False)
        return bubble

    def add_streaming_message(self) -> MessageBubble:
        """Add an empty assistant message that will be updated via streaming."""
        bubble = MessageBubble("[bold]AI:[/bold] ▍", role="assistant")
        self.mount(bubble)
        self.scroll_end(animate=False)
        return bubble

    def finalize_streaming(
        self,
        bubble: MessageBubble,
        full_text: str,
        latency_ms: float,
        ttft_ms: float,
        chunk_count: int,
    ) -> None:
        """Finalize a streaming message with final text and stats."""
        msg_tokens = count_tokens(full_text)
        self._context_tokens += msg_tokens

        timing = f"{latency_ms:.0f}ms  ·  TTFT {ttft_ms:.0f}ms  ·  {chunk_count} chunks"
        stats = f"\n[dim]  {timing}[/dim]\n[dim]  {msg_tokens} tk  ·  ctx {self._context_tokens:,} tk[/dim]"
        bubble.update(f"[bold]AI:[/bold] {full_text}{stats}")
        self.scroll_end(animate=False)

    def update_streaming(self, bubble: MessageBubble, full_text: str) -> None:
        """Update a streaming message bubble with accumulated text."""
        bubble.update(f"[bold]AI:[/bold] {full_text}▍")
        self.scroll_end(animate=False)
