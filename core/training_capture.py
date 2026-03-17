"""Training data capture — saves correction pairs as JSONL for future fine-tuning.

Silent system. The user sees nothing — only a trace event is emitted.
Each line in the JSONL file is a self-contained training sample.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_PATH = Path("data/training/corrections.jsonl")


def save_sample(
    context_sent: str,
    user_message: str,
    model_response: str,
    correction: str,
    sample_type: str,
    path: Path = _DEFAULT_PATH,
) -> None:
    """Append a training sample to the JSONL file.

    Args:
        context_sent: Full JSON payload sent to the LLM (with roles).
        user_message: The user's message that triggered this capture.
        model_response: The model's response.
        correction: The correction text or confirmed fact.
        sample_type: One of "correction", "confirmation", "rejection".
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "context_sent": context_sent,
        "user_message": user_message,
        "model_response": model_response,
        "correction": correction,
        "correct_response": None,
        "type": sample_type,
    }
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    log.info("Training sample saved: type=%s", sample_type)
