"""Settings loader — reads config/settings.toml and .env."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import tomli
import tomli_w
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_SETTINGS_PATH = _PROJECT_ROOT / "config" / "settings.toml"


def _load_toml() -> dict:
    with open(_SETTINGS_PATH, "rb") as f:
        return tomli.load(f)


@dataclass(frozen=True)
class LMStudioSettings:
    base_url: str
    model: str
    api_key: str
    context_window: int = 32_000
    kv_cache: bool = True


@dataclass(frozen=True)
class OllamaSettings:
    base_url: str
    embed_model: str


@dataclass(frozen=True)
class ContextSettings:
    hot_layer_max_messages: int = 2
    hot_layer_max_tokens: int = 500
    warm_layer_max_tokens: int = 800
    topic_change_embed_threshold: float = 0.65
    compaction_trigger_tokens: int = 2000


@dataclass(frozen=True)
class GraphSettings:
    persist_path: str = "data/graph"
    topics_path: str = "data/topics"
    sessions_path: str = "data/sessions"
    merge_similarity_threshold: float = 0.85


@dataclass(frozen=True)
class RoutingSettings:
    max_local_latency_ms: int = 3000
    sensitive_data_local_only: bool = True


@dataclass(frozen=True)
class PricingSettings:
    lmstudio: float = 0.000001      # $1/MTok
    ollama: float = 0.0
    openrouter: float = 0.000001
    anthropic: float = 0.000003

# Anthropic por token (precio por millón ÷ 1,000,000)
# anthropic_haiku_input = 0.000001      # $1/MTok
# anthropic_haiku_output = 0.000005     # $5/MTok
# anthropic_sonnet_input = 0.000003     # $3/MTok
# anthropic_sonnet_output = 0.000015    # $15/MTok
# anthropic_opus_input = 0.000005       # $5/MTok
# anthropic_opus_output = 0.000025      # $25/MTok

# OpenRouter varía por modelo, esto es un promedio
# openrouter_input = 0.000001
# openrouter_output = 0.000005


@dataclass(frozen=True)
class WebSearchSettings:
    api_key: str = ""
    max_results: int = 5
    enabled: bool = True


@dataclass(frozen=True)
class TUISettings:
    refresh_rate: int = 10
    log_max_lines: int = 500


@dataclass(frozen=True)
class Settings:
    lmstudio: LMStudioSettings
    lmstudio_utility: LMStudioSettings
    ollama: OllamaSettings
    context: ContextSettings
    graph: GraphSettings
    routing: RoutingSettings
    pricing: PricingSettings
    tui: TUISettings
    web_search: WebSearchSettings


def load_settings() -> Settings:
    """Load settings from settings.toml + .env and return a frozen Settings object."""
    load_dotenv(_PROJECT_ROOT / ".env")
    raw = _load_toml()

    lm = raw.get("lmstudio", {})
    lmu = raw.get("lmstudio_utility", {})
    ol = raw.get("ollama", {})

    return Settings(
        lmstudio=LMStudioSettings(
            base_url=os.getenv("LMSTUDIO_BASE_URL", lm.get("base_url", "http://localhost:1234/v1")),
            model=os.getenv("LMSTUDIO_MODEL", lm.get("model", "qwen2.5-9b-instruct")),
            api_key=os.getenv("LMSTUDIO_API_KEY", "lm-studio"),
            context_window=lm.get("context_window", 32_000),
            kv_cache=lm.get("kv_cache", True),
        ),
        lmstudio_utility=LMStudioSettings(
            base_url=os.getenv("LMSTUDIO_UTILITY_BASE_URL", lmu.get("base_url", lm.get("base_url", "http://localhost:1234/v1"))),
            model=os.getenv("LMSTUDIO_UTILITY_MODEL", lmu.get("model", "qwen2.5-3b-instruct")),
            api_key=os.getenv("LMSTUDIO_API_KEY", "lm-studio"),
            context_window=lmu.get("context_window", 32_000),
            kv_cache=lmu.get("kv_cache", False),
        ),
        ollama=OllamaSettings(
            base_url=os.getenv("OLLAMA_BASE_URL", ol.get("base_url", "http://localhost:11434")),
            embed_model=os.getenv("OLLAMA_EMBED_MODEL", ol.get("embed_model", "qwen2.5:7b")),
        ),
        context=ContextSettings(**raw.get("context", {})),
        graph=GraphSettings(**raw.get("graph", {})),
        routing=RoutingSettings(**raw.get("routing", {})),
        pricing=PricingSettings(**raw.get("pricing", {})),
        tui=TUISettings(**raw.get("tui", {})),
        web_search=WebSearchSettings(
            api_key=os.getenv("BRAVE_API_KEY", ""),
            max_results=raw.get("web_search", {}).get("max_results", 5),
            enabled=raw.get("web_search", {}).get("enabled", True),
        ),
    )


def save_settings(updates: dict) -> None:
    """Merge partial updates into settings.toml and write to disk.

    ``updates`` is a nested dict matching the TOML structure, e.g.
    ``{"context": {"hot_layer_max_messages": 4}}``.
    """
    raw = _load_toml()
    for section, values in updates.items():
        if isinstance(values, dict):
            raw.setdefault(section, {}).update(values)
        else:
            raw[section] = values
    with open(_SETTINGS_PATH, "wb") as f:
        tomli_w.dump(raw, f)


def settings_to_dict(settings: Settings) -> dict:
    """Serialize a Settings object to a plain dict for JSON responses."""
    from dataclasses import asdict
    return asdict(settings)
