"""REST API endpoints for graph management, settings, and agents."""

from __future__ import annotations

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

# ── Pydantic models ──


class FactDelete(BaseModel):
    fact: str


class EdgeDelete(BaseModel):
    source: str
    target: str
    relation: str


class NodeUpdate(BaseModel):
    label: str | None = None
    type: str | None = None
    attributes: dict[str, Any] | None = None


class NodeMerge(BaseModel):
    keep_id: str
    absorb_id: str
    alias: str | None = None


class AgentConfig(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    temperature: float = 0.7


# ── Graph endpoints ──


def _get_graph(request: Request):
    session = request.app.state.session
    if not session.memory:
        raise HTTPException(status_code=503, detail="Session not initialized")
    return session.memory.graph


@router.get("/graph/nodes")
async def get_graph_nodes(request: Request, type: str | None = None):
    graph = _get_graph(request)
    nodes = graph.get_all_nodes()
    if type:
        nodes = [n for n in nodes if n.get("type", "").lower() == type.lower()]
    return {"nodes": nodes}


@router.get("/graph/nodes/{node_id}")
async def get_graph_node(request: Request, node_id: str):
    graph = _get_graph(request)
    node = graph.get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    return node


@router.get("/graph/nodes/{node_id}/neighbors")
async def get_node_neighbors(request: Request, node_id: str, max_count: int = 10):
    graph = _get_graph(request)
    neighbors = graph.get_neighbors(node_id, max_count=max_count)
    return {"neighbors": [{"node": n, "weight": w} for n, w in neighbors]}


@router.get("/graph/edges")
async def get_graph_edges(request: Request, node_id: str | None = None):
    graph = _get_graph(request)
    if node_id:
        edges = graph.get_edges_for(node_id)
    else:
        edges = graph._edges  # noqa: SLF001
    return {"edges": edges}


@router.get("/graph/stats")
async def get_graph_stats(request: Request):
    graph = _get_graph(request)
    nodes = graph.get_all_nodes()
    type_dist: dict[str, int] = {}
    for n in nodes:
        t = n.get("type", "unknown")
        type_dist[t] = type_dist.get(t, 0) + 1
    return {
        "node_count": graph.node_count,
        "edge_count": graph.edge_count,
        "type_distribution": type_dist,
    }


@router.delete("/graph/nodes/{node_id}")
async def delete_graph_node(request: Request, node_id: str):
    graph = _get_graph(request)
    removed = graph.remove_node(node_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    graph.save()
    return {"removed": True}


@router.delete("/graph/nodes/{node_id}/facts")
async def delete_node_fact(request: Request, node_id: str, body: FactDelete):
    graph = _get_graph(request)
    node = graph.get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    removed = graph.remove_fact(node.get("label", node_id), body.fact)
    if not removed:
        raise HTTPException(status_code=404, detail="Fact not found")
    graph.save()
    return {"removed": True}


@router.post("/graph/merge")
async def merge_graph_nodes(request: Request, body: NodeMerge):
    graph = _get_graph(request)
    if not graph.get_node(body.keep_id):
        raise HTTPException(status_code=404, detail=f"Node '{body.keep_id}' not found")
    if not graph.get_node(body.absorb_id):
        raise HTTPException(status_code=404, detail=f"Node '{body.absorb_id}' not found")
    merged = graph.merge_nodes(body.keep_id, body.absorb_id, alias=body.alias)
    if not merged:
        raise HTTPException(status_code=400, detail="Merge failed")
    graph.save()
    return {"merged": True, "kept": body.keep_id, "absorbed": body.absorb_id}


@router.patch("/graph/nodes/{node_id}")
async def update_graph_node(request: Request, node_id: str, body: NodeUpdate):
    graph = _get_graph(request)
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = graph.update_node(node_id, **fields)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    graph.save()
    return graph.get_node(node_id)


@router.get("/graph/export")
async def export_graph(request: Request):
    graph = _get_graph(request)
    return {
        "nodes": graph.get_all_nodes(),
        "edges": graph._edges,  # noqa: SLF001
    }


@router.post("/graph/import")
async def import_graph(request: Request, data: dict[str, Any]):
    graph = _get_graph(request)
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    if not nodes and not edges:
        raise HTTPException(status_code=400, detail="No nodes or edges in import data")
    # Replace graph data
    graph._nodes.clear()  # noqa: SLF001
    for node in nodes:
        nid = node.get("id")
        if nid:
            graph._nodes[nid] = node  # noqa: SLF001
    graph._edges = edges  # noqa: SLF001
    graph.save()
    return {"imported": True, "node_count": graph.node_count, "edge_count": graph.edge_count}


# ── Settings endpoints ──


@router.get("/settings")
async def get_settings(request: Request):
    session = request.app.state.session
    return settings_to_dict(session.settings)


@router.put("/settings")
async def update_settings(request: Request, updates: dict[str, Any]):
    session = request.app.state.session
    save_settings(updates)
    # Reload frozen settings
    session.settings = load_settings()
    return {"saved": True, "settings": settings_to_dict(session.settings)}


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
