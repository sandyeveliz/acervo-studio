"""Conversation pipeline — orchestrates the full turn sequence.

Simplified pipeline: streams LLM response, handles MCP tools and file tools.
Context enrichment is handled transparently by the Acervo proxy when enabled.
"""

from __future__ import annotations

import json
import time

from core.event_bus import EventBus
from core.events import (
    AcervoEnrichResult,
    AcervoRequestSent,
    ConversationIndexed,
    ContextBuilt,
    MessageReceived,
    PipelineError,
    StreamChunkReceived,
    StreamCompleted,
    StreamStarted,
    ToolCallCompleted,
    ToolCallRequested,
)
from utils.token_counter import count_tokens
from utils.text import strip_think_blocks
from providers.base import ChatMessage
from providers.model_router import ModelRouter


class ConversationPipeline:
    """Orchestrates the full conversation turn.

    Owns: LLM streaming, MCP tool execution, event emission.
    Context enrichment is delegated to the Acervo proxy (when enabled).
    """

    def __init__(
        self,
        bus: EventBus,
        router: ModelRouter,
        model_name: str = "",
        mcp=None,
        base_url_override: str | None = None,
    ) -> None:
        self._bus = bus
        self._router = router
        self._model_name = model_name
        self._mcp = mcp
        self._base_url_override = base_url_override

        # Build unified tool definitions (MCP tools only)
        all_tools: list[dict] = []
        if mcp:
            all_tools.extend(mcp.get_tool_definitions())
        self._tool_defs = all_tools if all_tools else None

    async def run_turn(
        self,
        user_text: str,
        history: list[ChatMessage],
        temperature: float = 0.7,
    ) -> str | None:
        """Execute full pipeline. Returns clean assistant response text."""

        # ── Step 1: Message received ──
        msg_tokens = count_tokens(user_text)
        ctx_tokens = sum(count_tokens(m.content) for m in history)
        await self._bus.emit(MessageReceived(
            user_text=user_text,
            msg_tokens=msg_tokens,
            ctx_tokens=ctx_tokens,
            history_len=len(history),
        ))

        # ── Step 2: Build context (simple history pass-through) ──
        # When Acervo proxy is enabled, context enrichment happens transparently
        # at the proxy level — we just send the raw history.
        context_stack = list(history)

        ctx_payload = json.dumps(
            [{"role": m.role, "content": m.content[:200]} for m in context_stack],
            ensure_ascii=False,
        )
        total_tokens = sum(count_tokens(m.content) for m in context_stack)
        warm_topic = "(acervo proxy)" if self._base_url_override else ""
        await self._bus.emit(ContextBuilt(
            hot_messages=len(context_stack) - 1,
            hot_tokens=total_tokens,
            warm_topic=warm_topic,
            warm_tokens=0,
            total_tokens=total_tokens,
            context_summary=ctx_payload,
        ))

        # ── Step 3: Acervo proxy routing (if enabled) ──
        if self._base_url_override:
            await self._bus.emit(AcervoRequestSent(
                proxy_url=self._base_url_override,
                message_count=len(context_stack),
            ))

        # ── Step 4: Tool-use loop (non-streaming) — LLM may call tools ──
        # When Acervo proxy is enabled, the first call in the tool loop
        # routes through the proxy, triggering enrichment. Subsequent calls
        # pass through (proxy detects they're not new user turns).
        chat_messages = list(context_stack)
        if self._tool_defs:
            chat_messages = await self._tool_loop(chat_messages, temperature)

        # ── Step 4.5: Query Acervo enrichment result ──
        # Enrichment happened during the first tool-loop call (or will happen
        # during the final stream if no tools are defined). Query now so
        # stages appear in the trace before streaming starts.
        if self._base_url_override and self._tool_defs:
            await self._query_acervo_result()

        # ── Step 5: Stream final response ──
        clean_text = await self._step_stream(chat_messages, temperature)

        # ── Step 6: Query post-LLM indexing stats ──
        # The proxy runs process() after the LLM stream completes,
        # so indexing data is now available.
        if self._base_url_override:
            await self._query_indexing_result()

        return clean_text

    # ── Tool-use loop ──

    _MAX_TOOL_ROUNDS = 5

    async def _tool_loop(
        self, messages: list[ChatMessage], temperature: float,
    ) -> list[ChatMessage]:
        """Run non-streaming tool-use rounds until the LLM produces a final text response.

        Returns the extended message list with tool calls + results appended.
        The caller then streams the final response separately.

        All rounds route through the Acervo proxy (when enabled) so that:
        - The first call triggers enrichment (new user turn)
        - Subsequent rounds pass through (last message is tool result)
        This ensures the LLM has enriched context before deciding about tools.
        """
        messages = list(messages)  # shallow copy

        for round_idx in range(self._MAX_TOOL_ROUNDS):
            response = await self._router.chat(
                messages, temperature=temperature, tools=self._tool_defs,
                base_url_override=self._base_url_override,
            )

            if not response.tool_calls:
                # LLM chose not to use tools — done, proceed to streaming
                return messages

            # Append the assistant message that contains tool_calls
            messages.append(ChatMessage(
                role="assistant",
                content=response.content or "",
                tool_calls=response.tool_calls,
            ))

            # Execute each tool call and append results
            for tc in response.tool_calls:
                fn_name = tc["function"]["name"]
                fn_args_raw = tc["function"]["arguments"]
                try:
                    fn_args = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else fn_args_raw
                except json.JSONDecodeError:
                    fn_args = {}

                await self._bus.emit(ToolCallRequested(
                    tool=fn_name,
                    arguments=json.dumps(fn_args, ensure_ascii=False),
                ))

                # Route to the right executor (MCP tools only)
                if self._mcp:
                    mcp_result = await self._mcp.call_tool_by_name(fn_name, fn_args)
                    result = mcp_result.content
                else:
                    result = f"Unknown tool: {fn_name}"

                messages.append(ChatMessage(
                    role="tool",
                    content=result,
                    tool_call_id=tc["id"],
                ))

                await self._bus.emit(ToolCallCompleted(
                    tool=fn_name,
                    arguments=json.dumps(fn_args, ensure_ascii=False),
                    result_preview=result[:300],
                ))

        return messages

    # ── LLM streaming ──

    async def _step_stream(
        self, context_stack: list[ChatMessage], temperature: float
    ) -> str:
        endpoint = self._base_url_override or self._router._settings.lmstudio.base_url

        # Serialize messages for trace (full content — proxy view is preferred when available)
        request_msgs = json.dumps([
            {"role": m.role, "content": m.content, "content_length": len(m.content)}
            for m in context_stack
        ], ensure_ascii=False)

        full_text = ""
        start = time.perf_counter()
        first_token_time: float | None = None
        chunk_count = 0
        in_think_block = False

        try:
            async for chunk in self._router.chat_stream(
                context_stack, temperature=temperature,
                base_url_override=self._base_url_override,
            ):
                if not chunk.delta:
                    continue
                if first_token_time is None:
                    first_token_time = time.perf_counter()
                    # Query acervo result if not already queried (e.g. no tool defs)
                    if self._base_url_override and not self._tool_defs:
                        await self._query_acervo_result()
                    # Query what the proxy actually forwarded to the LLM
                    actual_request = await self._query_actual_llm_request()
                    await self._bus.emit(StreamStarted(
                        model=self._model_name,
                        provider=self._router.active_provider,
                        endpoint=endpoint,
                        history_len=len(context_stack),
                        temperature=temperature,
                        request_messages=request_msgs,
                        actual_llm_request=actual_request,
                    ))
                full_text += chunk.delta
                chunk_count += 1

                if "<think>" in full_text and "</think>" not in full_text:
                    in_think_block = True
                if "</think>" in full_text:
                    in_think_block = False
                    await self._bus.emit(StreamChunkReceived(
                        display_text=strip_think_blocks(full_text)))
                elif not in_think_block:
                    await self._bus.emit(StreamChunkReceived(
                        display_text=strip_think_blocks(full_text)))

        except Exception as e:
            # Emit StreamStarted if we never got a chunk (so trace isn't broken)
            if first_token_time is None:
                await self._bus.emit(StreamStarted(
                    model=self._model_name,
                    provider=self._router.active_provider,
                    endpoint=endpoint,
                    history_len=len(context_stack),
                    temperature=temperature,
                    request_messages=request_msgs,
                ))
            await self._bus.emit(PipelineError(step="llm_stream", error=str(e)))
            return ""

        latency = (time.perf_counter() - start) * 1000
        ttft = ((first_token_time - start) * 1000) if first_token_time else 0
        clean_text = strip_think_blocks(full_text)

        completion_tokens = count_tokens(clean_text)
        think_tokens = count_tokens(full_text) - completion_tokens
        speed = 0.0
        gen_time = latency - ttft
        if gen_time > 0 and chunk_count > 0:
            speed = chunk_count / (gen_time / 1000)

        await self._bus.emit(StreamCompleted(
            clean_text=clean_text,
            completion_tokens=completion_tokens,
            think_tokens=think_tokens,
            latency_ms=latency,
            ttft_ms=ttft,
            speed_tps=speed,
            chunk_count=chunk_count,
        ))

        return clean_text

    # ── Acervo proxy query ──

    async def _query_acervo_result(self) -> None:
        """Query the Acervo proxy for enrichment details of the last turn."""
        proxy_base = self._base_url_override.rstrip("/").removesuffix("/v1")
        url = f"{proxy_base}/acervo/last-turn"
        try:
            from urllib.request import urlopen
            import asyncio
            loop = asyncio.get_event_loop()
            resp_bytes = await loop.run_in_executor(None, lambda: urlopen(url, timeout=3).read())
            data = json.loads(resp_bytes)
            debug = data.get("debug", {})
            await self._bus.emit(AcervoEnrichResult(
                enriched=data.get("enriched", False),
                topic=data.get("topic", ""),
                warm_tokens=data.get("warm_tokens", 0),
                stages=tuple(data.get("stages", [])),
                stage_data=json.dumps(debug) if debug else "",
                entities_extracted=data.get("entities_extracted", 0),
                facts_extracted=data.get("facts_extracted", 0),
            ))
        except Exception:
            pass  # Non-critical — proxy might not be running

    async def _query_actual_llm_request(self) -> str:
        """Query the proxy for the actual request body forwarded to the LLM.

        Returns JSON string with the full message array the LLM received,
        or empty string if unavailable.
        """
        if not self._base_url_override:
            return ""
        proxy_base = self._base_url_override.rstrip("/").removesuffix("/v1")
        url = f"{proxy_base}/acervo/last-request"
        try:
            from urllib.request import urlopen
            import asyncio
            loop = asyncio.get_event_loop()
            resp_bytes = await loop.run_in_executor(None, lambda: urlopen(url, timeout=3).read())
            return resp_bytes.decode("utf-8")
        except Exception:
            return ""

    async def _query_indexing_result(self) -> None:
        """Query the Acervo proxy for post-LLM indexing stats."""
        proxy_base = self._base_url_override.rstrip("/").removesuffix("/v1")
        url = f"{proxy_base}/acervo/last-turn"
        try:
            from urllib.request import urlopen
            import asyncio
            loop = asyncio.get_event_loop()
            resp_bytes = await loop.run_in_executor(None, lambda: urlopen(url, timeout=3).read())
            data = json.loads(resp_bytes)
            entities = data.get("entities_extracted", 0)
            facts = data.get("facts_extracted", 0)
            if entities > 0 or facts > 0:
                await self._bus.emit(ConversationIndexed(
                    topic=data.get("topic", ""),
                    entities_extracted=entities,
                    facts_extracted=facts,
                    source=data.get("indexing_source", "conversation"),
                    verified=data.get("indexing_verified", False),
                ))
        except Exception:
            pass
