"""Brave Search client for web search via the Brave Search API.

Uses httpx for async HTTP. No MCP server process needed — direct API call.
"""

from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)

_BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search"


class BraveSearchClient:
    """Async client for Brave Search API."""

    def __init__(self, api_key: str, max_results: int = 5) -> None:
        self._api_key = api_key
        self._max_results = max_results

    async def search(self, query: str) -> str:
        """Search the web and return a formatted text summary of results.

        Returns a human-readable summary suitable for LLM context injection.
        Returns empty string on error or no results.
        """
        if not self._api_key:
            log.warning("Brave Search API key not configured")
            return ""

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    _BRAVE_API_URL,
                    params={
                        "q": query,
                        "count": self._max_results,
                        "text_decorations": "false",
                    },
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip",
                        "X-Subscription-Token": self._api_key,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            log.error("Brave Search failed: %s", e)
            return ""

        return self._format_results(data, query)

    def _format_results(self, data: dict, query: str) -> str:
        """Format Brave Search API response into a readable text block."""
        web_results = data.get("web", {}).get("results", [])
        if not web_results:
            return ""

        sections: list[str] = [f"Resultados de búsqueda web para: \"{query}\"\n"]

        for i, result in enumerate(web_results[:self._max_results], 1):
            title = result.get("title", "")
            description = result.get("description", "")
            url = result.get("url", "")

            section = f"{i}. {title}"
            if description:
                section += f"\n   {description}"
            if url:
                section += f"\n   Fuente: {url}"
            sections.append(section)

        return "\n\n".join(sections)
