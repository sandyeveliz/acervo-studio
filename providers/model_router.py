"""Model router — decides which provider to use for each task."""

from __future__ import annotations

import asyncio
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

    LLM providers:
    - lmstudio: main chat model via Ollama OpenAI-compat endpoint
    - lmstudio_utility: utility tasks (same model by default, can be overridden)
    - ollama: embeddings only (native Ollama API)
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
        base_url_override: str | None = None,
    ) -> ChatResponse:
        """Chat with the main model.

        Args:
            base_url_override: If set, route the request through this URL
                               (e.g. Acervo proxy) instead of the default LM Studio endpoint.
        """
        self._active_provider = "lmstudio"
        provider = self._get_provider_for_url(base_url_override) if base_url_override else self._lmstudio
        response = await provider.chat(
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
                "Chat model latency %.0fms exceeds threshold %dms — "
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
        """Chat with the utility model. For extraction, classification, etc."""
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
        base_url_override: str | None = None,
    ) -> AsyncIterator[StreamChunk]:
        self._active_provider = "lmstudio"
        provider = self._get_provider_for_url(base_url_override) if base_url_override else self._lmstudio
        chunk_count = 0
        async for chunk in provider.chat_stream(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
        ):
            if chunk.delta:
                chunk_count += 1
            yield chunk
        self.usage.record(0, chunk_count)

    def _get_provider_for_url(self, base_url: str) -> LMStudioProvider:
        """Get or create a provider for a custom base URL (e.g. Acervo proxy).

        Sends X-Forward-To header with the original LM Studio URL so the proxy
        knows where to forward the enriched request.
        """
        if not hasattr(self, "_override_providers"):
            self._override_providers: dict[str, LMStudioProvider] = {}
        if base_url not in self._override_providers:
            from dataclasses import replace
            override_settings = replace(self._settings.lmstudio, base_url=base_url)
            self._override_providers[base_url] = LMStudioProvider(
                override_settings,
                extra_headers={"X-Forward-To": self._settings.lmstudio.base_url},
            )
        return self._override_providers[base_url]

    async def embed(self, text: str) -> EmbedResponse:
        resp = await self._ollama.embed(text)
        self.usage.record(resp.prompt_tokens, 0)
        return resp

    async def close(self) -> None:
        try:
            await asyncio.wait_for(self._lmstudio.close(), timeout=2.0)
        except (asyncio.TimeoutError, Exception):
            pass
        try:
            await asyncio.wait_for(self._utility.close(), timeout=2.0)
        except (asyncio.TimeoutError, Exception):
            pass
        try:
            await asyncio.wait_for(self._ollama.close(), timeout=2.0)
        except (asyncio.TimeoutError, Exception):
            pass
        for provider in getattr(self, "_override_providers", {}).values():
            try:
                await asyncio.wait_for(provider.close(), timeout=2.0)
            except (asyncio.TimeoutError, Exception):
                pass
