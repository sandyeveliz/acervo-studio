"""Agent configuration loader — shared by session and REST routes."""

from __future__ import annotations

from pathlib import Path

import yaml

AGENTS_DIR = Path(__file__).resolve().parent / "agents"


def load_agent_config(name: str = "default") -> dict:
    """Load an agent YAML config by name."""
    path = AGENTS_DIR / f"{name}.yaml"
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)
