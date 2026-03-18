"""Chat panel with unified timeline — messages + pipeline steps inline."""

from __future__ import annotations

from textual.containers import VerticalScroll
from textual.widgets import Collapsible, Static

from utils.token_counter import count_tokens


_ICONS: dict[str, str] = {
    "message_in": "→",
    "acervo": "📦",
    "pipeline": "⚙",
    "llm": "◇",
    "topic_detect": "◈",
    "topic_changed": "◈",
    "stream_start": "◇",
    "stream_end": "◆",
    "extract": "⬡",
    "graph": "►",
    "error": "✗",
    "debug": "⚙",
}


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


class TimelineStep(Static):
    """Compact pipeline step shown inline in the chat timeline."""

    DEFAULT_CSS = """
    TimelineStep {
        width: 100%;
        padding: 0 2;
        height: auto;
    }
    """


class ChatPanel(VerticalScroll):
    """Scrollable panel with unified timeline: messages + pipeline steps."""

    DEFAULT_CSS = """
    ChatPanel {
        height: 1fr;
        padding: 1;
    }
    Collapsible {
        margin: 0 0 1 0;
        padding: 0;
        border-left: thick $accent;
    }
    Collapsible Static {
        padding: 0 1;
    }
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._context_tokens: int = 0
        self._verbose: bool = False

    def set_verbose(self, verbose: bool) -> None:
        """Toggle verbose mode for pipeline steps."""
        self._verbose = verbose

    def set_initial_tokens(self, tokens: int) -> None:
        self._context_tokens = tokens

    def add_message(
        self, content: str, role: str = "assistant", extra_line: str = ""
    ) -> MessageBubble:
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

    def add_collapsible_message(
        self, content: str, title: str, collapsed: bool = True,
    ) -> None:
        """Add a collapsible message (used for system prompt)."""
        collapsible = Collapsible(
            Static(content),
            title=title,
            collapsed=collapsed,
        )
        self.mount(collapsible)
        self.scroll_end(animate=False)

    def add_step(self, step_type: str, detail: str, verbose_detail: str = "") -> None:
        """Add a pipeline step inline in the timeline.

        Args:
            step_type: Icon key for the step
            detail: Always-shown compact text
            verbose_detail: Extra detail shown only in verbose mode
        """
        icon = _ICONS.get(step_type, "·")
        text = f"[dim]{icon}  {detail}[/dim]"
        if self._verbose and verbose_detail:
            text += f"\n[dim]     {verbose_detail}[/dim]"
        step = TimelineStep(text)
        self.mount(step)
        self.scroll_end(animate=False)

    def add_context_message(self, context_summary: str, total_tokens: int) -> None:
        """Add a collapsible context stack display."""
        title = f"CTX: {total_tokens} tk sent to LLM (click to expand)"
        collapsible = Collapsible(
            Static(f"[dim]{context_summary}[/dim]"),
            title=title,
            collapsed=True,
        )
        self.mount(collapsible)
        self.scroll_end(animate=False)

    def add_streaming_message(self) -> MessageBubble:
        bubble = MessageBubble("[bold]AI:[/bold] ▍", role="assistant")
        self.mount(bubble)
        self.scroll_end(animate=False)
        return bubble

    def finalize_streaming(
        self, bubble: MessageBubble, full_text: str,
        latency_ms: float, ttft_ms: float, chunk_count: int,
    ) -> None:
        msg_tokens = count_tokens(full_text)
        self._context_tokens += msg_tokens

        timing = f"{latency_ms:.0f}ms  ·  TTFT {ttft_ms:.0f}ms  ·  {chunk_count} chunks"
        stats = f"\n[dim]  {timing}[/dim]\n[dim]  {msg_tokens} tk  ·  ctx {self._context_tokens:,} tk[/dim]"
        bubble.update(f"[bold]AI:[/bold] {full_text}{stats}")
        self.scroll_end(animate=False)

    def update_streaming(self, bubble: MessageBubble, full_text: str) -> None:
        bubble.update(f"[bold]AI:[/bold] {full_text}▍")
        self.scroll_end(animate=False)

    def reset(self) -> None:
        """Clear all messages and steps."""
        self.remove_children()
        self._context_tokens = 0

    def get_copyable_text(self) -> str:
        """Get all timeline content as plain text for clipboard."""
        from rich.text import Text
        lines: list[str] = []
        for child in self.children:
            if isinstance(child, (MessageBubble, TimelineStep)):
                r = child.render()
                lines.append(r.plain if isinstance(r, Text) else str(r))
            elif isinstance(child, Collapsible):
                title = getattr(child, 'title', 'CTX')
                inner_parts: list[str] = []
                for sub in child.query(Static):
                    r = sub.render()
                    inner_parts.append(r.plain if isinstance(r, Text) else str(r))
                lines.append(f"▼ {title}\n{''.join(inner_parts)}")
        return "\n\n".join(lines)
