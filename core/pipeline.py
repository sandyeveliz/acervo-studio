"""Conversation pipeline — orchestrates the full turn sequence.

Full flow matching architecture diagram:
  receive → detect topic → route → synthesize → build context → stream LLM
  → compact → extract → persist graph

Emits typed events at every step for full trace visibility.
"""

from __future__ import annotations

import asyncio
import json
import time

from core.context_index import ContextIndex
from core.context_synthesizer import synthesize
from core.event_bus import EventBus
from core.events import (
    CompactionCompleted,
    ConfirmationAccepted,
    ConfirmationPending,
    ContextBuilt,
    ExecutorResult as ExecutorResultEvent,
    ExtractionCompleted,
    ExtractionStarted,
    FactFiltered,
    GraphUpdated,
    MessageReceived,
    PipelineError,
    PlannerDecision,
    StreamChunkReceived,
    StreamCompleted,
    StreamStarted,
    TopicChanged,
    TopicDetectStep,
    TrainingSampleSaved,
)
from core.training_capture import save_sample
from core.query_planner import QueryPlanner
from core.executor import PlanExecutor
from core.topic_detector import TopicDetector, TopicVerdict
from memory.extractor import ConversationExtractor, ExtractionResult
from memory.graph import TopicGraph
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from utils.text import strip_think_blocks
from utils.token_counter import count_tokens


class ConversationPipeline:
    """Orchestrates the full conversation turn. Communicates via EventBus."""

    _CONFIRM_WORDS = frozenset({
        "sí", "si", "correcto", "dale", "ok", "claro", "yes",
        "exacto", "así es", "confirmado", "eso", "sep", "sip",
        "afirmativo", "confirm", "yep", "yeah",
    })

    def __init__(
        self,
        bus: EventBus,
        router: ModelRouter,
        topic_detector: TopicDetector,
        extractor: ConversationExtractor,
        graph: TopicGraph,
        context_index: ContextIndex,
        model_name: str = "",
    ) -> None:
        self._bus = bus
        self._router = router
        self._topic_detector = topic_detector
        self._extractor = extractor
        self._graph = graph
        self._context_index = context_index
        self._model_name = model_name
        self._planner = QueryPlanner(router)
        self._executor = PlanExecutor(graph)
        self._pending_confirmation: dict | None = None  # {entity, fact}
        # State for training data capture
        self._last_context_payload: str = ""
        self._last_model_response: str = ""
        self._last_user_message: str = ""

    async def run_turn(
        self,
        user_text: str,
        history: list[ChatMessage],
        temperature: float = 0.7,
    ) -> str | None:
        """Execute full pipeline. Returns clean assistant response text, or None if handled internally."""

        # ── Step 0: Check pending confirmation ──
        if self._pending_confirmation:
            result = await self._check_confirmation(user_text)
            if result is not None:
                return result

        # Cycle graph status: hot→warm→cold
        self._graph.cycle_status()

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

        # ── Step 2.3: Activate graph nodes mentioned in user message ──
        self._activate_mentioned_nodes(user_text)

        # ── Step 2.4: Keep current topic node hot while topic unchanged ──
        current_topic = self._topic_detector.current_topic
        if current_topic != "none":
            from memory.graph import _make_id
            topic_id = _make_id(current_topic)
            if topic_id in self._graph._nodes:
                self._graph._nodes[topic_id]["status"] = "hot"

        # ── Step 2.5: Query Planner (LLM decides what to search) ──
        from memory.graph import _make_id as _mk
        entity_node = self._graph._nodes.get(_mk(current_topic)) if current_topic != "none" else None
        facts_summary = ", ".join(
            f.get("fact", "") for f in (entity_node.get("facts", []) if entity_node else [])
        )[:500]

        plan = await self._planner.plan(
            user_text, current_topic if current_topic != "none" else "",
            entity_node.get("type", "") if entity_node else "",
            facts_summary,
        )
        await self._bus.emit(PlannerDecision(
            tool=plan.tool, entity=plan.entity, query=plan.query,
        ))

        # ── Step 2.6: Execute the plan ──
        exec_result = await self._executor.execute(plan)
        await self._bus.emit(ExecutorResultEvent(
            source=exec_result.source,
            node_count=exec_result.node_count,
            fact_count=exec_result.fact_count,
        ))

        # ── Step 2.7: Build context stack with executor result ──
        context_stack, hot_tk, warm_tk, total_tk = await self._context_index.build_context_stack(
            history, current_topic, warm_override=exec_result.content,
        )

        # If executor returned empty AND user is asking a question, inject instruction
        # Don't inject when user is stating facts (affirmations don't end with ?)
        is_question = user_text.rstrip().endswith("?") or any(
            w in user_text.lower() for w in ("sabes", "conoces", "qué ", "que ", "cómo ", "como ", "cuándo", "cuando", "dónde", "donde")
        )
        if exec_result.source == "empty" and is_question and context_stack:
            last = context_stack[-1]
            if last.role == "user":
                context_stack[-1] = ChatMessage(
                    role="user",
                    content=(
                        "[INSTRUCCIÓN: No hay información verificada disponible. "
                        "Respondé: 'No tengo información verificada sobre eso. ¿Me podés contar más?']\n\n"
                        + last.content
                    ),
                )

        # Context payload as JSON — exact messages sent to LLM
        ctx_payload = [{"role": m.role, "content": m.content} for m in context_stack]
        context_summary = json.dumps(ctx_payload, ensure_ascii=False, indent=2)

        await self._bus.emit(ContextBuilt(
            hot_messages=len(context_stack) - 1,
            hot_tokens=hot_tk,
            warm_topic=current_topic if warm_tk > 0 else "",
            warm_tokens=warm_tk,
            total_tokens=total_tk,
            context_summary=context_summary,
        ))

        # ── Step 2.8: Extract evicted pairs (sliding window overflow) ──
        await self._extract_evicted_pairs(history)

        # ── Step 3: LLM streaming ──
        clean_text = await self._step_stream(context_stack, temperature)

        # ── Step 4: Entity extraction on current turn ──
        await self._step_extract_and_persist(user_text, clean_text)

        # ── Step 5: Check if model asked for confirmation ──
        await self._detect_confirmation(clean_text)

        # Save state for training capture (needed in next turn for confirmation)
        self._last_context_payload = context_summary
        self._last_model_response = clean_text
        self._last_user_message = user_text

        return clean_text

    def _activate_mentioned_nodes(self, user_text: str) -> None:
        """Set graph nodes to 'hot' if the user message mentions them.

        Supports exact match, substring/alias match (e.g. 'cipo' → 'cipolletti'),
        and multi-word label match.
        """
        msg_lower = user_text.lower()
        msg_words = set(msg_lower.split())
        for node in self._graph._nodes.values():
            label = node.get("label", "").lower()
            if not label or len(label) < 3:
                continue
            # Exact match: label appears in message
            if label in msg_lower:
                node["status"] = "hot"
                continue
            # Alias/prefix match: "cipo" matches "cipolletti"
            for word in msg_words:
                if len(word) >= 4 and label.startswith(word):
                    node["status"] = "hot"
                    break
            # Multi-word label: all words present in message
            label_words = set(label.split())
            if len(label_words) > 1 and label_words.issubset(msg_words):
                node["status"] = "hot"

    async def _extract_evicted_pairs(self, history: list[ChatMessage]) -> None:
        """Extract entities/facts from pairs that fell out of the sliding window.

        Uses _last_included_pairs and _last_total_pairs from context_index
        to identify which pairs were evicted this turn.
        """
        ci = self._context_index
        included = getattr(ci, "_last_included_pairs", 0)
        total = getattr(ci, "_last_total_pairs", 0)
        evicted_count = total - included

        if evicted_count <= 0:
            return

        # Get conversation without system prompt
        conversation = history[1:]
        # Walk backwards to find pairs (same logic as context_index)
        pairs: list[tuple[ChatMessage, ChatMessage]] = []
        i = len(conversation) - 2  # skip current user message
        while i >= 1:
            if conversation[i].role == "assistant" and conversation[i - 1].role == "user":
                pairs.append((conversation[i - 1], conversation[i]))
                i -= 2
            else:
                i -= 1

        # Evicted pairs are the ones beyond the included window
        evicted = pairs[included:included + evicted_count]
        for user_msg, asst_msg in evicted:
            try:
                await self._step_extract_and_persist(user_msg.content, asst_msg.content)
            except Exception:
                pass  # Don't break pipeline for eviction extraction

    async def force_compact(self, history: list[ChatMessage], topic: str) -> None:
        """Force compaction on session close."""
        if topic == "none" or len(history) < 3:
            return
        try:
            compacted = await self._context_index.maybe_compact(history, topic)
            if compacted:
                await self._bus.emit(CompactionCompleted(compacted=True, overflow_tokens=0))
        except Exception:
            pass

    # ── Confirmation logic ──

    async def _check_confirmation(self, user_text: str) -> str | None:
        """Check if user is confirming a pending fact. Returns response or None."""
        pending = self._pending_confirmation
        if not pending:
            return None

        # Check if user's message is a confirmation
        msg_clean = user_text.strip().lower().rstrip("!.?")
        is_confirm = msg_clean in self._CONFIRM_WORDS

        if is_confirm:
            entity = pending["entity"]
            fact = pending["fact"]
            corrections = pending.get("corrections", [])

            # Apply corrections: remove contradicted edges/facts
            for corr in corrections:
                if corr.get("remove_edge"):
                    src, tgt, rel = corr["remove_edge"]
                    self._graph.remove_edge(src, tgt, rel)
                if corr.get("remove_fact"):
                    ent, ft = corr["remove_fact"]
                    self._graph.remove_fact(ent, ft)

            # Save the confirmed fact
            from memory.graph import _make_id
            node_id = _make_id(entity)
            now_str = __import__("datetime").datetime.now().strftime("%Y-%m-%d")
            session_id = self._graph._session_id

            if node_id in self._graph._nodes:
                node = self._graph._nodes[node_id]
                node["facts"].append({
                    "fact": fact,
                    "date": now_str,
                    "session": session_id,
                    "source": "user_confirmed",
                })
            else:
                self._graph.upsert_entities(
                    [{"name": entity, "type": "entidad"}],
                    facts=[{"entity": entity, "fact": fact, "source": "user_confirmed"}],
                )
            self._graph._save()

            await self._bus.emit(ConfirmationAccepted(entity=entity, fact=fact))

            # Training capture: confirmation
            save_sample(
                context_sent=self._last_context_payload,
                user_message=user_text,
                model_response=self._last_model_response,
                correction=fact,
                sample_type="confirmation",
            )
            await self._bus.emit(TrainingSampleSaved(
                sample_type="confirmation", entity=entity,
            ))

            self._pending_confirmation = None
            return f"Guardado: {entity} — {fact}"
        else:
            # Not a confirmation — training capture: rejection
            entity = pending.get("entity", "")
            save_sample(
                context_sent=self._last_context_payload,
                user_message=user_text,
                model_response=self._last_model_response,
                correction=pending.get("fact", ""),
                sample_type="rejection",
            )
            await self._bus.emit(TrainingSampleSaved(
                sample_type="rejection", entity=entity,
            ))

            self._pending_confirmation = None
            return None

    _CORRECTION_PATTERNS = (
        "no,", "no ", "mentira", "no es así", "no es asi", "está mal",
        "esta mal", "incorrecto", "error", "equivocado", "falso",
    )

    async def _detect_confirmation(self, response_text: str) -> None:
        """Detect if the model accepted a correction and is asking for confirmation.

        Only triggers when the model response contains '¿Lo confirmo como dato verificado?'
        AND we can find the corrected fact from the extraction results.
        """
        lower = response_text.lower()
        if "¿lo confirmo como dato verificado?" not in lower:
            return

        # Extract the fact from the text before the question
        idx = lower.find("¿lo confirmo")
        if idx < 0:
            return

        before = response_text[:idx].strip().rstrip(".").strip()
        # Remove "Entendido — " prefix if present
        for prefix in ("Entendido —", "Entendido -", "Entendido,"):
            if before.startswith(prefix):
                before = before[len(prefix):].strip()
                break

        if not before or len(before) < 3:
            return

        # Find the entity this fact is ABOUT.
        # Strategy: find which entity the user was asking about in their
        # last message (self._last_user_message), not just any match in
        # the model's response. The user's question subject is the entity.
        user_msg_lower = self._last_user_message.lower()
        entity = ""
        best_pos = len(user_msg_lower) + 1  # position in user message

        for node in self._graph._nodes.values():
            label = node.get("label", "")
            if not label:
                continue
            pos = user_msg_lower.find(label.lower())
            if pos >= 0 and pos < best_pos:
                entity = label
                best_pos = pos

        # If not found in user message, try the model response
        if not entity:
            for node in self._graph._nodes.values():
                label = node.get("label", "")
                if label and label.lower() in before.lower():
                    entity = label
                    break

        if not entity:
            entity = self._topic_detector.current_topic

        # Detect corrections: look for contradicted edges in the user's
        # original message from the current turn's history
        corrections: list[dict] = []
        # If the response mentions a correction, check existing edges
        # that contradict the new fact
        from memory.graph import _make_id
        entity_id = _make_id(entity)
        # Check if the fact contradicts existing edges (e.g., ubicado_en)
        for edge in self._graph._edges:
            if edge["source"] == entity_id or edge["target"] == entity_id:
                rel = edge.get("relation", "")
                if rel in ("ubicado_en", "pertenece_a", "parte_de"):
                    other_id = edge["target"] if edge["source"] == entity_id else edge["source"]
                    other_node = self._graph._nodes.get(other_id)
                    other_label = other_node.get("label", "") if other_node else ""
                    # If the correction mentions this isn't right
                    if other_label.lower() in before.lower():
                        corrections.append({
                            "remove_edge": (entity, other_label, rel),
                        })

        self._pending_confirmation = {
            "entity": entity,
            "fact": before,
            "corrections": corrections,
        }
        await self._bus.emit(ConfirmationPending(entity=entity, fact=before))

        # Training capture: correction detected
        save_sample(
            context_sent=self._last_context_payload,
            user_message=self._last_user_message,
            model_response=response_text,
            correction=before,
            sample_type="correction",
        )
        await self._bus.emit(TrainingSampleSaved(
            sample_type="correction", entity=entity,
        ))

    # ── Internal steps ──

    async def _step_topic_detect(self, user_text: str) -> None:
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
        self, context_stack: list[ChatMessage], temperature: float
    ) -> str:
        await self._bus.emit(StreamStarted(
            model=self._model_name,
            provider=self._router.active_provider,
            endpoint=self._router._settings.lmstudio.base_url,
            history_len=len(context_stack),
            temperature=temperature,
        ))

        full_text = ""
        start = time.perf_counter()
        first_token_time: float | None = None
        chunk_count = 0
        in_think_block = False

        try:
            async for chunk in self._router.chat_stream(
                context_stack, temperature=temperature,
            ):
                if not chunk.delta:
                    continue
                if first_token_time is None:
                    first_token_time = time.perf_counter()
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

    async def _step_compact(self, history: list[ChatMessage], topic: str) -> None:
        """Check if warm layer needs compaction and report result."""
        try:
            conversation = history[1:] if len(history) > 1 else []
            max_hot = self._context_index._settings.hot_layer_max_messages
            overflow = conversation[:-max_hot] if len(conversation) > max_hot else []
            overflow_tokens = sum(count_tokens(m.content) for m in overflow)

            compacted = await self._context_index.maybe_compact(history, topic)

            await self._bus.emit(CompactionCompleted(
                compacted=compacted,
                overflow_tokens=overflow_tokens,
            ))
        except Exception as e:
            await self._bus.emit(PipelineError(step="compact", error=str(e)))

    async def _step_extract_and_persist(
        self, user_text: str, assistant_text: str
    ) -> None:
        await self._bus.emit(ExtractionStarted())

        try:
            result = await self._extractor.extract(user_text, assistant_text)
            pairs = [(e.name, e.type) for e in result.entities]

            await self._bus.emit(ExtractionCompleted(entities=tuple(pairs)))
        except Exception as e:
            await self._bus.emit(ExtractionCompleted(error=str(e)))
            return

        if not result.entities:
            return

        # Filter facts: only keep user-stated facts, emit events for filtered
        user_facts = []
        for f in result.facts:
            if f.speaker == "assistant":
                await self._bus.emit(FactFiltered(
                    entity=f.entity, fact=f.fact, reason="assistant_speaker",
                ))
            else:
                user_facts.append((f.entity, f.fact, f.source))

        try:
            relations = [(r.source, r.target, r.relation) for r in result.relations]

            loop = asyncio.get_event_loop()
            node_count, edge_count = await loop.run_in_executor(
                None, self._graph.upsert_entities, pairs, relations, user_facts,
            )

            # Emit events for duplicate facts detected by the graph
            for entity, fact, reason in self._graph._dedup_log:
                await self._bus.emit(FactFiltered(
                    entity=entity, fact=fact, reason="duplicate",
                ))

            await self._bus.emit(GraphUpdated(
                node_count=node_count, edge_count=edge_count,
            ))
        except Exception as e:
            await self._bus.emit(PipelineError(step="graph_persist", error=str(e)))
