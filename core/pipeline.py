"""Conversation pipeline — orchestrates the full turn sequence.

Uses Acervo as context proxy:
  acervo.prepare() → builds context from graph
  CLIENT streams LLM + handles MCP tools
  acervo.process() → extracts facts, persists to graph

Emits typed events at every step for full trace visibility.
"""

from __future__ import annotations

import json
import time

from core.event_bus import EventBus
from core.events import (
    AcervoDecision,
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
from acervo import Acervo, TopicVerdict
from acervo.graph import _make_id
from acervo.token_counter import count_tokens
from acervo._text import strip_think_blocks
from providers.base import ChatMessage
from providers.model_router import ModelRouter


class ConversationPipeline:
    """Orchestrates the full conversation turn.

    Delegates context building and extraction to Acervo.
    Owns: LLM streaming, MCP tool execution, confirmation logic, event emission.
    """

    _CONFIRM_WORDS = frozenset({
        "sí", "si", "correcto", "dale", "ok", "claro", "yes",
        "exacto", "así es", "confirmado", "eso", "sep", "sip",
        "afirmativo", "confirm", "yep", "yeah",
    })

    def __init__(
        self,
        bus: EventBus,
        router: ModelRouter,
        memory: Acervo,
        model_name: str = "",
        mcp=None,
    ) -> None:
        self._bus = bus
        self._router = router
        self._memory = memory
        self._graph = memory.graph
        self._model_name = model_name
        self._mcp = mcp
        self._pending_confirmation: dict | None = None
        self._pending_search: str = ""  # entity to search when user confirms
        self._search_authorized: bool = False  # user already said "si" to search
        self._last_context_payload: str = ""
        self._last_model_response: str = ""
        self._last_user_message: str = ""

    async def run_turn(
        self,
        user_text: str,
        history: list[ChatMessage],
        temperature: float = 0.7,
    ) -> str | None:
        """Execute full pipeline. Returns clean assistant response text."""

        # ── Step 0: Check pending confirmation ──
        if self._pending_confirmation:
            result = await self._check_confirmation(user_text)
            if result is not None:
                return result

        # ── Step 1: Message received ──
        msg_tokens = count_tokens(user_text)
        ctx_tokens = sum(count_tokens(m.content) for m in history)
        await self._bus.emit(MessageReceived(
            user_text=user_text,
            msg_tokens=msg_tokens,
            ctx_tokens=ctx_tokens,
            history_len=len(history),
        ))

        # ── Step 2: Acervo prepares context (topic detect + plan + build) ──
        history_dicts = [{"role": m.role, "content": m.content} for m in history]
        prep = await self._memory.prepare(user_text, history_dicts)

        # Emit topic events
        topic_detector = self._memory.topic_detector
        await self._bus.emit(TopicDetectStep(
            level=0, verdict="set", confidence=1.0,
            current_topic=prep.topic,
        ))

        # Emit planner decision
        await self._bus.emit(PlannerDecision(
            tool=prep.plan.tool, entity=prep.plan.entity, query=prep.plan.query,
        ))

        # ── Step 2.5b: Decide action ──
        _SEARCH_WORDS = frozenset(("buscá", "busca", "googleá", "googlea", "internet", "buscame", "buscalo"))
        _CONFIRM_WORDS_SEARCH = frozenset(("si", "sí", "dale", "ok", "claro", "yes", "porfa", "porfavor", "por", "favor"))
        msg_words = set(user_text.strip().lower().rstrip("!.?,").split())
        user_asked_search = bool(msg_words & _SEARCH_WORDS)
        user_confirmed_search = bool(
            self._pending_search and (msg_words & _CONFIRM_WORDS_SEARCH)
        )

        # Once user authorized search, follow-up questions auto-search
        is_followup = self._search_authorized and self._pending_search and not prep.has_context

        if prep.has_context:
            action = "graph"
            # If graph has data, we don't need auto-search anymore
            self._search_authorized = False
            self._pending_search = ""
        elif user_asked_search or user_confirmed_search or is_followup:
            action = "search"
            self._search_authorized = True
        elif not prep.has_context and self._mcp and self._mcp.has_servers:
            action = "ask_user"
            if not self._pending_search:
                self._pending_search = prep.plan.entity or prep.topic
        else:
            action = "no_data"

        await self._bus.emit(AcervoDecision(
            has_context=prep.has_context,
            needs_tool=prep.needs_tool,
            action=action,
        ))

        # ── Step 3: Client handles MCP tools if needed ──
        web_content = ""
        if action == "search" and self._mcp:
            # Build search query: entity + user's specific question
            base_entity = self._pending_search or prep.plan.entity or prep.topic
            # If user asked a specific follow-up, combine entity + question
            if user_asked_search or user_confirmed_search:
                # "si porfavor" → just search the entity
                # "busca cuantos libros tiene" → search "Harry Potter cuantos libros tiene"
                extra = user_text.strip()
                # Don't include confirmation words in the query
                if user_confirmed_search and len(msg_words) <= 3:
                    search_query = base_entity
                else:
                    search_query = f"{base_entity} {extra}" if base_entity.lower() not in extra.lower() else extra
            else:
                search_query = base_entity

            if search_query:
                web_content = await self._mcp.search_web(search_query)
                if web_content:
                    prep.add_web_results(web_content)
                    # Keep pending_search alive for follow-up questions
                    # Only clear when topic explicitly changes to something new

        # Emit executor result
        source = "web" if web_content else ("graph" if prep.warm_content else "empty")
        await self._bus.emit(ExecutorResultEvent(
            source=source,
            node_count=web_content.count("\n\n") if web_content else (
                prep.warm_content.count("# ") if prep.warm_content else 0
            ),
            fact_count=prep.warm_content.count("- ") if prep.warm_content else 0,
            content_preview=web_content[:500] if web_content else "",
        ))

        # ── Step 4: Inject instruction if no context ──
        # Skip instruction when we just searched (web results are in context)
        # or when user confirmed a search (even if it failed)
        context_stack = prep.context_stack
        if source == "empty" and action != "search" and context_stack:
            last = context_stack[-1]
            if last.get("role") == "user":
                is_question = user_text.rstrip().endswith("?") or any(
                    w in user_text.lower() for w in (
                        "sabes", "conoces", "qué ", "que ", "cómo ", "como ",
                        "cuándo", "cuando", "dónde", "donde",
                    )
                )
                entity_hint = prep.plan.entity or prep.topic
                if is_question:
                    if action == "ask_user":
                        # No data, MCP available — ask user if they want to search
                        instruction = (
                            f"[INSTRUCCIÓN: No tenés información verificada sobre '{entity_hint}'. "
                            "Respondé de forma natural: mencioná que no tenés datos guardados "
                            "pero que podés buscarlo en internet si quiere. "
                            "Preguntale si quiere que busques. No inventes datos.]\n\n"
                        )
                    else:
                        instruction = (
                            f"[INSTRUCCIÓN: No tenés información verificada sobre '{entity_hint}'. "
                            "Respondé de forma natural: mencioná que no tenés datos guardados "
                            "pero podés preguntar qué quiere saber o contarte. "
                            "No inventes datos. Sé conversacional.]\n\n"
                        )
                else:
                    instruction = (
                        "[INSTRUCCIÓN: El usuario te está dando información nueva. "
                        "Aceptala naturalmente y seguí la conversación. "
                        "No pidas confirmación.]\n\n"
                    )
                context_stack[-1] = {
                    "role": "user",
                    "content": instruction + last["content"],
                }

        # Emit context built
        ctx_payload = json.dumps(context_stack, ensure_ascii=False, indent=2)
        await self._bus.emit(ContextBuilt(
            hot_messages=len(context_stack) - 1,
            hot_tokens=prep.hot_tokens,
            warm_topic=prep.topic if prep.warm_tokens > 0 else "",
            warm_tokens=prep.warm_tokens,
            total_tokens=prep.total_tokens,
            context_summary=ctx_payload,
        ))

        # ── Step 5: LLM streaming ──
        # Convert dict messages to ChatMessage for the router
        chat_messages = [ChatMessage(role=m["role"], content=m["content"]) for m in context_stack]
        clean_text = await self._step_stream(chat_messages, temperature)

        # ── Step 6: Acervo processes response (extract + persist) ──
        await self._bus.emit(ExtractionStarted())
        try:
            result = await self._memory.process(user_text, clean_text, web_results=web_content)
            pairs = [(e.name, e.type) for e in result.entities]
            await self._bus.emit(ExtractionCompleted(entities=tuple(pairs)))

            if result.entities:
                for f in result.facts:
                    if f.speaker == "assistant":
                        await self._bus.emit(FactFiltered(
                            entity=f.entity, fact=f.fact, reason="assistant_speaker",
                        ))
                for entity, fact, reason in self._graph.dedup_log:
                    await self._bus.emit(FactFiltered(
                        entity=entity, fact=fact, reason="duplicate",
                    ))
                await self._bus.emit(GraphUpdated(
                    node_count=self._graph.node_count,
                    edge_count=self._graph.edge_count,
                ))
        except Exception as e:
            await self._bus.emit(ExtractionCompleted(error=str(e)))

        # ── Step 7: Check if model asked for confirmation ──
        await self._detect_confirmation(clean_text)

        self._last_context_payload = ctx_payload
        self._last_model_response = clean_text
        self._last_user_message = user_text

        return clean_text

    async def force_compact(self, history: list[ChatMessage], topic: str) -> None:
        """Force compaction on session close."""
        if topic == "none" or len(history) < 3:
            return
        try:
            history_dicts = [{"role": m.role, "content": m.content} for m in history]
            compacted = await self._memory.context_index.maybe_compact(history_dicts, topic)
            if compacted:
                await self._bus.emit(CompactionCompleted(compacted=True, overflow_tokens=0))
        except Exception:
            pass

    # ── Confirmation logic ──

    async def _check_confirmation(self, user_text: str) -> str | None:
        pending = self._pending_confirmation
        if not pending:
            return None

        msg_clean = user_text.strip().lower().rstrip("!.?,")
        words = set(msg_clean.split())
        is_confirm = msg_clean in self._CONFIRM_WORDS or bool(words & self._CONFIRM_WORDS)

        if is_confirm:
            entity = pending["entity"]
            fact = pending["fact"]
            corrections = pending.get("corrections", [])

            for corr in corrections:
                if corr.get("remove_edge"):
                    src, tgt, rel = corr["remove_edge"]
                    self._graph.remove_edge(src, tgt, rel)
                if corr.get("remove_fact"):
                    ent, ft = corr["remove_fact"]
                    self._graph.remove_fact(ent, ft)

            node_id = _make_id(entity)
            now_str = __import__("datetime").datetime.now().strftime("%Y-%m-%d")
            session_id = self._graph.session_id

            node = self._graph.get_node(node_id)
            if node:
                node["facts"].append({
                    "fact": fact, "date": now_str,
                    "session": session_id, "source": "user_confirmed",
                })
            else:
                self._graph.upsert_entities(
                    [(entity, "entidad")],
                    facts=[(entity, fact, "user_confirmed")],
                )
            self._graph.save()

            await self._bus.emit(ConfirmationAccepted(entity=entity, fact=fact))
            save_sample(
                context_sent=self._last_context_payload,
                user_message=user_text,
                model_response=self._last_model_response,
                correction=fact, sample_type="confirmation",
            )
            await self._bus.emit(TrainingSampleSaved(
                sample_type="confirmation", entity=entity,
            ))
            self._pending_confirmation = None
            return f"Guardado: {entity} — {fact}"
        else:
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

    async def _detect_confirmation(self, response_text: str) -> None:
        lower = response_text.lower()
        if "¿lo confirmo como dato verificado?" not in lower:
            return

        idx = lower.find("¿lo confirmo")
        if idx < 0:
            return

        before = response_text[:idx].strip().rstrip(".").strip()
        for prefix in ("Entendido —", "Entendido -", "Entendido,"):
            if before.startswith(prefix):
                before = before[len(prefix):].strip()
                break

        if not before or len(before) < 3:
            return

        user_msg_lower = self._last_user_message.lower()
        entity = ""
        best_pos = len(user_msg_lower) + 1

        for node in self._graph.get_all_nodes():
            label = node.get("label", "")
            if not label:
                continue
            pos = user_msg_lower.find(label.lower())
            if pos >= 0 and pos < best_pos:
                entity = label
                best_pos = pos

        if not entity:
            for node in self._graph.get_all_nodes():
                label = node.get("label", "")
                if label and label.lower() in before.lower():
                    entity = label
                    break

        if not entity:
            entity = self._memory.topic_detector.current_topic

        corrections: list[dict] = []
        entity_id = _make_id(entity)
        for edge in self._graph.get_edges_for(entity_id):
            rel = edge.get("relation", "")
            if rel in ("ubicado_en", "pertenece_a", "parte_de"):
                other_id = edge["target"] if edge["source"] == entity_id else edge["source"]
                other_node = self._graph.get_node(other_id)
                other_label = other_node.get("label", "") if other_node else ""
                if other_label.lower() in before.lower():
                    corrections.append({"remove_edge": (entity, other_label, rel)})

        self._pending_confirmation = {
            "entity": entity, "fact": before, "corrections": corrections,
        }
        await self._bus.emit(ConfirmationPending(entity=entity, fact=before))

        save_sample(
            context_sent=self._last_context_payload,
            user_message=self._last_user_message,
            model_response=response_text,
            correction=before, sample_type="correction",
        )
        await self._bus.emit(TrainingSampleSaved(
            sample_type="correction", entity=entity,
        ))

    # ── LLM streaming ──

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
