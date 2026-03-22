"""Load editable prompt templates from config/prompts/ directory."""

from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def load_prompt(name: str) -> str | None:
    """Load a prompt template by name (without .md extension).

    Returns the file content, or None if the file doesn't exist.
    """
    path = _PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        log.debug("Prompt file not found: %s", path)
        return None
    content = path.read_text(encoding="utf-8")
    if not content.strip():
        return None
    return content


def load_all_prompts() -> dict[str, str]:
    """Load all prompt templates. Returns {name: content} dict."""
    prompts: dict[str, str] = {}
    if not _PROMPTS_DIR.is_dir():
        return prompts
    for f in sorted(_PROMPTS_DIR.glob("*.md")):
        content = f.read_text(encoding="utf-8")
        if content.strip():
            prompts[f.stem] = content
    return prompts
