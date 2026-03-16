"""Abstract base for all model providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class ChatMessage:
    """Single message in a conversation."""

    role: str  # "system" | "user" | "assistant" | "tool"
    content: str
    name: str | None = None
    tool_calls: list | None = None
    tool_call_id: str | None = None


@dataclass
class ChatResponse:
    """Response from a chat completion."""

    content: str
    role: str = "assistant"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: float = 0.0
    model: str = ""
    tool_calls: list | None = None


@dataclass
class StreamChunk:
    """Single chunk from a streaming response."""

    delta: str
    finish_reason: str | None = None


@dataclass
class EmbedResponse:
    """Response from an embedding request."""

    embedding: list[float]
    model: str = ""
    prompt_tokens: int = 0


class ModelProvider(ABC):
    """Abstract interface that all providers implement."""

    @abstractmethod
    async def chat(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        tools: list[dict] | None = None,
    ) -> ChatResponse:
        """Send messages and get a complete response."""

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[StreamChunk]:
        """Send messages and get a streaming response."""

    @abstractmethod
    async def embed(self, text: str) -> EmbedResponse:
        """Get embedding vector for text."""

    @abstractmethod
    async def close(self) -> None:
        """Clean up resources."""
