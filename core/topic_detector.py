"""Topic change detection — 3 levels of ascending cost.

Level 1: Keyword matching (free)
Level 2: Embedding cosine similarity via Ollama (fast)
Level 3: LLM classification via LM Studio (only if Level 2 is ambiguous)

Topic label extraction never calls the LLM. It uses embedding similarity
against known topics, or stopword filtering for new topics.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum

from config.settings import ContextSettings
from providers.model_router import ModelRouter
from utils.text import strip_think_blocks

log = logging.getLogger(__name__)


class TopicVerdict(Enum):
    SAME = "same"
    SUBTOPIC = "subtopic"
    CHANGED = "changed"


@dataclass
class DetectionResult:
    verdict: TopicVerdict
    level: int                  # 1, 2, or 3
    confidence: float
    current_topic: str
    detected_topic: str | None
    # Optional detail fields for trace display
    keyword: str | None = None       # L1: matched keyword
    similarity: float | None = None  # L2: cosine similarity
    answer: str | None = None        # L3: model answer
    detail: str = ""                 # human-readable extra


# --- Level 1: keyword patterns ---

_CHANGE_PATTERNS_ES = [
    r"cambiando de tema",
    r"cambiemos de tema",
    r"otra cosa",
    r"ahora sobre",
    r"hablando de otra cosa",
    r"pasemos a",
    r"dejando eso",
    r"volviendo a",
    r"te quiero preguntar sobre",
    r"te pregunto otra cosa",
    r"nada que ver pero",
]

_CHANGE_PATTERNS_EN = [
    r"changing topic",
    r"on another note",
    r"switching to",
    r"let'?s talk about",
    r"moving on to",
    r"by the way",
    r"unrelated,? but",
    r"different question",
    r"going back to",
]

_CHANGE_RE = re.compile(
    "|".join(_CHANGE_PATTERNS_ES + _CHANGE_PATTERNS_EN),
    re.IGNORECASE,
)

# --- Level 3: classification prompt (the ONLY LLM call in this module) ---

_CLASSIFY_PROMPT = """Dado el topic actual y un nuevo mensaje, clasificá la relación.

Topic actual: {topic}
Nuevo mensaje: {message}

Respondé SOLO con una letra:
a) Mismo tema
b) Sub-tema nuevo
c) Tema diferente

Respuesta:"""

# --- Stopwords for keyword extraction (no LLM needed) ---

_STOPWORDS = frozenset(
    # Spanish
    "de del la las el los un una uno unas unos al lo le les se nos me te "
    "y e o u a ante con contra en entre para por sin sobre tras desde hacia "
    "que qué es son ser estar fue era soy eres está como cómo más pero si "
    "no ya yo tú él ella eso esto esa ese mi tu su muy hay hoy bien mal "
    "todo toda todos todas otro otra otros otras este esta estos estas "
    "quiero quieres puede pueden hacer hablemos hablamos hablar decir decime "
    "vamos voy tengo tiene tenemos algo nada mucho poco donde cuando ahora "
    # English
    "the a an and or but in on at to for of is am are was were be been being "
    "do does did have has had will would shall should can could may might "
    "i you he she it we they me him her us them my your his its our their "
    "this that these those what which who whom how when where why not no "
    "so if up out about into with from by very just also some any all "
    "let lets talk about tell me know want need think".split()
)


@dataclass
class _KnownTopic:
    """A topic seen in this session, with its cached embedding."""
    label: str
    embedding: list[float]


class TopicDetector:
    """Detects topic changes using a 3-level cascade.

    - L1 (keywords): free, always runs
    - L2 (embeddings via Ollama): fast, runs when there's a prior topic
    - L3 (LLM classification): only when L2 is ambiguous

    Topic label extraction NEVER calls the LLM. It either matches a known
    topic by embedding similarity, or extracts keywords from the message.
    """

    def __init__(self, router: ModelRouter, settings: ContextSettings) -> None:
        self._router = router
        self._embed_threshold = settings.topic_change_embed_threshold
        self._current_topic: str = "none"
        self._current_topic_embedding: list[float] | None = None
        self._known_topics: list[_KnownTopic] = []

    @property
    def current_topic(self) -> str:
        return self._current_topic

    @current_topic.setter
    def current_topic(self, label: str) -> None:
        self._current_topic = label
        self._current_topic_embedding = None

    async def extract_topic_label(self, message: str) -> str:
        """Extract a topic label.

        Strategy:
        1. If there are known topics, embed the message and compare against
           all known topic embeddings. Return the closest if above threshold.
        2. Otherwise, use the utility model to extract a 2-5 word label.
        3. Fallback: keyword extraction (no LLM, no network).
        """
        clean = strip_think_blocks(message)

        # Strategy 1: match against known topics via embeddings
        if self._known_topics:
            try:
                label = await self._match_known_topic(clean)
                if label:
                    log.info("topic_extract method=embedding label=\"%s\"", label)
                    return label
            except Exception as e:
                log.info(
                    "topic_extract method=embedding failed=%s",
                    str(e)[:60].replace(" ", "_"),
                )

        # Strategy 2: use utility model for consistent labeling
        try:
            label = await self._extract_label_via_llm(clean)
            if label:
                log.info("topic_extract method=llm_utility label=\"%s\"", label)
                try:
                    resp = await self._router.embed(label)
                    self._known_topics.append(_KnownTopic(label=label, embedding=resp.embedding))
                except Exception:
                    pass
                return label
        except Exception as e:
            log.info("topic_extract method=llm_utility failed=%s", str(e)[:60])

        # Strategy 3: fallback to keyword extraction
        label = _extract_keywords(clean)
        log.info("topic_extract method=keywords label=\"%s\"", label)
        return label

    async def _extract_label_via_llm(self, message: str) -> str:
        """Use the utility model to extract a topic label in 2-5 words."""
        from providers.base import ChatMessage as CM
        import re as _re

        prompt = (
            "Extraé el tema principal de este mensaje en 2-5 palabras en español. "
            "Respondé SOLO con el nombre del tema, nada más.\n\n"
            f"Mensaje: {message[:300]}\n\nTema:"
        )
        response = await self._router.chat_utility(
            [CM(role="user", content=prompt)],
            temperature=0.0,
            max_tokens=20,
        )
        raw = strip_think_blocks(response.content).strip()
        raw = _re.sub(r"```(?:json)?\s*", "", raw).strip()
        label = raw.strip('"').strip("'").strip()
        # Remove any non-Latin characters (Chinese, etc.) that Qwen sometimes produces
        label = _re.sub(r"[^\w\s\-áéíóúñüÁÉÍÓÚÑÜ]", "", label).strip()
        return label if label and len(label) < 60 else ""

    async def _match_known_topic(self, message: str) -> str | None:
        """Compare message embedding against all known topics."""
        msg_resp = await self._router.embed(message)
        msg_emb = msg_resp.embedding

        best_label: str | None = None
        best_sim = 0.0

        for known in self._known_topics:
            sim = _cosine_similarity(msg_emb, known.embedding)
            if sim > best_sim:
                best_sim = sim
                best_label = known.label

        if best_sim >= self._embed_threshold and best_label:
            return best_label

        return None

    async def detect(self, message: str) -> DetectionResult:
        """Run the 3-level detection cascade on a user message."""
        clean_msg = strip_think_blocks(message)

        # Level 1: keywords — always runs
        result = self._level1_keywords(clean_msg)
        if result is not None:
            return result

        # No prior topic — first message, nothing to compare against.
        if self._current_topic == "none":
            log.info("topic_detect level=1 verdict=first_message topic=none")
            return DetectionResult(
                verdict=TopicVerdict.CHANGED,
                level=1,
                confidence=1.0,
                current_topic="none",
                detected_topic=None,
            )

        # Level 2: embeddings — always runs when there's a prior topic
        try:
            result = await self._level2_embeddings(clean_msg)
            if result is not None:
                return result
        except Exception as e:
            log.info(
                "topic_detect level=2 verdict=skipped reason=embed_error detail=%s topic=%s",
                str(e)[:80].replace(" ", "_"),
                self._current_topic,
            )

        # Level 3: LLM classification — only when L2 is ambiguous or failed
        try:
            return await self._level3_llm(clean_msg)
        except Exception as e:
            log.info(
                "topic_detect level=3 verdict=skipped reason=llm_error detail=%s topic=%s",
                str(e)[:80].replace(" ", "_"),
                self._current_topic,
            )
            return DetectionResult(
                verdict=TopicVerdict.SAME,
                level=1,
                confidence=0.0,
                current_topic=self._current_topic,
                detected_topic=None,
            )

    def _level1_keywords(self, message: str) -> DetectionResult | None:
        start = time.perf_counter()
        match = _CHANGE_RE.search(message)
        elapsed = (time.perf_counter() - start) * 1000

        if match:
            keyword = match.group()
            log.info(
                "topic_detect level=1 verdict=changed keyword=%s elapsed=%.1fms topic=%s",
                keyword, elapsed, self._current_topic,
            )
            return DetectionResult(
                verdict=TopicVerdict.CHANGED,
                level=1,
                confidence=1.0,
                current_topic=self._current_topic,
                detected_topic=None,
                keyword=keyword,
            )

        log.info(
            "topic_detect level=1 verdict=no_match elapsed=%.1fms topic=%s",
            elapsed, self._current_topic,
        )
        return None

    async def _level2_embeddings(self, message: str) -> DetectionResult | None:
        start = time.perf_counter()

        if self._current_topic_embedding is None:
            topic_resp = await self._router.embed(self._current_topic)
            self._current_topic_embedding = topic_resp.embedding

        msg_resp = await self._router.embed(message)
        similarity = _cosine_similarity(self._current_topic_embedding, msg_resp.embedding)
        elapsed = (time.perf_counter() - start) * 1000

        if similarity >= 0.80:
            log.info(
                "topic_detect level=2 verdict=same similarity=%.3f elapsed=%.0fms topic=%s",
                similarity, elapsed, self._current_topic,
            )
            return DetectionResult(
                verdict=TopicVerdict.SAME,
                level=2,
                confidence=similarity,
                current_topic=self._current_topic,
                detected_topic=None,
                similarity=similarity,
            )

        if similarity < self._embed_threshold:
            log.info(
                "topic_detect level=2 verdict=changed similarity=%.3f threshold=%.2f elapsed=%.0fms topic=%s",
                similarity, self._embed_threshold, elapsed, self._current_topic,
            )
            return DetectionResult(
                verdict=TopicVerdict.CHANGED,
                level=2,
                confidence=1.0 - similarity,
                current_topic=self._current_topic,
                detected_topic=None,
                similarity=similarity,
            )

        log.info(
            "topic_detect level=2 verdict=ambiguous similarity=%.3f elapsed=%.0fms topic=%s",
            similarity, elapsed, self._current_topic,
        )
        return None

    async def _level3_llm(self, message: str) -> DetectionResult:
        """LLM classification: a/b/c only. The ONLY LLM call in this module."""
        from providers.base import ChatMessage

        prompt = _CLASSIFY_PROMPT.format(
            topic=self._current_topic,
            message=message[:500],
        )

        start = time.perf_counter()
        response = await self._router.chat_utility(
            [ChatMessage(role="user", content=prompt)],
            temperature=0.0,
            max_tokens=5,
        )
        elapsed = (time.perf_counter() - start) * 1000

        answer = strip_think_blocks(response.content).strip().lower()

        if answer.startswith("b"):
            verdict = TopicVerdict.SUBTOPIC
        elif answer.startswith("c"):
            verdict = TopicVerdict.CHANGED
        else:
            verdict = TopicVerdict.SAME

        log.info(
            "topic_detect level=3 verdict=%s answer=%s elapsed=%.0fms tokens=%d topic=%s",
            verdict.value, answer[:10], elapsed, response.total_tokens, self._current_topic,
        )

        return DetectionResult(
            verdict=verdict,
            level=3,
            confidence=0.8,
            current_topic=self._current_topic,
            detected_topic=None,
            answer=answer[:10],
        )


def _extract_keywords(text: str, max_words: int = 3) -> str:
    """Extract 2-3 meaningful words from text by filtering stopwords."""
    words = re.findall(r"[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+", text.lower())
    keywords = [w for w in words if w not in _STOPWORDS and len(w) > 2]
    if not keywords:
        # Fallback: take first non-trivial words
        keywords = [w for w in words if len(w) > 2][:max_words]
    return " ".join(keywords[:max_words]) if keywords else "sin topic"


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
