"""Session manager — holds pipeline state for the web server."""

from __future__ import annotations

import asyncio
from pathlib import Path

import yaml

from acervo import Acervo
from config.settings import load_settings, Settings
from core.event_bus import EventBus
from core.pipeline import ConversationPipeline
from providers.acervo_adapter import ModelRouterAdapter
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from providers.mcp_client import MCPManager

_AGENTS_DIR = Path(__file__).resolve().parent.parent / "config" / "agents"


def _load_agent_config(name: str = "default") -> dict:
    path = _AGENTS_DIR / f"{name}.yaml"
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


class SessionManager:
    """Single-user session that mirrors the TUI init chain."""

    def __init__(self) -> None:
        self.settings: Settings | None = None
        self.router: ModelRouter | None = None
        self.bus: EventBus | None = None
        self.mcp: MCPManager | None = None
        self.memory: Acervo | None = None
        self.pipeline: ConversationPipeline | None = None
        self.history: list[ChatMessage] = []
        self.system_prompt: str = ""
        self.temperature: float = 0.7
        self._running = False
        self._lock = asyncio.Lock()
        self._turn_count = 0

    async def init(self) -> None:
        """Initialize all pipeline components (same as tui/app.py __init__)."""
        self.settings = load_settings()
        self.router = ModelRouter(self.settings)
        self.bus = EventBus()
        self.mcp = MCPManager()

        ctx = self.settings.context
        self.memory = Acervo(
            llm=ModelRouterAdapter(self.router),
            owner="Sandy",
            hot_layer_max_messages=ctx.hot_layer_max_messages,
            hot_layer_max_tokens=ctx.hot_layer_max_tokens,
            compaction_trigger_tokens=ctx.compaction_trigger_tokens,
            embed_threshold=ctx.topic_change_embed_threshold,
        )

        self.pipeline = ConversationPipeline(
            bus=self.bus,
            router=self.router,
            memory=self.memory,
            model_name=self.settings.lmstudio.model,
            mcp=self.mcp if self.mcp.has_servers else None,
        )

        # Load agent config
        agent_config = _load_agent_config()
        self.system_prompt = agent_config["system_prompt"].strip()
        self.temperature = agent_config.get("temperature", 0.7)
        self.history = [
            ChatMessage(role="system", content=self.system_prompt),
        ]

        # Probe MCP servers
        if self.mcp and self.mcp.has_servers:
            await self.mcp.probe_servers()

    async def run_turn(self, user_text: str) -> str | None:
        """Execute a pipeline turn. Returns assistant response text."""
        async with self._lock:
            self._running = True
            try:
                self.history.append(ChatMessage(role="user", content=user_text))
                response = await self.pipeline.run_turn(
                    user_text, self.history, self.temperature,
                )
                if response:
                    self.history.append(
                        ChatMessage(role="assistant", content=response),
                    )
                self._turn_count += 1
                return response
            finally:
                self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    async def reset(self) -> None:
        """Reset conversation state."""
        self.history = [
            ChatMessage(role="system", content=self.system_prompt),
        ]
        self._turn_count = 0

    def get_stats(self) -> dict:
        """Return session stats for the frontend."""
        graph = self.memory.graph if self.memory else None
        return {
            "type": "stats",
            "model": self.settings.lmstudio.model if self.settings else "",
            "utility_model": self.settings.lmstudio_utility.model if self.settings else "",
            "turns": self._turn_count,
            "history_len": len(self.history),
            "node_count": graph.node_count if graph else 0,
            "edge_count": graph.edge_count if graph else 0,
            "mcp_active": bool(self.mcp and self.mcp.has_servers),
        }

    async def cleanup(self) -> None:
        """Shutdown: close providers."""
        if self.router:
            await self.router.close()
