"""Model router — decides which provider to use for each task."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import AsyncIterator

from config.settings import PricingSettings, Settings
from providers.base import (
    ChatMessage,
    ChatResponse,
    EmbedResponse,
    StreamChunk,
)
from providers.lmstudio import LMStudioProvider
from providers.ollama import OllamaProvider

log = logging.getLogger(__name__)


@dataclass
class TokenUsage:
    """Cumulative token usage across all providers."""

    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def record(self, prompt: int, completion: int) -> None:
        self.prompt_tokens += prompt
        self.completion_tokens += completion

    def reset(self) -> None:
        self.prompt_tokens = 0
        self.completion_tokens = 0


class ModelRouter:
    """Routes calls to the right provider.

    Two LLM providers:
    - lmstudio: main chat model (Qwen 3.5 9B with thinking)
    - lmstudio_utility: fast model for utility tasks (Qwen 2.5 3B, no thinking)
    - ollama: embeddings only
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lmstudio = LMStudioProvider(settings.lmstudio)
        self._utility = LMStudioProvider(settings.lmstudio_utility)
        self._ollama = OllamaProvider(settings.ollama)
        self._latency_threshold_ms = settings.routing.max_local_latency_ms
        self._pricing = settings.pricing
        self._active_provider: str = "lmstudio"
        self.usage = TokenUsage()

    @property
    def active_provider(self) -> str:
        return self._active_provider

    @property
    def cost_per_token(self) -> float:
        return getattr(self._pricing, self._active_provider, 0.0)

    @property
    def estimated_cost(self) -> float:
        return self.usage.total_tokens * self.cost_per_token

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        tools: list[dict] | None = None,
        force_local: bool = False,
    ) -> ChatResponse:
        """Chat with the main model (Qwen 3.5 9B)."""
        self._active_provider = "lmstudio"
        response = await self._lmstudio.chat(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=tools,
        )

        self.usage.record(response.prompt_tokens, response.completion_tokens)

        if (
            not force_local
            and response.latency_ms > self._latency_threshold_ms
        ):
            log.warning(
                "LM Studio latency %.0fms exceeds threshold %dms — "
                "remote fallback not yet configured",
                response.latency_ms,
                self._latency_threshold_ms,
            )

        return response

    async def chat_utility(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.0,
        max_tokens: int = 300,
    ) -> ChatResponse:
        """Chat with the utility model (Qwen 2.5 3B). For extraction, classification, etc."""
        response = await self._utility.chat(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        self.usage.record(response.prompt_tokens, response.completion_tokens)
        return response

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[StreamChunk]:
        self._active_provider = "lmstudio"
        chunk_count = 0
        async for chunk in self._lmstudio.chat_stream(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            if chunk.delta:
                chunk_count += 1
            yield chunk
        self.usage.record(0, chunk_count)

    async def embed(self, text: str) -> EmbedResponse:
        resp = await self._ollama.embed(text)
        self.usage.record(resp.prompt_tokens, 0)
        return resp

    async def close(self) -> None:
        await self._lmstudio.close()
        await self._utility.close()
        await self._ollama.close()
