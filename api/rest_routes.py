"""REST API endpoints for settings, agents, sessions, MCP, and Acervo plugin."""

from __future__ import annotations

import json as json_mod
import logging
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config.settings import load_settings, save_settings, settings_to_dict

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

_AGENTS_DIR = Path(__file__).resolve().parent.parent / "config" / "agents"
_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "config" / "prompts"

# ── Helpers ──


def _get_session(request: Request):
    return request.app.state.registry.active


def _get_acervo_dir(request: Request) -> Path:
    """Resolve the .acervo directory path from settings."""
    session = _get_session(request)
    acervo_dir = Path(session.settings.plugins.acervo.acervo_dir)
    if not acervo_dir.is_absolute():
        acervo_dir = Path.cwd() / acervo_dir
    return acervo_dir


def _read_graph_files(acervo_dir: Path) -> dict:
    """Read graph node/edge data from .acervo/data/graph/ files on disk."""
    nodes_path = acervo_dir / "data" / "graph" / "nodes.json"
    edges_path = acervo_dir / "data" / "graph" / "edges.json"

    nodes = []
    edges = []

    if nodes_path.exists():
        try:
            with open(nodes_path, "r", encoding="utf-8") as f:
                nodes = json_mod.load(f)
        except (json_mod.JSONDecodeError, KeyError):
            pass

    if edges_path.exists():
        try:
            with open(edges_path, "r", encoding="utf-8") as f:
                edges = json_mod.load(f)
        except (json_mod.JSONDecodeError, KeyError):
            pass

    return {"nodes": nodes, "edges": edges}


# ── Pydantic models ──


class AgentConfig(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    temperature: float = 0.7


class PromptUpdate(BaseModel):
    content: str


# ── Graph endpoints (read from .acervo/data/graph/ files) ──


@router.get("/graph/nodes")
async def get_graph_nodes(request: Request, type: str | None = None):
    acervo_dir = _get_acervo_dir(request)
    data = _read_graph_files(acervo_dir)
    nodes = data["nodes"]
    if type:
        nodes = [n for n in nodes if n.get("type", "").lower() == type.lower()]
    return {"nodes": nodes}


@router.get("/graph/nodes/{node_id}")
async def get_graph_node(request: Request, node_id: str):
    acervo_dir = _get_acervo_dir(request)
    data = _read_graph_files(acervo_dir)
    for node in data["nodes"]:
        if node.get("id") == node_id:
            return node
    raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")


@router.get("/graph/edges")
async def get_graph_edges(request: Request, node_id: str | None = None):
    acervo_dir = _get_acervo_dir(request)
    data = _read_graph_files(acervo_dir)
    edges = data["edges"]
    if node_id:
        edges = [e for e in edges if e.get("source") == node_id or e.get("target") == node_id]
    return {"edges": edges}


@router.get("/graph/stats")
async def get_graph_stats(request: Request):
    acervo_dir = _get_acervo_dir(request)
    data = _read_graph_files(acervo_dir)
    nodes = data["nodes"]
    type_dist: dict[str, int] = {}
    for n in nodes:
        t = n.get("type", "unknown")
        type_dist[t] = type_dist.get(t, 0) + 1
    return {
        "node_count": len(nodes),
        "edge_count": len(data["edges"]),
        "type_distribution": type_dist,
    }


@router.get("/graph/export")
async def export_graph(request: Request):
    acervo_dir = _get_acervo_dir(request)
    return _read_graph_files(acervo_dir)


@router.delete("/graph/nodes/{node_id}")
async def delete_graph_node(request: Request, node_id: str):
    """Delete a node and all its edges from the graph."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"
    nodes_path = graph_dir / "nodes.json"
    edges_path = graph_dir / "edges.json"

    data = _read_graph_files(acervo_dir)
    before = len(data["nodes"])
    data["nodes"] = [n for n in data["nodes"] if n.get("id") != node_id]
    if len(data["nodes"]) == before:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    data["edges"] = [
        e for e in data["edges"]
        if e.get("source") != node_id and e.get("target") != node_id
    ]
    _write_graph_files(graph_dir, data)
    return {"deleted": True, "node_id": node_id}


@router.delete("/graph/nodes/{node_id}/facts")
async def delete_graph_fact(request: Request, node_id: str, fact: str):
    """Delete a specific fact from a node."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"
    data = _read_graph_files(acervo_dir)

    node = next((n for n in data["nodes"] if n.get("id") == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    facts = node.get("facts", [])
    node["facts"] = [f for f in facts if f.get("fact", "").strip() != fact.strip()]
    _write_graph_files(graph_dir, data)

    return node


@router.post("/graph/merge")
async def merge_graph_nodes(request: Request, body: dict[str, Any]):
    """Merge two nodes: keep_id absorbs absorb_id."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"

    keep_id = body.get("keep_id")
    absorb_id = body.get("absorb_id")
    alias = body.get("alias")

    if not keep_id or not absorb_id:
        raise HTTPException(status_code=400, detail="keep_id and absorb_id required")

    try:
        from acervo.graph import TopicGraph
        graph = TopicGraph(graph_dir)
        ok = graph.merge_nodes(keep_id, absorb_id, alias)
        if not ok:
            raise HTTPException(status_code=404, detail="One or both nodes not found")
        graph.save()
        return {"merged": True, "keep_id": keep_id, "absorb_id": absorb_id}
    except ImportError:
        raise HTTPException(status_code=500, detail="Acervo not installed")


@router.post("/graph/import")
async def import_graph(request: Request, body: dict[str, Any]):
    """Import graph data (merge mode)."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"

    try:
        from acervo.graph import TopicGraph
        graph = TopicGraph(graph_dir)
        nodes_imported, edges_imported = graph.import_json(body, mode="merge")
        graph.save()
        return {"imported": True, "nodes": nodes_imported, "edges": edges_imported}
    except ImportError:
        raise HTTPException(status_code=500, detail="Acervo not installed")


@router.get("/graph/analysis")
async def get_graph_analysis(request: Request):
    """Run quality analysis on the graph and return issues + stats."""
    acervo_dir = _get_acervo_dir(request)
    data = _read_graph_files(acervo_dir)
    nodes = data["nodes"]
    edges = data["edges"]

    # Get system prompt for leakage detection
    system_prompt = ""
    try:
        session = _get_session(request)
        system_prompt = session.system_prompt or ""
    except Exception:
        pass

    # Build edge lookup
    edge_count_by_node: dict[str, int] = {}
    for e in edges:
        src = e.get("source", "")
        tgt = e.get("target", "")
        edge_count_by_node[src] = edge_count_by_node.get(src, 0) + 1
        edge_count_by_node[tgt] = edge_count_by_node.get(tgt, 0) + 1

    issues: list[dict] = []

    # ── Duplicate detector ──
    entity_nodes = [n for n in nodes if n.get("kind", "entity") == "entity"]
    for i, a in enumerate(entity_nodes):
        for b in entity_nodes[i + 1:]:
            label_a = a.get("label", "").lower().strip()
            label_b = b.get("label", "").lower().strip()
            if not label_a or not label_b:
                continue
            # Check containment
            if label_a in label_b or label_b in label_a:
                issues.append({
                    "type": "duplicate",
                    "severity": "warning",
                    "message": f'Possible duplicate: "{a.get("label")}" ↔ "{b.get("label")}"',
                    "reason": f"label overlap ({min(label_a, label_b, key=len)})",
                    "node_ids": [a.get("id"), b.get("id")],
                    "nodes": [a, b],
                })
                continue
            # Check similarity (simple char-ratio)
            shorter = min(len(label_a), len(label_b))
            longer = max(len(label_a), len(label_b))
            if shorter > 0 and longer > 0:
                common = sum(1 for ca, cb in zip(label_a, label_b) if ca == cb)
                ratio = common / longer
                if ratio > 0.7:
                    issues.append({
                        "type": "duplicate",
                        "severity": "warning",
                        "message": f'Possible duplicate: "{a.get("label")}" ↔ "{b.get("label")}"',
                        "reason": f"similarity {ratio:.0%}",
                        "node_ids": [a.get("id"), b.get("id")],
                        "nodes": [a, b],
                    })

    # ── System prompt leakage detector ──
    if system_prompt:
        prompt_words = set(w.lower() for w in system_prompt.split() if len(w) > 4)
        prompt_lower = system_prompt.lower()
        for n in entity_nodes:
            label = n.get("label", "")
            label_lower = label.lower()
            # Check if label appears in system prompt (fuzzy)
            if len(label_lower) > 3 and label_lower in prompt_lower:
                source = n.get("source", "")
                if source not in ("world", "user_assertion"):
                    issues.append({
                        "type": "leakage",
                        "severity": "warning",
                        "message": f'Possible system prompt leakage: "{label}"',
                        "reason": f'label found in system prompt, source: {source}',
                        "node_ids": [n.get("id")],
                        "nodes": [n],
                    })

    # ── Orphan detector ──
    for n in nodes:
        nid = n.get("id", "")
        kind = n.get("kind", "entity")
        if kind in ("file", "symbol", "section"):
            continue  # structural nodes often have only parent edges
        if edge_count_by_node.get(nid, 0) == 0:
            issues.append({
                "type": "orphan",
                "severity": "info",
                "message": f'Orphan node: "{n.get("label")}" — no edges',
                "reason": "zero edges",
                "node_ids": [nid],
                "nodes": [n],
            })

    # ── Type consistency / Unknown type detector ──
    for n in entity_nodes:
        if n.get("type", "Unknown") == "Unknown":
            issues.append({
                "type": "unknown_type",
                "severity": "info",
                "message": f'Unknown type: "{n.get("label")}"',
                "reason": f'kind: {n.get("kind", "entity")}, no type assigned',
                "node_ids": [n.get("id")],
                "nodes": [n],
            })

    # ── Fact quality detector ──
    for n in entity_nodes:
        facts = n.get("facts", [])
        status = n.get("status", "cold")
        if not facts and status not in ("placeholder", "incomplete"):
            issues.append({
                "type": "empty_facts",
                "severity": "info",
                "message": f'Empty facts: "{n.get("label")}" — enriched but no facts',
                "reason": f"status: {status}, 0 facts",
                "node_ids": [n.get("id")],
                "nodes": [n],
            })

    # ── Stats ──
    by_source: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    by_status: dict[str, int] = {}
    verified_count = 0
    placeholder_count = 0

    for n in nodes:
        src = n.get("source", "unknown")
        by_source[src] = by_source.get(src, 0) + 1
        typ = n.get("type", "Unknown")
        by_type[typ] = by_type.get(typ, 0) + 1
        kind = n.get("kind", "entity")
        by_kind[kind] = by_kind.get(kind, 0) + 1
        st = n.get("status", "cold")
        by_status[st] = by_status.get(st, 0) + 1
        if n.get("attributes", {}).get("verified"):
            verified_count += 1
        if st == "placeholder" or st == "incomplete":
            placeholder_count += 1

    # ── Extraction log ──
    extraction_log = _read_extraction_log(acervo_dir)

    return {
        "issues": issues,
        "stats": {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "by_source": by_source,
            "by_type": by_type,
            "by_kind": by_kind,
            "by_status": by_status,
            "verified_count": verified_count,
            "unverified_count": len(nodes) - verified_count,
            "placeholder_count": placeholder_count,
            "issue_count": len(issues),
        },
        "extraction_log": extraction_log,
        "system_prompt_preview": system_prompt[:200] if system_prompt else "",
    }


def _write_graph_files(graph_dir: Path, data: dict) -> None:
    """Write graph nodes and edges to JSON files."""
    graph_dir.mkdir(parents=True, exist_ok=True)
    nodes_path = graph_dir / "nodes.json"
    edges_path = graph_dir / "edges.json"
    with open(nodes_path, "w", encoding="utf-8") as f:
        json_mod.dump(data["nodes"], f, ensure_ascii=False, indent=2)
    with open(edges_path, "w", encoding="utf-8") as f:
        json_mod.dump(data["edges"], f, ensure_ascii=False, indent=2)


def _read_extraction_log(acervo_dir: Path) -> list[dict]:
    """Read extraction event log from .acervo/data/extraction_log.jsonl."""
    log_path = acervo_dir / "data" / "extraction_log.jsonl"
    if not log_path.exists():
        return []
    events = []
    try:
        for line in log_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                events.append(json_mod.loads(line))
    except Exception:
        pass
    return events


# ── MCP endpoints ──

_MCP_CONFIG_PATH = Path(__file__).resolve().parent.parent / ".mcp.json"


@router.get("/mcp/status")
async def get_mcp_status(request: Request):
    """Return MCP server list with status and errors."""
    session = _get_session(request)
    mcp = session.mcp
    if not mcp:
        return {"servers": []}
    return {
        "servers": [
            {"name": name, "status": mcp.get_status(name), "error": mcp.get_error(name)}
            for name in mcp.server_names
        ],
    }


@router.get("/mcp/config")
async def get_mcp_config():
    """Return current .mcp.json content."""
    if not _MCP_CONFIG_PATH.exists():
        return {"config": {"mcpServers": {}}}
    with open(_MCP_CONFIG_PATH, "r", encoding="utf-8") as f:
        return {"config": json_mod.load(f)}


@router.put("/mcp/config")
async def save_mcp_config(body: dict[str, Any]):
    """Save .mcp.json content."""
    config = body.get("config")
    if config is None:
        raise HTTPException(status_code=400, detail="Missing 'config' field")
    with open(_MCP_CONFIG_PATH, "w", encoding="utf-8") as f:
        json_mod.dump(config, f, indent=2)
    return {"saved": True}


@router.post("/mcp/probe")
async def probe_mcp_servers(request: Request):
    """Re-probe all MCP servers and return updated status."""
    session = _get_session(request)
    mcp = session.mcp
    if not mcp:
        return {"servers": []}
    await mcp.probe_servers()
    return {
        "servers": [
            {"name": name, "status": mcp.get_status(name), "error": mcp.get_error(name)}
            for name in mcp.server_names
        ],
    }


# ── Session endpoints ──


@router.get("/sessions/{name}/turns")
async def get_session_turns(request: Request, name: str, last: int | None = None):
    """Return turn audit log."""
    session = _get_session(request)
    if not session.turn_logger:
        return {"turns": []}
    return {"turns": session.turn_logger.read_turns(last=last)}


@router.get("/session/history")
async def get_session_history(request: Request):
    """Return conversation history for current session."""
    session = _get_session(request)
    return {
        "history": [
            {"role": m.role, "content": m.content}
            for m in session.history
        ],
        "turns": session._turn_count,
    }


@router.post("/session/reset")
async def reset_session(request: Request):
    """Reset conversation state and demote all graph nodes to cold."""
    session = _get_session(request)
    await session.reset()
    # Reset all graph nodes to COLD so new conversation starts fresh
    _reset_graph_layers(request)
    # Reset Acervo proxy state (turn count, enrichment cache)
    await _reset_acervo_proxy(session)
    return {"reset": True}


def _reset_graph_layers(request: Request) -> None:
    """Set all graph nodes to 'cold' status for a fresh conversation."""
    try:
        acervo_dir = _get_acervo_dir(request)
        graph_dir = acervo_dir / "data" / "graph"
        nodes_path = graph_dir / "nodes.json"
        if not nodes_path.exists():
            return
        with open(nodes_path, "r", encoding="utf-8") as f:
            nodes = json_mod.load(f)
        changed = False
        for n in nodes:
            status = n.get("status", "")
            if status in ("hot", "warm"):
                n["status"] = "cold"
                changed = True
        if changed:
            with open(nodes_path, "w", encoding="utf-8") as f:
                json_mod.dump(nodes, f, ensure_ascii=False, indent=2)
    except Exception:
        pass  # Non-critical


async def _reset_acervo_proxy(session) -> None:
    """Reset Acervo proxy state (turn count, enrichment cache)."""
    if not session.settings.plugins.acervo.enabled:
        return
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            await client.post(
                f"{base_url}/acervo/reset",
                timeout=aiohttp.ClientTimeout(total=3),
            )
    except Exception:
        pass  # Non-critical


async def _clear_acervo_proxy(session) -> None:
    """Tell the proxy to clear ALL data (graph + vectordb) and reinitialize.

    Unlike _reset_acervo_proxy (which reloads from disk), this deletes data
    first. The proxy handles ChromaDB file locks internally.
    """
    if not session.settings.plugins.acervo.enabled:
        return
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            resp = await client.post(
                f"{base_url}/acervo/clear",
                timeout=aiohttp.ClientTimeout(total=10),
            )
            if resp.status != 200:
                body = await resp.text()
                logger.warning("Proxy clear failed (%d): %s", resp.status, body)
    except Exception as e:
        logger.warning("Could not reach proxy for clear: %s", e)


@router.get("/session/stats")
async def get_session_stats(request: Request):
    """Return full session stats."""
    session = _get_session(request)
    return session.get_stats()


# ── Trace endpoints ──


@router.get("/trace")
async def get_trace_events(request: Request):
    """Return all stored trace events for the current session."""
    session = _get_session(request)
    if not session.trace_store:
        return {"events": []}
    return {"events": session.trace_store.get_all()}


@router.delete("/trace")
async def clear_trace(request: Request):
    """Clear all trace events."""
    session = _get_session(request)
    if session.trace_store:
        session.trace_store.clear()
    return {"cleared": True}


# ── Settings endpoints ──


@router.get("/settings")
async def get_settings(request: Request):
    session = _get_session(request)
    return settings_to_dict(session.settings)


@router.put("/settings")
async def update_settings(request: Request, updates: dict[str, Any]):
    session = _get_session(request)
    save_settings(updates)
    # Reload frozen settings
    session.settings = load_settings()
    # Update pipeline base URL when Acervo plugin state changes
    if session.pipeline:
        if session.settings.plugins.acervo.enabled:
            session.pipeline._base_url_override = session.settings.plugins.acervo.proxy_url
        else:
            session.pipeline._base_url_override = None
    # Sync context settings to Acervo config
    if "context" in updates:
        ctx = updates["context"]
        if "plan_mode" in ctx or "history_window" in ctx:
            _sync_context_to_acervo(ctx)
    return {"saved": True, "settings": settings_to_dict(session.settings)}


def _sync_context_to_acervo(ctx_updates: dict) -> None:
    """Sync context settings (plan_mode, history_window) to Acervo's config.toml."""
    try:
        acervo_dir = Path(load_settings().plugins.acervo.acervo_dir)
        config_path = acervo_dir / "config.toml"
        if config_path.exists():
            from acervo.config import AcervoConfig
            cfg = AcervoConfig.load(config_path)
            if "plan_mode" in ctx_updates:
                cfg.context.plan_mode = ctx_updates["plan_mode"]
            if "history_window" in ctx_updates:
                cfg.context.history_window = ctx_updates["history_window"]
            cfg.save(config_path)
    except Exception:
        pass  # Non-critical


# ── Agent endpoints ──


@router.get("/agents")
async def list_agents():
    agents = []
    for f in sorted(_AGENTS_DIR.glob("*.yaml")):
        with open(f, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        agents.append({
            "name": data.get("name", f.stem),
            "description": data.get("description", ""),
            "file": f.name,
        })
    return {"agents": agents}


@router.get("/agents/{name}")
async def get_agent(name: str):
    path = _AGENTS_DIR / f"{name}.yaml"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data


@router.put("/agents/{name}")
async def save_agent(name: str, config: AgentConfig):
    path = _AGENTS_DIR / f"{name}.yaml"
    data = config.model_dump()
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    return {"saved": True, "name": name}


@router.delete("/agents/{name}")
async def delete_agent(name: str):
    if name == "default":
        raise HTTPException(status_code=400, detail="Cannot delete the default agent")
    path = _AGENTS_DIR / f"{name}.yaml"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    path.unlink()
    return {"deleted": True, "name": name}


# ── Acervo plugin endpoints ──


@router.get("/plugins/acervo/status")
async def get_acervo_status(request: Request):
    """Proxy to Acervo proxy's /acervo/status endpoint."""
    session = _get_session(request)
    if not session.settings.plugins.acervo.enabled:
        return {"status": "disabled"}
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            async with client.get(f"{base_url}/acervo/status", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                return await resp.json()
    except Exception as e:
        return {"status": "disconnected", "error": str(e)}


@router.get("/plugins/acervo/changelog")
async def get_acervo_changelog(request: Request):
    """Proxy to Acervo proxy's /acervo/changelog endpoint."""
    session = _get_session(request)
    if not session.settings.plugins.acervo.enabled:
        return {"changelog": []}
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            async with client.get(f"{base_url}/acervo/changelog", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                return await resp.json()
    except Exception:
        return {"changelog": []}


@router.post("/plugins/acervo/test")
async def test_acervo_connection(request: Request):
    """Test connection to Acervo proxy."""
    session = _get_session(request)
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            async with client.get(f"{base_url}/acervo/status", timeout=aiohttp.ClientTimeout(total=5)) as resp:
                data = await resp.json()
                graph = data.get("graph", {})
                return {
                    "ok": True,
                    "message": f"Connected ({graph.get('node_count', 0)} nodes, {graph.get('edge_count', 0)} edges)",
                    "graph": graph,
                }
    except Exception as e:
        return {"ok": False, "message": str(e)}


@router.get("/plugins/acervo/graph-info")
async def get_acervo_graph_info(request: Request):
    """Read graph stats directly from .acervo/data/graph/ files on disk."""
    from plugins.acervo_plugin import read_graph_info
    acervo_dir = _get_acervo_dir(request)
    info = read_graph_info(acervo_dir)
    info["acervo_dir"] = str(acervo_dir)
    return info


@router.get("/plugins/acervo/config")
async def get_acervo_config(request: Request):
    """Read Acervo's .acervo/config.toml and return relevant sections."""
    acervo_dir = _get_acervo_dir(request)
    config_path = acervo_dir / "config.toml"
    if not config_path.exists():
        return {"initialized": False}
    try:
        from acervo.config import AcervoConfig
        cfg = AcervoConfig.load(config_path)
        return {
            "initialized": True,
            "model": {"name": cfg.model.name, "url": cfg.model.url, "api_key": cfg.model.api_key},
            "embeddings": {"url": cfg.embeddings.url, "model": cfg.embeddings.model, "api_key": cfg.embeddings.api_key},
            "proxy": {"port": cfg.proxy.port, "target": cfg.proxy.target, "provider_name": cfg.proxy.provider_name},
            "context": {"max_tokens": cfg.context.max_tokens, "injection": cfg.context.injection},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/plugins/acervo/config")
async def update_acervo_config(request: Request, updates: dict[str, Any]):
    """Update Acervo's .acervo/config.toml with partial updates."""
    acervo_dir = _get_acervo_dir(request)
    config_path = acervo_dir / "config.toml"
    if not config_path.exists():
        raise HTTPException(status_code=404, detail=".acervo/config.toml not found")
    try:
        from acervo.config import AcervoConfig
        cfg = AcervoConfig.load(config_path)
        # Apply updates to mutable config
        for section, values in updates.items():
            if not isinstance(values, dict):
                continue
            obj = getattr(cfg, section, None)
            if obj is None:
                continue
            for key, val in values.items():
                if hasattr(obj, key):
                    setattr(obj, key, val)
        cfg.save(config_path)
        return {"saved": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/plugins/acervo/context-layers")
async def get_acervo_context_layers(request: Request):
    """Return graph nodes categorized by activation layer (hot/warm/cold)."""
    acervo_dir = _get_acervo_dir(request)
    data = _read_graph_files(acervo_dir)
    nodes = data["nodes"]
    edges = data["edges"]

    # Categorize nodes by runtime status
    hot_nodes = []
    warm_nodes = []
    cold_nodes = []

    for n in nodes:
        status = n.get("status", "cold")
        facts = n.get("facts", [])
        # Rough token estimate: label + type + each fact ~10 tokens
        token_est = 5 + len(facts) * 10
        for f in facts:
            token_est += len(f.get("fact", "").split()) // 2

        # Count edges for this node
        node_id = n.get("id", "")
        edge_count = sum(
            1 for e in edges
            if e.get("source") == node_id or e.get("target") == node_id
        )

        entry = {
            "id": node_id,
            "label": n.get("label", ""),
            "type": n.get("type", "entity"),
            "kind": n.get("kind", "entity"),
            "source": n.get("source", "conversation"),
            "verified": n.get("attributes", {}).get("verified", False),
            "status": status,
            "token_count": token_est,
            "last_active": n.get("last_active", ""),
            "facts_count": len(facts),
            "edges_count": edge_count,
        }

        if status == "hot":
            hot_nodes.append(entry)
        elif status == "warm":
            warm_nodes.append(entry)
        else:
            cold_nodes.append(entry)

    # Sort each layer by last_active descending
    for layer in (hot_nodes, warm_nodes, cold_nodes):
        layer.sort(key=lambda x: x["last_active"], reverse=True)

    hot_tokens = sum(n["token_count"] for n in hot_nodes)
    warm_tokens = sum(n["token_count"] for n in warm_nodes)
    cold_tokens = sum(n["token_count"] for n in cold_nodes)

    return {
        "layers": {
            "hot": {"nodes": hot_nodes, "total_tokens": hot_tokens},
            "warm": {"nodes": warm_nodes, "total_tokens": warm_tokens},
            "cold": {"nodes": cold_nodes, "total_tokens": cold_tokens},
        },
        "totals": {
            "nodes": len(nodes),
            "edges": len(edges),
            "hot_tokens": hot_tokens,
            "warm_tokens": warm_tokens,
            "cold_tokens": cold_tokens,
        },
    }


@router.delete("/plugins/acervo/data")
async def clear_acervo_data(request: Request):
    """Clear all Acervo data (graph, vectordb, sessions) and reset proxy state.

    Delegates data deletion to the proxy's /acervo/clear endpoint so that
    ChromaDB file locks are properly released before removing vectordb files.
    """
    session = _get_session(request)
    try:
        # Tell proxy to clear its data (handles ChromaDB locks internally)
        await _clear_acervo_proxy(session)
        # Reset conversation history in AVS-Agents
        await session.reset()
        return {"cleared": True}
    except Exception as e:
        logger.exception("Failed to clear Acervo data")
        raise HTTPException(status_code=500, detail=str(e))


# ── Prompts endpoints ──


@router.get("/prompts")
async def list_prompts():
    """List all editable prompt files."""
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    prompts = []
    for f in sorted(_PROMPTS_DIR.glob("*.md")):
        prompts.append({"name": f.stem, "file": f.name})
    return {"prompts": prompts}


@router.get("/prompts/{name}")
async def get_prompt(name: str):
    path = _PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Prompt '{name}' not found")
    content = path.read_text(encoding="utf-8")
    return {"name": name, "content": content}


@router.put("/prompts/{name}")
async def save_prompt(name: str, body: PromptUpdate):
    _PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    path = _PROMPTS_DIR / f"{name}.md"
    path.write_text(body.content, encoding="utf-8")
    return {"saved": True, "name": name}


# ── System prompt endpoints ──


def _load_agent_config(name: str = "default") -> dict:
    path = _AGENTS_DIR / f"{name}.yaml"
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _save_agent_system_prompt(prompt: str) -> None:
    path = _AGENTS_DIR / "default.yaml"
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    config["system_prompt"] = prompt
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


@router.get("/system-prompt")
async def get_system_prompt(request: Request):
    """Get the current system prompt and the default for reset."""
    session = _get_session(request)
    agent_config = _load_agent_config()
    return {
        "prompt": session.system_prompt,
        "default": agent_config["system_prompt"].strip(),
    }


@router.put("/system-prompt")
async def update_system_prompt(request: Request, body: PromptUpdate):
    """Update the system prompt for the active session and persist to disk."""
    session = _get_session(request)
    new_prompt = body.content.strip()
    session.system_prompt = new_prompt
    # Update the system message in current history
    if session.history and session.history[0].role == "system":
        from providers.base import ChatMessage
        session.history[0] = ChatMessage(role="system", content=new_prompt)
    # Persist to agent YAML so it survives restarts
    _save_agent_system_prompt(new_prompt)
    return {"saved": True}
