"""Ollama provider — embeddings only."""

from __future__ import annotations

from typing import AsyncIterator

import ollama as ollama_lib

from config.settings import OllamaSettings
from providers.base import (
    ChatMessage,
    ChatResponse,
    EmbedResponse,
    ModelProvider,
    StreamChunk,
)


class OllamaProvider(ModelProvider):
    """Wraps Ollama for embedding generation. Chat is not supported."""

    def __init__(self, settings: OllamaSettings) -> None:
        self._settings = settings
        self._client = ollama_lib.AsyncClient(host=settings.base_url)

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        tools: list[dict] | None = None,
    ) -> ChatResponse:
        raise NotImplementedError(
            "Ollama provider handles embeddings only. Use LMStudioProvider for chat."
        )

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[StreamChunk]:
        raise NotImplementedError(
            "Ollama provider handles embeddings only. Use LMStudioProvider for chat."
        )
        yield  # type: ignore[misc]  # Make this a generator for type checking

    async def embed(self, text: str) -> EmbedResponse:
        response = await self._client.embed(
            model=self._settings.embed_model,
            input=text,
        )
        embedding = response["embeddings"][0]
        return EmbedResponse(
            embedding=embedding,
            model=self._settings.embed_model,
        )

    async def close(self) -> None:
        pass  # ollama AsyncClient doesn't require explicit cleanup
