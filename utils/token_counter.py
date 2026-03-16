"""Token counting utility using tiktoken."""

from __future__ import annotations

import tiktoken

# cl100k_base works well as approximation for most models including Qwen
_enc = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    """Count tokens in a string."""
    return len(_enc.encode(text))
