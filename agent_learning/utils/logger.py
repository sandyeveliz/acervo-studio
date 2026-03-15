"""Logger que guarda cada llamada al LLM con tokens, latencia y metadata."""

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.table import Table

LOGS_DIR = Path(__file__).parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)

console = Console()


class LLMLogger:
    """Registra cada llamada al LLM en un archivo JSON lines."""

    def __init__(self, step_name: str):
        self.step_name = step_name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_file = LOGS_DIR / f"{step_name}_{timestamp}.jsonl"
        self._call_count = 0

    def log_call(
        self,
        messages: list[dict],
        response_text: str,
        model: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        latency_ms: float = 0,
        tool_calls: list[dict] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Guarda una llamada completa al LLM."""
        self._call_count += 1
        entry = {
            "timestamp": datetime.now().isoformat(),
            "step": self.step_name,
            "call_number": self._call_count,
            "model": model,
            "messages_count": len(messages),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "latency_ms": round(latency_ms, 2),
            "response_preview": response_text[:200],
            "tool_calls": tool_calls,
            **(extra or {}),
        }
        with open(self.log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def print_token_summary(
        self,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        latency_ms: float = 0,
    ) -> None:
        """Muestra un resumen de tokens en la terminal con rich."""
        table = Table(title="Token Usage", show_header=True, header_style="bold cyan")
        table.add_column("Metric", style="dim")
        table.add_column("Value", justify="right")
        table.add_row("Prompt tokens", str(prompt_tokens))
        table.add_row("Completion tokens", str(completion_tokens))
        table.add_row("Total tokens", str(total_tokens))
        if latency_ms > 0:
            table.add_row("Latency", f"{latency_ms:.0f} ms")
            if completion_tokens > 0:
                tps = completion_tokens / (latency_ms / 1000)
                table.add_row("Tokens/sec", f"{tps:.1f}")
        console.print(table)


class Timer:
    """Context manager para medir latencia."""

    def __init__(self):
        self.start_time = 0.0
        self.elapsed_ms = 0.0

    def __enter__(self):
        self.start_time = time.perf_counter()
        return self

    def __exit__(self, *args):
        self.elapsed_ms = (time.perf_counter() - self.start_time) * 1000
