"""Cuenta tokens antes de mandar al LLM usando tiktoken."""

import tiktoken

# cl100k_base es el encoding más cercano a los modelos modernos.
# Para modelos Qwen no hay encoding exacto en tiktoken, pero cl100k_base
# da una estimación razonable para planificación de contexto.
_ENCODING = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    """Cuenta tokens en un string."""
    return len(_ENCODING.encode(text))


def count_messages_tokens(messages: list[dict]) -> int:
    """Cuenta tokens totales en una lista de mensajes OpenAI-style.

    Incluye overhead por formato de mensaje (~4 tokens por mensaje).
    """
    total = 0
    for msg in messages:
        total += 4  # overhead por role + separadores
        total += count_tokens(msg.get("content", "") or "")
        if msg.get("name"):
            total += count_tokens(msg["name"])
    total += 2  # priming tokens
    return total
