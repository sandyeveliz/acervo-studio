"""Acervo plugin — HTTP client for proxy + disk reader for graph files.

All Acervo integration happens through:
1. HTTP requests to the Acervo proxy (status, changelog, test)
2. Direct file reads from .acervo/data/graph/ (graph stats)

No direct Python imports from the acervo package.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


async def fetch_proxy_status(proxy_url: str) -> dict | None:
    """GET /acervo/status from the proxy. Returns parsed JSON or None on error."""
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            async with client.get(
                f"{proxy_url}/acervo/status",
                timeout=aiohttp.ClientTimeout(total=3),
            ) as resp:
                return await resp.json()
    except Exception as e:
        log.debug("Acervo proxy status failed: %s", e)
        return None


async def test_connection(proxy_url: str) -> tuple[bool, str]:
    """Test if the Acervo proxy is reachable. Returns (ok, message)."""
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            async with client.get(
                f"{proxy_url}/acervo/status",
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                data = await resp.json()
                graph = data.get("graph", {})
                nodes = graph.get("node_count", 0)
                edges = graph.get("edge_count", 0)
                return True, f"Connected ({nodes} nodes, {edges} edges)"
    except Exception as e:
        return False, str(e)


def read_graph_info(acervo_dir: str | Path) -> dict[str, Any]:
    """Read node/edge counts directly from .acervo/data/graph/ files on disk.

    Returns:
        {node_count, edge_count, nodes_by_type, initialized}
    """
    acervo_path = Path(acervo_dir)
    nodes_path = acervo_path / "data" / "graph" / "nodes.json"
    edges_path = acervo_path / "data" / "graph" / "edges.json"

    node_count = 0
    edge_count = 0
    nodes_by_type: dict[str, int] = {}

    if nodes_path.exists():
        try:
            with open(nodes_path, "r", encoding="utf-8") as f:
                nodes = json.load(f)
            node_count = len(nodes)
            for n in nodes:
                t = n.get("type", "unknown")
                nodes_by_type[t] = nodes_by_type.get(t, 0) + 1
        except (json.JSONDecodeError, KeyError):
            pass

    if edges_path.exists():
        try:
            with open(edges_path, "r", encoding="utf-8") as f:
                edges = json.load(f)
            edge_count = len(edges)
        except (json.JSONDecodeError, KeyError):
            pass

    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "nodes_by_type": nodes_by_type,
        "initialized": nodes_path.parent.exists(),
    }
