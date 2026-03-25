"""LM Studio provider — chat and streaming via OpenAI-compatible API."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import AsyncIterator

from openai import AsyncOpenAI

from config.settings import LMStudioSettings
from providers.base import (
    ChatMessage,
    ChatResponse,
    EmbedResponse,
    ModelProvider,
    StreamChunk,
)

log = logging.getLogger(__name__)


class LMStudioProvider(ModelProvider):
    """Wraps LM Studio's OpenAI-compatible endpoint for chat and streaming."""

    def __init__(
        self,
        settings: LMStudioSettings,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(
            base_url=settings.base_url,
            api_key=settings.api_key,
            default_headers=extra_headers or {},
        )

    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        tools: list[dict] | None = None,
    ) -> ChatResponse:
        payload: dict = {
            "model": self._settings.model,
            "messages": [self._to_api_msg(m) for m in messages],
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools

        start = time.perf_counter()
        response = await self._client.chat.completions.create(**payload)
        latency = (time.perf_counter() - start) * 1000

        choice = response.choices[0]
        usage = response.usage

        result = ChatResponse(
            content=choice.message.content or "",
            role=choice.message.role,
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
            latency_ms=latency,
            model=response.model or self._settings.model,
            tool_calls=self._parse_tool_calls(choice.message),
        )

        log.info(
            "chat  prompt=%d completion=%d total=%d latency=%.0fms model=%s endpoint=%s",
            result.prompt_tokens,
            result.completion_tokens,
            result.total_tokens,
            result.latency_ms,
            result.model,
            self._settings.base_url,
        )

        return result

    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[StreamChunk]:
        payload: dict = {
            "model": self._settings.model,
            "messages": [self._to_api_msg(m) for m in messages],
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        log.info("stream_start model=%s messages=%d", self._settings.model, len(messages))
        start = time.perf_counter()
        chunk_count = 0
        first_token_time: float | None = None

        stream = await self._client.chat.completions.create(**payload)

        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            content = delta.content or ""
            if content and first_token_time is None:
                first_token_time = time.perf_counter()
            chunk_count += 1
            yield StreamChunk(
                delta=content,
                finish_reason=chunk.choices[0].finish_reason,
            )

        elapsed = (time.perf_counter() - start) * 1000
        ttft = ((first_token_time - start) * 1000) if first_token_time else 0
        log.info(
            "stream_end chunks=%d latency=%.0fms ttft=%.0fms model=%s",
            chunk_count,
            elapsed,
            ttft,
            self._settings.model,
        )

    async def embed(self, text: str) -> EmbedResponse:
        raise NotImplementedError(
            "LM Studio provider does not handle embeddings. Use OllamaProvider."
        )

    async def close(self) -> None:
        try:
            await asyncio.wait_for(self._client.close(), timeout=2.0)
        except (asyncio.TimeoutError, Exception):
            pass  # Don't hang on shutdown

    @staticmethod
    def _to_api_msg(msg: ChatMessage) -> dict:
        d: dict = {"role": msg.role, "content": msg.content}
        if msg.name:
            d["name"] = msg.name
        if msg.tool_call_id:
            d["tool_call_id"] = msg.tool_call_id
        if msg.tool_calls:
            d["tool_calls"] = msg.tool_calls
        return d

    @staticmethod
    def _parse_tool_calls(message) -> list | None:
        if not hasattr(message, "tool_calls") or not message.tool_calls:
            return None
        return [
            {
                "id": tc.id,
                "type": tc.type,
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in message.tool_calls
        ]
