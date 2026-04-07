"""Annotation store — persists per-turn annotations for training data export.

Annotations record what each pipeline stage *should* have produced,
enabling JSONL export for fine-tuning the extractor and curator models.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


class AnnotationStore:
    """In-memory + JSONL-backed annotation storage keyed by turn_id."""

    def __init__(self, persist_path: Path | None = None) -> None:
        self._path = persist_path
        self._annotations: dict[int, dict[str, Any]] = {}
        if persist_path:
            self._load()

    def get(self, turn_id: int) -> dict[str, Any] | None:
        return self._annotations.get(turn_id)

    def get_all(self) -> dict[int, dict[str, Any]]:
        return dict(self._annotations)

    def save(self, turn_id: int, annotation: dict[str, Any]) -> None:
        """Save or update an annotation for a turn."""
        annotation["turn_id"] = turn_id
        self._annotations[turn_id] = annotation
        self._persist()

    def delete(self, turn_id: int) -> bool:
        if turn_id in self._annotations:
            del self._annotations[turn_id]
            self._persist()
            return True
        return False

    def export_training_jsonl(
        self,
        spans: list[dict[str, Any]],
        annotated_only: bool = True,
    ) -> list[dict[str, Any]]:
        """Generate training examples from annotated turns.

        Each example pairs the S1 prompt (from the span's debug data)
        with the expected output (from the annotation).
        Returns a list of dicts, each ready to be serialized as one JSONL line.
        """
        examples: list[dict[str, Any]] = []
        span_by_turn: dict[int, dict] = {s.get("turn_id", 0): s for s in spans}

        for turn_id, ann in self._annotations.items():
            if annotated_only and ann.get("status") != "annotated":
                continue

            span = span_by_turn.get(turn_id)
            if not span:
                continue

            # Build S1 training example if annotation has s1_expected
            s1_expected = ann.get("s1_expected")
            if s1_expected:
                # Get the S1 prompt from the span's stage_data (debug dict)
                stage_data = self._get_stage_data(span)
                s1_prompt = stage_data.get("s1_prompt", "")

                if s1_prompt:
                    try:
                        messages = json.loads(s1_prompt)
                    except (json.JSONDecodeError, TypeError):
                        messages = []

                    if messages:
                        # Build training example
                        expected_json = json.dumps(s1_expected, ensure_ascii=False)
                        examples.append({
                            "messages": [
                                *messages,  # system + user from S1 prompt
                                {"role": "assistant", "content": expected_json},
                            ]
                        })

            # Build S1.5 training example if annotation has s15_expected
            s15_expected = ann.get("s15_expected")
            if s15_expected and s15_expected.get("entities") or s15_expected.get("relations"):
                stage_data = self._get_stage_data(span)
                s15_prompt = stage_data.get("s15_prompt", "")
                if s15_prompt:
                    try:
                        messages = json.loads(s15_prompt)
                    except (json.JSONDecodeError, TypeError):
                        messages = []
                    if messages:
                        expected_json = json.dumps(s15_expected, ensure_ascii=False)
                        examples.append({
                            "messages": [
                                *messages,
                                {"role": "assistant", "content": expected_json},
                            ]
                        })

        return examples

    @staticmethod
    def _get_stage_data(span: dict) -> dict:
        """Extract stage_data from a telemetry span (may be in trace events)."""
        # stage_data is stored as JSON string in the span or trace event
        raw = span.get("stage_data", "")
        if isinstance(raw, str) and raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
        if isinstance(raw, dict):
            return raw
        return {}

    # ── Persistence ──

    def _persist(self) -> None:
        """Rewrite the JSONL file with all annotations."""
        if not self._path:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._path, "w", encoding="utf-8") as f:
                for ann in self._annotations.values():
                    f.write(json.dumps(ann, ensure_ascii=False, default=str) + "\n")
        except Exception as e:
            log.warning("Failed to persist annotations: %s", e)

    def _load(self) -> None:
        """Load annotations from JSONL."""
        if not self._path or not self._path.exists():
            return
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ann = json.loads(line)
                        turn_id = ann.get("turn_id")
                        if turn_id is not None:
                            self._annotations[int(turn_id)] = ann
                    except (json.JSONDecodeError, ValueError):
                        continue
        except Exception:
            pass
