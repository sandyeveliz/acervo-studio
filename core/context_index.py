"""Context Index — manages the context stack for the LLM.

Simplified after Acervo decoupling: context enrichment from the knowledge
graph is now handled by the Acervo proxy. This module builds a simple
sliding-window history with system prompt + recent messages.
"""

from __future__ import annotations

import logging

from config.settings import ContextSettings
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from utils.token_counter import count_tokens

log = logging.getLogger(__name__)


class ContextIndex:
    """Builds the context stack sent to the LLM each turn."""

    def __init__(
        self,
        settings: ContextSettings,
        router: ModelRouter,
    ) -> None:
        self._settings = settings
        self._router = router

    async def build_context_stack(
        self,
        history: list[ChatMessage],
    ) -> tuple[list[ChatMessage], int, int]:
        """Build the filtered context stack for the LLM.

        Returns:
            (context_messages, hot_tokens, total_tokens)
        """
        if len(history) < 2:
            total = sum(count_tokens(m.content) for m in history)
            return history, total, total

        system_msg = history[0]
        conversation = history[1:]

        current_user_msg = conversation[-1] if conversation else None

        # Hot layer: sliding window of recent turn pairs
        system_tk = count_tokens(system_msg.content)
        user_tk = count_tokens(current_user_msg.content) if current_user_msg else 0
        hot_budget = max(self._settings.hot_layer_max_tokens, 200)

        max_pairs = self._settings.hot_layer_max_messages
        prev_messages = conversation[:-1] if len(conversation) > 1 else []

        # Walk backwards collecting user/assistant pairs
        pairs: list[tuple[ChatMessage, ChatMessage]] = []
        i = len(prev_messages) - 1
        while i >= 1:
            if prev_messages[i].role == "assistant" and prev_messages[i - 1].role == "user":
                pairs.append((prev_messages[i - 1], prev_messages[i]))
                i -= 2
            else:
                i -= 1

        hot_messages: list[ChatMessage] = []
        hot_tokens = 0
        for user_msg, asst_msg in pairs[:max_pairs]:
            pair_tk = count_tokens(user_msg.content) + count_tokens(asst_msg.content)
            if hot_tokens + pair_tk > hot_budget:
                break
            hot_messages = [user_msg, asst_msg] + hot_messages
            hot_tokens += pair_tk

        # Build stack
        stack: list[ChatMessage] = [system_msg]
        stack.extend(hot_messages)
        if current_user_msg:
            stack.append(current_user_msg)

        total_tokens = system_tk + hot_tokens + user_tk

        return stack, hot_tokens, total_tokens
