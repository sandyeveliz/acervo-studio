"""Conversation pipeline — orchestrates the full turn sequence.

Steps: receive → detect topic → stream LLM → extract entities → persist graph.
Emits typed events via EventBus. No TUI imports.
"""

from __future__ import annotations

import asyncio
import time

from core.event_bus import EventBus
from core.events import (
    DebugInfo,
    ExtractionCompleted,
    ExtractionStarted,
    GraphUpdated,
    MessageReceived,
    PipelineError,
    StreamChunkReceived,
    StreamCompleted,
    StreamStarted,
    TopicChanged,
    TopicDetectStep,
)
from core.topic_detector import TopicDetector, TopicVerdict
from memory.extractor import EntityExtractor
from memory.graph import TopicGraph
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from utils.text import strip_think_blocks
from utils.token_counter import count_tokens


class ConversationPipeline:
    """Orchestrates the full conversation turn.

    Pure async — no TUI dependency. Communicates via EventBus.
    """

    def __init__(
        self,
        bus: EventBus,
        router: ModelRouter,
        topic_detector: TopicDetector,
        extractor: EntityExtractor,
        graph: TopicGraph,
        model_name: str = "",
    ) -> None:
        self._bus = bus
        self._router = router
        self._topic_detector = topic_detector
        self._extractor = extractor
        self._graph = graph
        self._model_name = model_name

    async def run_turn(
        self,
        user_text: str,
        history: list[ChatMessage],
        temperature: float = 0.7,
    ) -> str:
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

        # ── Step 2: Topic detection ──
        await self._step_topic_detect(user_text)

        # ── Step 3: LLM streaming ──
        clean_text = await self._step_stream(history, temperature)

        # ── Step 4: Entity extraction ──
        entities = await self._step_extract(user_text, clean_text)

        # ── Step 5: Graph persistence ──
        if entities:
            await self._step_graph_persist(entities)

        return clean_text

    async def _step_topic_detect(self, user_text: str) -> None:
        """Run topic detection cascade and emit events."""
        try:
            detection = await self._topic_detector.detect(user_text)

            await self._bus.emit(TopicDetectStep(
                level=detection.level,
                verdict=detection.verdict.value,
                confidence=detection.confidence,
                current_topic=detection.current_topic,
                keyword=detection.keyword,
                similarity=detection.similarity,
                answer=detection.answer,
            ))

            if detection.verdict in (TopicVerdict.CHANGED, TopicVerdict.SUBTOPIC):
                prev = detection.current_topic
                new_label = await self._topic_detector.extract_topic_label(user_text)
                self._topic_detector.current_topic = new_label
                await self._bus.emit(TopicChanged(
                    new_topic=new_label,
                    previous_topic=prev,
                ))
        except Exception as e:
            await self._bus.emit(PipelineError(step="topic_detect", error=str(e)))

    async def _step_stream(
        self, history: list[ChatMessage], temperature: float
    ) -> str:
        """Stream LLM response and emit events. Returns clean text."""
        await self._bus.emit(StreamStarted(
            model=self._model_name,
            history_len=len(history),
            temperature=temperature,
        ))

        full_text = ""
        start = time.perf_counter()
        first_token_time: float | None = None
        chunk_count = 0
        in_think_block = False

        try:
            async for chunk in self._router.chat_stream(
                history, temperature=temperature,
            ):
                if not chunk.delta:
                    continue

                if first_token_time is None:
                    first_token_time = time.perf_counter()
                full_text += chunk.delta
                chunk_count += 1

                # Filter <think> for display
                if "<think>" in full_text and "</think>" not in full_text:
                    in_think_block = True
                if "</think>" in full_text:
                    in_think_block = False
                    await self._bus.emit(StreamChunkReceived(
                        display_text=strip_think_blocks(full_text),
                    ))
                elif not in_think_block:
                    await self._bus.emit(StreamChunkReceived(
                        display_text=strip_think_blocks(full_text),
                    ))

        except Exception as e:
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

    async def _step_extract(
        self, user_text: str, assistant_text: str
    ) -> list[tuple[str, str]]:
        """Extract entities and emit events. Returns list of (name, type) pairs."""
        await self._bus.emit(ExtractionStarted())

        try:
            entities = await self._extractor.extract(user_text, assistant_text)
            pairs = [(e.name, e.type) for e in entities]

            await self._bus.emit(ExtractionCompleted(
                entities=tuple(pairs),
            ))
        except Exception as e:
            pairs = []
            await self._bus.emit(ExtractionCompleted(
                error=str(e),
            ))

        return pairs

    async def _step_graph_persist(self, entities: list[tuple[str, str]]) -> None:
        """Persist entities to graph. Runs file I/O in executor."""
        try:
            loop = asyncio.get_event_loop()
            node_count, edge_count = await loop.run_in_executor(
                None, self._graph.upsert_entities, entities,
            )
            await self._bus.emit(GraphUpdated(
                node_count=node_count,
                edge_count=edge_count,
            ))
        except Exception as e:
            await self._bus.emit(PipelineError(step="graph_persist", error=str(e)))
