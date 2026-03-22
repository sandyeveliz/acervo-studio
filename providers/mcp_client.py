"""Generic MCP client — connects to any MCP server defined in .mcp.json.

Manages server lifecycles and provides a simple interface to call tools.
Supports ${ENV_VAR} substitution in args and env values.

Falls back to direct HTTP API calls when MCP stdio fails (common on Windows).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from dataclasses import dataclass, field

import httpx
from dotenv import load_dotenv

try:
    from mcp.client.session import ClientSession
    from mcp.client.stdio import stdio_client, StdioServerParameters
    _MCP_AVAILABLE = True
except ImportError:
    _MCP_AVAILABLE = False

log = logging.getLogger(__name__)

_MCP_TIMEOUT = 20  # seconds
_ENV_VAR_RE = re.compile(r"\$\{(\w+)\}")
_HTML_TAG_RE = re.compile(r"<[^>]+>")

# ── OpenAI-compatible tool definitions for known MCP servers ──

_MCP_TOOL_DEFS: dict[str, list[dict]] = {
    "brave-search": [
        {
            "type": "function",
            "function": {
                "name": "brave_web_search",
                "description": "Search the web using Brave Search for current information, news, or topics not in the verified context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query",
                        },
                        "count": {
                            "type": "integer",
                            "description": "Number of results (1-20)",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            },
        },
    ],
}


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = _HTML_TAG_RE.sub("", text)
    text = text.replace("&amp;", "&").replace("&#x27;", "'").replace("&quot;", '"')
    return text


def _substitute_env(value: str) -> str:
    """Replace ${VAR} patterns with os.environ values."""
    return _ENV_VAR_RE.sub(lambda m: os.environ.get(m.group(1), ""), value)


@dataclass
class MCPServerConfig:
    """Configuration for a single MCP server."""
    name: str
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class MCPToolResult:
    """Result from an MCP tool call."""
    content: str
    is_error: bool = False


class MCPManager:
    """Manages connections to MCP servers and tool execution.

    Reads server definitions from .mcp.json and provides a unified
    interface to discover and call tools from any configured server.

    Supports ${ENV_VAR} substitution in args and env values, resolved
    from os.environ (loaded from .env via dotenv).
    """

    def __init__(self, config_path: Path | str = ".mcp.json") -> None:
        self._config_path = Path(config_path)
        self._servers: dict[str, MCPServerConfig] = {}
        self._server_status: dict[str, str] = {}  # name → "ready"|"error"|"unknown"
        self._server_errors: dict[str, str] = {}  # name → last error message
        self._load_config()

    def _load_config(self) -> None:
        """Load server definitions from .mcp.json."""
        # Ensure .env is loaded so ${VAR} substitution works
        load_dotenv()

        if not self._config_path.exists():
            log.info("No .mcp.json found at %s", self._config_path)
            return

        try:
            data = json.loads(self._config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            log.warning("Failed to read .mcp.json: %s", e)
            return

        servers = data.get("mcpServers", {})
        for name, config in servers.items():
            command = config.get("command", "")
            if not command:
                continue

            # Substitute ${ENV_VAR} in args
            args = [_substitute_env(a) for a in config.get("args", [])]

            # Substitute ${ENV_VAR} in env values, merge with os.environ
            env = {}
            for key, default in config.get("env", {}).items():
                resolved = _substitute_env(default) if default else ""
                env[key] = os.environ.get(key, resolved)

            self._servers[name] = MCPServerConfig(
                name=name,
                command=command,
                args=args,
                env=env,
            )
            self._server_status[name] = "unknown"

        log.info("Loaded %d MCP servers: %s", len(self._servers), list(self._servers.keys()))

    @property
    def has_servers(self) -> bool:
        return bool(self._servers)

    async def probe_servers(self) -> None:
        """Quick probe: check if BRAVE_API_KEY is configured."""
        for name, server in self._servers.items():
            # Check if env vars are set (don't actually connect — too slow)
            if "search" in name.lower():
                api_key = os.environ.get("BRAVE_API_KEY", "")
                if api_key:
                    self._server_status[name] = "ready"
                else:
                    self._server_status[name] = "error"
                    self._server_errors[name] = "BRAVE_API_KEY not set in .env"

    @property
    def server_names(self) -> list[str]:
        return list(self._servers.keys())

    def get_status(self, server_name: str) -> str:
        """Get server status: 'ready', 'error', or 'unknown'."""
        return self._server_status.get(server_name, "unknown")

    def get_error(self, server_name: str) -> str:
        """Get last error message for a server."""
        return self._server_errors.get(server_name, "")

    def get_all_status(self) -> dict[str, str]:
        """Get status dict for all servers."""
        return dict(self._server_status)

    async def call_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: dict | None = None,
    ) -> MCPToolResult:
        """Spawn MCP server, call a tool, return result. Timeout-protected."""
        server = self._servers.get(server_name)
        if not server:
            return MCPToolResult(content=f"Server '{server_name}' not found", is_error=True)

        try:
            result = await asyncio.wait_for(
                self._call_tool_impl(server, tool_name, arguments or {}),
                timeout=_MCP_TIMEOUT,
            )
            if not result.is_error:
                self._server_status[server_name] = "ready"
                self._server_errors.pop(server_name, None)
            else:
                self._server_status[server_name] = "error"
                self._server_errors[server_name] = result.content[:200]
            return result
        except asyncio.TimeoutError:
            msg = f"MCP timeout after {_MCP_TIMEOUT}s"
            log.error("%s (%s/%s)", msg, server_name, tool_name)
            self._server_status[server_name] = "error"
            self._server_errors[server_name] = msg
            return MCPToolResult(content=msg, is_error=True)
        except Exception as e:
            msg = str(e)
            log.error("MCP call failed (%s/%s): %s", server_name, tool_name, msg)
            self._server_status[server_name] = "error"
            self._server_errors[server_name] = msg[:200]
            return MCPToolResult(content=msg, is_error=True)

    async def _call_tool_impl(
        self,
        server: MCPServerConfig,
        tool_name: str,
        arguments: dict,
    ) -> MCPToolResult:
        """Internal: spawn server, initialize, call tool, extract text."""
        if not _MCP_AVAILABLE:
            return MCPToolResult(content="MCP SDK not available", is_error=True)

        # Full env: inherit current process env + server-specific overrides
        merged_env = {**os.environ, **server.env} if server.env else None

        params = StdioServerParameters(
            command=server.command,
            args=server.args,
            env=merged_env,
        )
        async with stdio_client(params) as (read, write):
            session = ClientSession(read, write)
            await session.initialize()

            result = await session.call_tool(
                name=tool_name,
                arguments=arguments,
            )

            # Extract text content
            texts = []
            for content in result.content:
                if hasattr(content, "text"):
                    texts.append(content.text)
                else:
                    texts.append(str(content))

            return MCPToolResult(
                content="\n".join(texts),
                is_error=bool(result.isError),
            )

    def get_tool_definitions(self) -> list[dict]:
        """Return OpenAI-compatible tool definitions for all ready MCP servers."""
        tools: list[dict] = []
        for name in self._servers:
            if self._server_status.get(name) != "ready":
                continue
            defs = _MCP_TOOL_DEFS.get(name, [])
            tools.extend(defs)
        return tools

    async def call_tool_by_name(
        self, tool_name: str, arguments: dict,
    ) -> MCPToolResult:
        """Find the MCP server that owns this tool and call it."""
        for server_name, defs in _MCP_TOOL_DEFS.items():
            for d in defs:
                if d["function"]["name"] == tool_name:
                    return await self.call_tool(server_name, tool_name, arguments)
        return MCPToolResult(
            content=f"No MCP server found for tool '{tool_name}'",
            is_error=True,
        )

    async def search_web(self, query: str) -> str:
        """Search the web. Tries MCP first, falls back to direct Brave API.

        Returns formatted text or empty string.
        """
        # Try MCP stdio first
        for server_name in self._servers:
            if "search" in server_name.lower():
                result = await self.call_tool(
                    server_name, "brave_web_search", {"query": query},
                )
                if not result.is_error and result.content:
                    return result.content

        # Fallback: direct Brave Search API via HTTP
        api_key = os.environ.get("BRAVE_API_KEY", "")
        if api_key:
            log.info("MCP stdio failed, falling back to direct Brave API")
            result = await self._brave_search_direct(query, api_key)
            if result:
                # Clear the stdio error — fallback works
                for name in self._servers:
                    if "search" in name.lower():
                        self._server_status[name] = "ready"
                        self._server_errors.pop(name, None)
            return result

        return ""

    async def _brave_search_direct(
        self, query: str, api_key: str, max_results: int = 5,
    ) -> str:
        """Direct Brave Search API call — no MCP, just HTTP."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    params={"q": query, "count": max_results},
                    headers={
                        "Accept": "application/json",
                        "X-Subscription-Token": api_key,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            log.error("Brave Search API failed: %s", e)
            self._server_status["brave-search-api"] = "error"
            self._server_errors["brave-search-api"] = str(e)[:200]
            return ""

        results = data.get("web", {}).get("results", [])
        if not results:
            return ""

        self._server_status["brave-search-api"] = "ready"
        sections = [f"Resultados web para: \"{query}\"\n"]
        for i, r in enumerate(results[:max_results], 1):
            title = _strip_html(r.get("title", ""))
            desc = _strip_html(r.get("description", ""))
            url = r.get("url", "")
            section = f"{i}. {title}"
            if desc:
                section += f"\n   {desc}"
            if url:
                section += f"\n   Fuente: {url}"
            sections.append(section)

        return "\n\n".join(sections)
