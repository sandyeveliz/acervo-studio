"""Context Index — manages the 3-layer context stack.

Replaces full history accumulation with a constant-size context window:
  [System prompt]  — fixed, KV cached
  [Warm layer]     — active topic .md (~200-400 tokens)
  [Hot layer]      — last N messages (~5 messages)
  [User message]   — always included

The LLM sees ~1.5K-2K tokens regardless of conversation depth.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

from config.settings import ContextSettings
from memory.graph import TopicGraph
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from utils.token_counter import count_tokens

log = logging.getLogger(__name__)

_TOPICS_DIR = Path("data/topics")

_SUMMARIZE_PROMPT = """Resumí los hechos clave de estos mensajes en viñetas.
Solo incluir hechos explícitos dichos por el usuario o confirmados en la conversación.
NO incluir saludos, preguntas ni especulación.
Responder siempre en español.
Output SOLO las viñetas, una por línea, empezando con "- ".

Mensajes:
{messages}

Resumen:"""


class ContextIndex:
    """Builds and manages the context stack sent to the LLM each turn."""

    def __init__(
        self,
        settings: ContextSettings,
        graph: TopicGraph,
        router: ModelRouter,
    ) -> None:
        self._settings = settings
        self._graph = graph
        self._router = router
        _TOPICS_DIR.mkdir(parents=True, exist_ok=True)

    async def build_context_stack(
        self,
        history: list[ChatMessage],
        current_topic: str,
        warm_override: str = "",
    ) -> tuple[list[ChatMessage], int, int, int]:
        """Build the filtered context stack for the LLM.

        Args:
            warm_override: If provided, use this as warm layer instead of
                calling synthesize(). This lets the executor control the context.

        Returns:
            (context_messages, hot_tokens, warm_tokens, total_tokens)
        """
        if len(history) < 2:
            # Only system prompt + user message — nothing to filter
            total = sum(count_tokens(m.content) for m in history)
            return history, total, 0, total

        # Split history: system prompt is always first
        system_msg = history[0]
        conversation = history[1:]  # All user/assistant messages

        # Current user message is always the last one
        current_user_msg = conversation[-1] if conversation else None

        # ── Warm layer first (priority) — graph context always enters fully ──
        user_text = current_user_msg.content if current_user_msg else ""
        if warm_override:
            warm_content = warm_override
        else:
            from core.context_synthesizer import synthesize
            warm_content = synthesize(self._graph, user_text)
        warm_tokens = count_tokens(warm_content) if warm_content else 0

        # Also check for persisted .md file (compacted context from previous turns)
        md_content, md_tokens = self._load_warm_content(current_topic)
        if md_content:
            warm_content = f"{warm_content}\n\n{md_content}" if warm_content else md_content
            warm_tokens += md_tokens

        # ── Hot layer: sliding window with dynamic budget ──
        # Budget = target_total - system - warm - user - overhead
        # The graph context (warm) always enters fully. Hot gets whatever is left.
        target_total = getattr(self._settings, "hot_layer_max_tokens", 500) + warm_tokens + count_tokens(system_msg.content)
        # Use a reasonable target: at least 2000tk or warm+system+500
        target_total = max(target_total, 2000)
        system_tk = count_tokens(system_msg.content)
        user_tk = count_tokens(user_text) if current_user_msg else 0
        overhead = 10  # "Entendido." ACK + margins
        hot_budget = target_total - system_tk - warm_tokens - user_tk - overhead
        hot_budget = max(hot_budget, 200)  # minimum: at least 1 short pair

        max_pairs = self._settings.hot_layer_max_messages
        prev_messages = conversation[:-1] if len(conversation) > 1 else []

        # Walk backwards through prev_messages collecting user/assistant pairs
        pairs: list[tuple[ChatMessage, ChatMessage]] = []
        i = len(prev_messages) - 1
        while i >= 1:
            if prev_messages[i].role == "assistant" and prev_messages[i - 1].role == "user":
                pairs.append((prev_messages[i - 1], prev_messages[i]))
                i -= 2
            else:
                i -= 1

        # Take pairs from most recent, respecting pair limit and token budget
        hot_messages: list[ChatMessage] = []
        hot_tokens = 0
        for user_msg, asst_msg in pairs[:max_pairs]:
            pair_tk = count_tokens(user_msg.content) + count_tokens(asst_msg.content)
            if hot_tokens + pair_tk > hot_budget:
                break
            hot_messages = [user_msg, asst_msg] + hot_messages
            hot_tokens += pair_tk

        # Track which pairs were included (for eviction detection in pipeline)
        self._last_included_pairs = len(hot_messages) // 2
        self._last_total_pairs = len(pairs)

        # ── Build stack ──
        # Structure:
        #   1. system — immutable prompt (KV cached)
        #   2. user [CONTEXTO VERIFICADO] — warm layer from graph
        #   3. assistant "Entendido." — ACK (forces model to accept context)
        #   4. hot messages — last N turn pairs (user/assistant)
        #   5. user — current message
        stack: list[ChatMessage] = [system_msg]

        if warm_content:
            stack.append(ChatMessage(
                role="user",
                content=f"[CONTEXTO VERIFICADO]\n{warm_content}\n[FIN CONTEXTO]",
            ))
            stack.append(ChatMessage(
                role="assistant",
                content="Entendido.",
            ))

        stack.extend(hot_messages)

        if current_user_msg:
            stack.append(current_user_msg)

        total_tokens = (
            count_tokens(system_msg.content) + warm_tokens + hot_tokens
            + (count_tokens(user_text) if current_user_msg else 0)
            + (count_tokens("Entendido.") if warm_content else 0)
        )

        return stack, hot_tokens, warm_tokens, total_tokens

    async def maybe_compact(
        self,
        history: list[ChatMessage],
        current_topic: str,
    ) -> bool:
        """If hot layer exceeds threshold, compact overflow to warm layer.

        Returns True if compaction happened.
        """
        if current_topic == "none" or len(history) < 2:
            return False

        conversation = history[1:]  # Skip system prompt
        max_hot = self._settings.hot_layer_max_messages

        # Only compact if there are messages being discarded
        if len(conversation) <= max_hot:
            return False

        # Messages that would be discarded (overflow)
        overflow = conversation[:-max_hot]
        overflow_tokens = sum(count_tokens(m.content) for m in overflow)

        if overflow_tokens < self._settings.compaction_trigger_tokens:
            return False

        # Compact: summarize overflow and save to warm layer
        log.info("Compacting %d overflow messages (%d tokens) to warm layer",
                 len(overflow), overflow_tokens)

        summary = await self._summarize_messages(overflow)
        if summary:
            self._update_topic_file(current_topic, summary)
            return True

        return False

    def _load_warm_content(self, current_topic: str) -> tuple[str, int]:
        """Load compacted .md file for the current topic (if exists).

        Returns (content, token_count) or ("", 0).
        """
        if current_topic == "none":
            return "", 0

        topic_id = _make_topic_id(current_topic)
        md_path = _TOPICS_DIR / f"{topic_id}.md"

        if md_path.exists():
            content = md_path.read_text(encoding="utf-8").strip()
            if content:
                return content, count_tokens(content)

        return "", 0

    async def _summarize_messages(self, messages: list[ChatMessage]) -> str:
        """Summarize messages using the utility model."""
        text = "\n".join(
            f"{m.role}: {m.content}" for m in messages
        )

        prompt = _SUMMARIZE_PROMPT.format(messages=text[:2000])

        try:
            response = await self._router.chat_utility(
                [ChatMessage(role="user", content=prompt)],
                temperature=0.0,
                max_tokens=400,
            )
            from utils.text import strip_think_blocks
            import re as _re
            raw = strip_think_blocks(response.content).strip()
            raw = _re.sub(r"```(?:json)?\s*", "", raw).strip()
            return raw
        except Exception as e:
            log.warning("Summarization failed: %s", e)
            return ""

    def _update_topic_file(self, topic_label: str, summary: str) -> None:
        """Update the .md file for a topic with new summary facts."""
        topic_id = _make_topic_id(topic_label)
        md_path = _TOPICS_DIR / f"{topic_id}.md"

        now = datetime.now().strftime("%Y-%m-%d")

        if md_path.exists():
            existing = md_path.read_text(encoding="utf-8")
            # Append new facts under existing ones
            if "## Hechos conocidos" in existing:
                # Add new facts after existing facts section
                dated_facts = "\n".join(
                    f"{line} [{now}]" if not line.endswith("]") else line
                    for line in summary.split("\n")
                    if line.strip().startswith("- ")
                )
                if dated_facts:
                    existing = existing.rstrip() + "\n" + dated_facts + "\n"
                md_path.write_text(existing, encoding="utf-8")
            else:
                # Add facts section
                existing = existing.rstrip() + f"\n\n## Hechos conocidos\n{summary}\n"
                md_path.write_text(existing, encoding="utf-8")
        else:
            content = f"# {topic_label}\n\n"
            content += f"**Última actividad:** {now}\n\n"
            content += f"## Hechos conocidos\n{summary}\n"
            md_path.write_text(content, encoding="utf-8")

        log.info("Updated topic file: %s", md_path)


def _make_topic_id(label: str) -> str:
    """Convert a topic label to a filesystem-safe ASCII ID."""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", label.lower())
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", ascii_str).strip("_")
