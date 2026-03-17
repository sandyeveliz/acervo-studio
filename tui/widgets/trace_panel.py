"""Trace panel — displays pipeline steps in execution order.

Pure display widget. Receives add_step() calls from event subscribers.
No log parsing, no threading logic.
"""

from __future__ import annotations

from datetime import datetime

from textual.containers import VerticalScroll
from textual.widgets import Static


_ICONS: dict[str, str] = {
    "message_in": "→",
    "topic_detect": "◈",
    "topic_changed": "◈",
    "stream_start": "◇",
    "stream_end": "◆",
    "extract": "⬡",
    "graph": "►",
    "error": "✗",
}


class TraceStep(Static):
    DEFAULT_CSS = """
    TraceStep {
        width: 100%;
        padding: 0 1;
        height: auto;
    }
    """


class TracePanel(VerticalScroll):
    DEFAULT_CSS = """
    TracePanel {
        height: 1fr;
        padding: 0 1;
        background: $surface;
        border-top: tall $primary-background;
    }
    """

    def __init__(self, max_steps: int = 200, **kwargs) -> None:
        super().__init__(**kwargs)
        self._max_steps = max_steps
        self._step_count = 0

    def reset(self) -> None:
        self.remove_children()
        self._step_count = 0

    def add_step(self, step_type: str, detail: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        icon = _ICONS.get(step_type, "·")
        line = f"[dim]{ts}[/dim]  {icon}  {detail}"
        step = TraceStep(line)
        self.mount(step)
        self.scroll_end(animate=False)
        self._step_count += 1
        if self._step_count > self._max_steps:
            first = self.query(TraceStep).first()
            if first:
                first.remove()
                self._step_count -= 1

    def get_copyable_text(self) -> str:
        """Get all trace steps as plain text for clipboard."""
        from rich.text import Text
        lines: list[str] = []
        for step in self.query(TraceStep):
            r = step.render()
            lines.append(r.plain if isinstance(r, Text) else str(r))
        return "\n".join(lines)
