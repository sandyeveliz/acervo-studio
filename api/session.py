"""Session manager — holds pipeline state for the web server."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import yaml

from config.prompt_loader import load_all_prompts
from config.settings import load_settings, Settings
from api.trace_store import TraceStore
from core.event_bus import EventBus
from core.pipeline import ConversationPipeline
from core.turn_logger import TurnLogger
from providers.base import ChatMessage
from providers.model_router import ModelRouter
from providers.mcp_client import MCPManager

_AGENTS_DIR = Path(__file__).resolve().parent.parent / "config" / "agents"


def _load_agent_config(name: str = "default") -> dict:
    path = _AGENTS_DIR / f"{name}.yaml"
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


class SessionManager:
    """Single named session with conversation history and LLM pipeline."""

    def __init__(
        self,
        name: str = "default",
        system_prompt: str = "",
        persist_path: str | Path = "data/graph",
    ) -> None:
        self.name = name
        self.settings: Settings | None = None
        self.router: ModelRouter | None = None
        self.bus: EventBus | None = None
        self.mcp: MCPManager | None = None
        self.pipeline: ConversationPipeline | None = None
        self.turn_logger: TurnLogger | None = None
        self.trace_store: TraceStore | None = None
        self.history: list[ChatMessage] = []
        self.system_prompt: str = system_prompt
        self._base_system_prompt: str = system_prompt  # agent personality only
        self.temperature: float = 0.7
        self._persist_path = str(persist_path)
        self._running = False
        self._lock = asyncio.Lock()
        self._turn_count = 0

    async def init(self, shared_router: ModelRouter | None = None) -> None:
        """Initialize all pipeline components.

        Args:
            shared_router: If provided, reuse this ModelRouter instead of creating a new one.
                           All sessions share the same LLM connections.
        """
        self.settings = load_settings()

        if shared_router:
            self.router = shared_router
        else:
            self.router = ModelRouter(self.settings)

        self.bus = EventBus()
        self.mcp = MCPManager()

        # If no system prompt provided, load from default agent
        if not self.system_prompt:
            agent_config = _load_agent_config()
            self.system_prompt = agent_config["system_prompt"].strip()
            self._base_system_prompt = self.system_prompt
            self.temperature = agent_config.get("temperature", 0.7)
        else:
            agent_config = {}
            self._base_system_prompt = self.system_prompt

        # Determine LLM base URL: use proxy when Acervo plugin is enabled
        if self.settings.plugins.acervo.enabled:
            main_base_url = self.settings.plugins.acervo.proxy_url
        else:
            main_base_url = None  # use default from settings

        self.pipeline = ConversationPipeline(
            bus=self.bus,
            router=self.router,
            model_name=self.settings.lmstudio.model,
            mcp=self.mcp if self.mcp.has_servers else None,
            base_url_override=main_base_url,
        )

        # Turn audit logger
        log_dir = Path(self._persist_path).parent
        turns_path = log_dir / "turns.jsonl"
        self.turn_logger = TurnLogger(self.name, turns_path)
        self.turn_logger.subscribe(self.bus)

        # Trace event store (persists pipeline events for frontend recovery)
        trace_path = log_dir / "trace.jsonl"
        self.trace_store = TraceStore(persist_path=trace_path)
        self.trace_store.subscribe(self.bus)

        # Load persisted history or start fresh
        self.history = self._load_history()
        if not self.history:
            self.history = [
                ChatMessage(role="system", content=self.system_prompt),
            ]
        # Count existing turns from history
        self._turn_count = sum(1 for m in self.history if m.role == "user")

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
                self._save_history()
                return response
            finally:
                self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    async def reset(self) -> None:
        """Clear chat history and trace."""
        self.history = [
            ChatMessage(role="system", content=self.system_prompt),
        ]
        self._turn_count = 0
        self._save_history()
        if self.trace_store:
            self.trace_store.clear()

    # ── History persistence ──

    def _history_path(self) -> Path:
        log_dir = Path(self._persist_path).parent
        return log_dir / "history.json"

    def _save_history(self) -> None:
        """Persist conversation history to disk (excludes system prompt)."""
        path = self._history_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        messages = [
            {"role": m.role, "content": m.content}
            for m in self.history
            if m.role != "system"
        ]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(messages, f, ensure_ascii=False, indent=2)

    def _load_history(self) -> list[ChatMessage]:
        """Load conversation history from disk, prepend system prompt."""
        path = self._history_path()
        if not path.exists():
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                messages = json.load(f)
            history = [ChatMessage(role="system", content=self.system_prompt)]
            for m in messages:
                history.append(ChatMessage(role=m["role"], content=m["content"]))
            return history
        except (json.JSONDecodeError, KeyError):
            return []

    def update_project_context(self, project_name: str, description: str) -> None:
        """Rebuild the system prompt with project context injected."""
        if description:
            self.system_prompt = (
                f"{self._base_system_prompt}\n\n"
                f"--- ACTIVE PROJECT ---\n"
                f"{project_name}: {description}"
            )
        else:
            self.system_prompt = self._base_system_prompt

        # Update system message in history
        if self.history and self.history[0].role == "system":
            self.history[0] = ChatMessage(role="system", content=self.system_prompt)

    def get_stats(self) -> dict:
        """Return session stats for the frontend."""
        stats: dict[str, Any] = {
            "type": "stats",
            "session_name": self.name,
            "model": self.settings.lmstudio.model if self.settings else "",
            "utility_model": self.settings.lmstudio_utility.model if self.settings else "",
            "turns": self._turn_count,
            "history_len": len(self.history),
            "mcp_active": bool(self.mcp and self.mcp.has_servers),
            "mcp_servers": [
                {
                    "name": name,
                    "status": self.mcp.get_status(name),
                    "error": self.mcp.get_error(name),
                }
                for name in self.mcp.server_names
            ] if self.mcp else [],
            "acervo_enabled": self.settings.plugins.acervo.enabled if self.settings else False,
        }
        return stats

    async def cleanup(self) -> None:
        """Shutdown: close providers."""
        if self.router:
            await self.router.close()

    def to_info(self) -> dict:
        """Return session metadata for listing."""
        return {
            "name": self.name,
            "system_prompt": self.system_prompt,
            "persist_path": self._persist_path,
            "turns": self._turn_count,
        }


class SessionRegistry:
    """Manages the single default session."""

    def __init__(self) -> None:
        self._session: SessionManager | None = None
        self._router: ModelRouter | None = None

    @property
    def active(self) -> SessionManager:
        assert self._session is not None
        return self._session

    async def init(self) -> None:
        """Initialize the registry — create shared router + default session."""
        settings = load_settings()
        self._router = ModelRouter(settings)

        session = SessionManager(
            name="default",
            system_prompt="",
            persist_path="data/graph",
        )
        await session.init(shared_router=self._router)
        self._session = session

        # Inject active project context into system prompt
        self._apply_active_project_context(session)

    def _apply_active_project_context(self, session: SessionManager) -> None:
        """If there's an active project with a description, inject it into the prompt."""
        try:
            from db import get_repo
            active = get_repo().get_active_project()
            if not active:
                return
            config_path = Path(active.path) / ".acervo" / "config.toml"
            if not config_path.exists():
                return
            from acervo.config import AcervoConfig
            cfg = AcervoConfig.load(config_path)
            if cfg.description:
                session.update_project_context(active.name, cfg.description)
            # Tell the proxy to load this project's graph
            asyncio.create_task(self._switch_proxy_project(session, active.path))
        except Exception:
            pass  # DB or config not ready yet — skip

    @staticmethod
    async def _switch_proxy_project(session: SessionManager, project_path: str) -> None:
        """Notify the proxy to switch to the active project (best-effort)."""
        try:
            import aiohttp
            base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
            async with aiohttp.ClientSession() as client:
                await client.post(
                    f"{base_url}/acervo/switch-project",
                    json={"project_path": project_path},
                    timeout=aiohttp.ClientTimeout(total=5),
                )
        except Exception:
            pass  # Proxy may not be ready yet — select_project will retry

    async def cleanup(self) -> None:
        """Shutdown."""
        if self._router:
            await self._router.close()
