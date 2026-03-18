"""Adapter: ModelRouter → Acervo LLMClient Protocol."""

from __future__ import annotations

from acervo.llm import LLMClient
from providers.base import ChatMessage
from providers.model_router import ModelRouter


class ModelRouterAdapter:
    """Wraps AVS-Agents ModelRouter to satisfy Acervo's LLMClient Protocol."""

    def __init__(self, router: ModelRouter) -> None:
        self._router = router

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.0,
        max_tokens: int = 500,
    ) -> str:
        chat_msgs = [
            ChatMessage(role=m["role"], content=m["content"])
            for m in messages
        ]
        response = await self._router.chat_utility(
            chat_msgs, temperature=temperature, max_tokens=max_tokens,
        )
        return response.content
