"""REST API endpoints for settings, agents, sessions, MCP, and Acervo plugin."""

from __future__ import annotations

import asyncio
import json as json_mod
import logging
import re as re_mod
from dataclasses import asdict
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
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
    """Resolve the .acervo directory path from the active project or settings fallback."""
    active = get_repo().get_active_project()
    if active:
        return Path(active.path) / ".acervo"
    # Fallback: settings-based resolution (backward compatible)
    session = _get_session(request)
    acervo_dir = Path(session.settings.plugins.acervo.acervo_dir)
    if not acervo_dir.is_absolute():
        acervo_dir = Path.cwd() / acervo_dir
    return acervo_dir


# ── Project storage (repository pattern) ──

from db import get_repo
from db.models import Project as DbProject


def _make_project_id(name: str) -> str:
    """Generate a URL-safe project ID from a name."""
    slug = re_mod.sub(r"[^\w\s-]", "", name.lower())
    slug = re_mod.sub(r"[\s]+", "-", slug.strip())
    return slug[:50] or "project"


def _camel_to_snake(name: str) -> str:
    """Convert CamelCase to snake_case (e.g. IndexingStarted → indexing_started)."""
    s = re_mod.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re_mod.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


def _setup_indexer(project: Any, on_event: Any) -> Any:
    """Wire up Indexer dependencies from a loaded AcervoProject (mirrors cli.py)."""
    from acervo.graph import TopicGraph
    from acervo.indexer import Indexer

    config = project.config
    model_cfg = config.resolve_model()
    embed_cfg = config.embeddings.resolve()

    llm = None
    if model_cfg.url:
        from acervo.openai_client import OpenAIClient
        llm = OpenAIClient(base_url=model_cfg.url, model=model_cfg.name, api_key=model_cfg.api_key)

    embedder = None
    if embed_cfg.model and embed_cfg.url:
        from acervo.openai_client import OllamaEmbedder
        embedder = OllamaEmbedder(base_url=embed_cfg.url, model=embed_cfg.model)

    graph = TopicGraph(project.graph_path)

    vector_store = None
    if embedder:
        try:
            from acervo.vector_store import ChromaVectorStore
            project.vectordb_path.mkdir(parents=True, exist_ok=True)
            vector_store = ChromaVectorStore(
                persist_path=str(project.vectordb_path),
                embed_fn=embedder.embed,
                embed_batch_fn=getattr(embedder, "embed_batch", None),
            )
        except Exception as e:
            logger.warning("Vector store disabled: %s", e)

    return Indexer(graph=graph, llm=llm, embedder=embedder, vector_store=vector_store, on_event=on_event)


# In-memory lock to prevent concurrent indexing of the same project.
_indexing_locks: dict[str, bool] = {}


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


class ProjectCreate(BaseModel):
    name: str
    path: str


class ProjectDescriptionUpdate(BaseModel):
    description: str


# ── Project endpoints ──


def _project_response(p: DbProject) -> dict:
    """Build a project response dict with init/index status and graph stats."""
    acervo_dir = Path(p.path) / ".acervo"
    config_path = acervo_dir / "config.toml"
    initialized = acervo_dir.exists() and config_path.exists()
    valid = Path(p.path).is_dir()
    resp: dict[str, Any] = {**p.to_dict(), "valid": valid, "initialized": initialized}
    if initialized:
        graph_data = _read_graph_files(acervo_dir)
        resp["nodes"] = len(graph_data["nodes"])
        resp["edges"] = len(graph_data["edges"])
        # Read description from .acervo/config.toml
        try:
            from acervo.config import AcervoConfig
            cfg = AcervoConfig.load(config_path)
            resp["description"] = cfg.description
        except Exception:
            resp["description"] = ""
    else:
        resp["nodes"] = 0
        resp["edges"] = 0
        resp["description"] = ""
    return resp


def _unique_project_id(name: str) -> str:
    """Generate a unique project ID, appending a suffix if needed."""
    repo = get_repo()
    base_id = _make_project_id(name)
    existing_ids = {p.id for p in repo.list_projects()}
    if base_id not in existing_ids:
        return base_id
    suffix = 2
    while f"{base_id}-{suffix}" in existing_ids:
        suffix += 1
    return f"{base_id}-{suffix}"


@router.get("/projects")
async def list_projects():
    """List all registered projects with active indicator."""
    repo = get_repo()
    projects = repo.list_projects()
    active = repo.get_active_project()
    logger.info("GET /projects → %d projects, active=%s", len(projects), active.id if active else None)
    return {
        "active": active.id if active else None,
        "projects": [_project_response(p) for p in projects],
    }


@router.post("/projects")
async def add_project(body: ProjectCreate):
    """Register a project folder. Does not require .acervo/ to exist yet."""
    project_path = Path(body.path).resolve()

    if not project_path.is_dir():
        raise HTTPException(400, f"Not a directory: {project_path}")

    repo = get_repo()

    # Skip if already registered (same path)
    existing = repo.project_exists_by_path(str(project_path))
    if existing:
        return _project_response(existing)

    project_id = _unique_project_id(body.name)
    project = DbProject(id=project_id, name=body.name, path=str(project_path))
    repo.add_project(project)

    return _project_response(repo.get_project(project_id) or project)


# Static /projects/* routes MUST come before /projects/{project_id} to avoid
# FastAPI matching "browse", "active", "check-path" as a project_id parameter.


@router.get("/projects/active")
async def get_active_project_endpoint(request: Request):
    """Get the currently active project with graph stats."""
    active = get_repo().get_active_project()
    if not active:
        return {"active": None}
    return _project_response(active)


@router.post("/projects/browse")
async def browse_folder():
    """Open a native OS folder picker dialog. Returns the selected path + .acervo status."""
    import concurrent.futures

    def _pick() -> str | None:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askdirectory(title="Select project folder")
        root.destroy()
        return path if path else None

    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        try:
            result_path = await loop.run_in_executor(pool, _pick)
        except Exception as e:
            raise HTTPException(500, str(e))

    if not result_path:
        return {"path": None, "cancelled": True}

    project_path = Path(result_path)
    acervo_dir = project_path / ".acervo"
    initialized = acervo_dir.exists() and (acervo_dir / "config.toml").exists()

    info: dict[str, Any] = {
        "path": str(project_path),
        "name": project_path.name,
        "cancelled": False,
        "initialized": initialized,
    }

    if initialized:
        graph_data = _read_graph_files(acervo_dir)
        info["nodes"] = len(graph_data["nodes"])
        info["edges"] = len(graph_data["edges"])

    return info


@router.post("/projects/init")
async def init_project_endpoint(body: dict):
    """Initialize .acervo/ in a folder and auto-register as a project."""
    path_str = body.get("path", "")
    if not path_str:
        raise HTTPException(400, "path is required")

    project_path = Path(path_str).resolve()
    if not project_path.is_dir():
        raise HTTPException(400, f"Not a directory: {project_path}")

    from acervo.project import init_project

    try:
        init_project(project_path)
    except Exception as e:
        raise HTTPException(500, f"Init failed: {e}")

    repo = get_repo()

    # Skip if already registered (same path)
    existing = repo.project_exists_by_path(str(project_path))
    if existing:
        return _project_response(existing)

    project_id = _unique_project_id(project_path.name)
    project = DbProject(id=project_id, name=project_path.name, path=str(project_path))
    repo.add_project(project)

    return _project_response(repo.get_project(project_id) or project)


@router.post("/projects/check-path")
async def check_project_path(body: dict):
    """Check if a given path contains an initialized Acervo project."""
    path_str = body.get("path", "")
    if not path_str:
        raise HTTPException(400, "path is required")

    project_path = Path(path_str).resolve()
    if not project_path.exists():
        return {"path": str(project_path), "exists": False, "initialized": False}

    acervo_dir = project_path / ".acervo"
    initialized = acervo_dir.exists() and (acervo_dir / "config.toml").exists()

    info: dict[str, Any] = {
        "path": str(project_path),
        "name": project_path.name,
        "exists": True,
        "initialized": initialized,
    }

    if initialized:
        graph_data = _read_graph_files(acervo_dir)
        info["nodes"] = len(graph_data["nodes"])
        info["edges"] = len(graph_data["edges"])

    return info


# Parameterized /projects/{project_id} routes — AFTER all static /projects/* routes.


@router.delete("/projects/{project_id}")
async def remove_project(project_id: str):
    """Unregister a project (does not delete .acervo data)."""
    repo = get_repo()
    if not repo.remove_project(project_id):
        raise HTTPException(404, f"Project not found: {project_id}")
    active = repo.get_active_project()
    return {"removed": project_id, "active": active.id if active else None}


@router.post("/projects/{project_id}/select")
async def select_project(project_id: str, request: Request):
    """Set a project as the active project."""
    repo = get_repo()
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(404, f"Project not found: {project_id}")
    repo.set_active_project(project_id)
    project = repo.get_project(project_id)
    if not project:
        return {}

    # Update session system prompt with project context
    resp = _project_response(project)
    session = _get_session(request)
    session.update_project_context(project.name, resp.get("description", ""))

    # Tell the proxy to switch to this project's graph
    await _switch_acervo_proxy_project(session, project.path)

    return resp


@router.patch("/projects/{project_id}/description")
async def update_project_description(project_id: str, body: ProjectDescriptionUpdate):
    """Update the project description in its .acervo/config.toml."""
    repo = get_repo()
    project = repo.get_project(project_id)
    if not project:
        raise HTTPException(404, f"Project not found: {project_id}")

    config_path = Path(project.path) / ".acervo" / "config.toml"
    if not config_path.exists():
        raise HTTPException(400, "Project not initialized — run 'acervo init' first")

    from acervo.config import AcervoConfig
    cfg = AcervoConfig.load(config_path)
    cfg.description = body.description.strip()
    cfg.save(config_path)

    return {"saved": True, "description": cfg.description}


@router.post("/projects/{project_id}/check-services")
async def check_project_services(project_id: str):
    """Probe LLM and Ollama endpoints from the project's .acervo/config.toml."""
    repo = get_repo()
    entry = repo.get_project(project_id)
    if not entry:
        raise HTTPException(404, f"Project not found: {project_id}")

    acervo_dir = Path(entry.path) / ".acervo"
    if not (acervo_dir / "config.toml").exists():
        raise HTTPException(400, "Project not initialized")

    from acervo.project import load_project
    project = load_project(acervo_dir)
    config = project.config
    model_cfg = config.resolve_model()
    embed_cfg = config.embeddings.resolve()

    import aiohttp

    async def _probe(url: str) -> bool:
        if not url:
            return False
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as s:
                async with s.get(url.rstrip("/") + "/v1/models" if "/v1" not in url else url + "/models") as r:
                    return r.status < 500
        except Exception:
            return False

    llm_ok = await _probe(model_cfg.url) if model_cfg.url else False
    embed_ok = await _probe(embed_cfg.url) if embed_cfg.url else False

    return {
        "llm_available": llm_ok,
        "embedder_available": embed_ok,
        "llm_url": model_cfg.url or "",
        "embedder_url": embed_cfg.url or "",
    }


@router.post("/projects/{project_id}/index")
async def index_project(project_id: str, request: Request, body: dict | None = None):
    """Run the indexation pipeline with SSE progress streaming."""
    if _indexing_locks.get(project_id):
        raise HTTPException(409, "Indexing already in progress for this project")

    repo = get_repo()
    entry = repo.get_project(project_id)
    if not entry:
        raise HTTPException(404, f"Project not found: {project_id}")

    acervo_dir = Path(entry.path) / ".acervo"
    if not (acervo_dir / "config.toml").exists():
        raise HTTPException(400, "Project not initialized")

    structural_only = (body or {}).get("structural_only", False)
    session = _get_session(request)

    async def generate():
        from acervo.project import load_project

        queue: asyncio.Queue = asyncio.Queue()
        _indexing_locks[project_id] = True

        try:
            project = load_project(acervo_dir)
        except Exception as e:
            yield f"event: error\ndata: {json_mod.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _indexing_locks.pop(project_id, None)
            return

        def on_event(event: object) -> None:
            queue.put_nowait(event)

        try:
            if structural_only:
                # Force no LLM/embedder — structural parse only
                from acervo.graph import TopicGraph
                from acervo.indexer import Indexer
                graph = TopicGraph(project.graph_path)
                indexer = Indexer(graph=graph, llm=None, embedder=None, vector_store=None, on_event=on_event)
            else:
                indexer = _setup_indexer(project, on_event)
        except Exception as e:
            yield f"event: error\ndata: {json_mod.dumps({'error': f'Setup failed: {e}'})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _indexing_locks.pop(project_id, None)
            return

        async def _run() -> None:
            try:
                result = await indexer.index(
                    project.workspace_root,
                    extensions=project.extensions,
                )
                queue.put_nowait(("result", result))
            except Exception as e:
                queue.put_nowait(("error", str(e)))
            finally:
                queue.put_nowait(None)  # sentinel

        task = asyncio.create_task(_run())

        try:
            while True:
                item = await queue.get()
                if item is None:
                    yield "event: done\ndata: {}\n\n"
                    break
                elif isinstance(item, tuple):
                    tag, payload = item
                    if tag == "result":
                        yield f"event: indexing_result\ndata: {json_mod.dumps(asdict(payload))}\n\n"
                        # Notify proxy to reload graph from disk
                        await _reload_proxy_graph(session)
                    else:
                        yield f"event: error\ndata: {json_mod.dumps({'error': payload})}\n\n"
                else:
                    event_name = _camel_to_snake(type(item).__name__)
                    try:
                        data = asdict(item)
                    except Exception:
                        data = {"type": type(item).__name__}
                    yield f"event: {event_name}\ndata: {json_mod.dumps(data)}\n\n"
        finally:
            _indexing_locks.pop(project_id, None)
            if not task.done():
                task.cancel()

    return StreamingResponse(generate(), media_type="text/event-stream")


# In-memory lock to prevent concurrent curation of the same project.
_curation_locks: dict[str, bool] = {}


@router.post("/projects/{project_id}/curate")
async def curate_project(project_id: str, request: Request):
    """Run batch curation with SSE progress streaming."""
    if _curation_locks.get(project_id):
        raise HTTPException(409, "Curation already in progress for this project")

    repo = get_repo()
    entry = repo.get_project(project_id)
    if not entry:
        raise HTTPException(404, f"Project not found: {project_id}")

    acervo_dir = Path(entry.path) / ".acervo"
    if not (acervo_dir / "config.toml").exists():
        raise HTTPException(400, "Project not initialized")

    session = _get_session(request)

    async def generate():
        from acervo.project import load_project
        from acervo.graph import TopicGraph
        from acervo.curator import curate_graph

        queue: asyncio.Queue = asyncio.Queue()
        _curation_locks[project_id] = True

        try:
            project = load_project(acervo_dir)
        except Exception as e:
            yield f"event: error\ndata: {json_mod.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _curation_locks.pop(project_id, None)
            return

        # Set up LLM client
        config = project.config
        model_cfg = config.resolve_model()
        llm = None
        if model_cfg.url:
            from acervo.openai_client import OpenAIClient
            llm = OpenAIClient(base_url=model_cfg.url, model=model_cfg.name, api_key=model_cfg.api_key)

        if not llm:
            yield f"event: error\ndata: {json_mod.dumps({'error': 'No LLM configured'})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _curation_locks.pop(project_id, None)
            return

        graph = TopicGraph(project.graph_path)

        def on_progress(event: str, data: dict) -> None:
            queue.put_nowait((event, data))

        async def _run() -> None:
            try:
                await curate_graph(graph, llm, on_progress=on_progress)
            except Exception as e:
                queue.put_nowait(("error", {"error": str(e)}))
            finally:
                queue.put_nowait(None)  # sentinel

        task = asyncio.create_task(_run())

        try:
            while True:
                item = await queue.get()
                if item is None:
                    # Reload proxy graph after curation modifies nodes
                    await _reload_proxy_graph(session)
                    yield "event: done\ndata: {}\n\n"
                    break
                event_name, data = item
                yield f"event: {event_name}\ndata: {json_mod.dumps(data)}\n\n"
        finally:
            _curation_locks.pop(project_id, None)
            if not task.done():
                task.cancel()

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── Synthesis endpoint ──

_synthesis_locks: dict[str, bool] = {}


@router.post("/projects/{project_id}/synthesize")
async def synthesize_project(project_id: str, request: Request):
    """Run graph synthesis with SSE progress streaming."""
    if _synthesis_locks.get(project_id):
        raise HTTPException(409, "Synthesis already in progress for this project")

    repo = get_repo()
    entry = repo.get_project(project_id)
    if not entry:
        raise HTTPException(404, f"Project not found: {project_id}")

    acervo_dir = Path(entry.path) / ".acervo"
    if not (acervo_dir / "config.toml").exists():
        raise HTTPException(400, "Project not initialized")

    session = _get_session(request)

    async def generate():
        from acervo.project import load_project
        from acervo.graph import TopicGraph
        from acervo.graph_synthesizer import synthesize_graph

        queue: asyncio.Queue = asyncio.Queue()
        _synthesis_locks[project_id] = True

        try:
            project = load_project(acervo_dir)
        except Exception as e:
            yield f"event: error\ndata: {json_mod.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _synthesis_locks.pop(project_id, None)
            return

        config = project.config
        model_cfg = config.resolve_model()
        llm = None
        if model_cfg.url:
            from acervo.openai_client import OpenAIClient
            llm = OpenAIClient(base_url=model_cfg.url, model=model_cfg.name, api_key=model_cfg.api_key)

        if not llm:
            yield f"event: error\ndata: {json_mod.dumps({'error': 'No LLM configured'})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _synthesis_locks.pop(project_id, None)
            return

        graph = TopicGraph(project.graph_path)
        description = getattr(project.config, "description", "") or ""

        def on_progress(event: str, data: dict) -> None:
            queue.put_nowait((event, data))

        async def _run() -> None:
            try:
                await synthesize_graph(
                    graph, llm,
                    project_description=description,
                    on_progress=on_progress,
                )
            except Exception as e:
                queue.put_nowait(("error", {"error": str(e)}))
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(_run())

        try:
            while True:
                item = await queue.get()
                if item is None:
                    try:
                        await _reload_proxy_graph(session)
                    except Exception as e:
                        logger.warning("Proxy reload after synthesis failed: %s", e)
                    yield "event: done\ndata: {}\n\n"
                    break
                event_name, data = item
                yield f"event: {event_name}\ndata: {json_mod.dumps(data)}\n\n"
        except Exception as e:
            logger.error("Synthesis stream error: %s", e)
            yield f"event: error\ndata: {json_mod.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: {}\n\n"
        finally:
            _synthesis_locks.pop(project_id, None)
            if not task.done():
                task.cancel()

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── File status & reindex endpoints ──


def _scan_project_files(
    workspace_root: Path, extensions: set[str], ignore: set[str],
) -> tuple[list[Path], list[Path]]:
    """Scan workspace for all files. Returns (indexable, unsupported) split by extension."""
    indexable: list[Path] = []
    unsupported: list[Path] = []
    for path in workspace_root.rglob("*"):
        if not path.is_file():
            continue
        parts = path.relative_to(workspace_root).parts
        if any(p in ignore for p in parts):
            continue
        if path.suffix in extensions:
            indexable.append(path)
        else:
            unsupported.append(path)
    return sorted(indexable), sorted(unsupported)


@router.get("/projects/{project_id}/files/status")
async def get_file_status(project_id: str):
    """Compare disk files vs graph nodes to determine indexation status per file."""
    repo = get_repo()
    entry = repo.get_project(project_id)
    if not entry:
        raise HTTPException(404, f"Project not found: {project_id}")

    acervo_dir = Path(entry.path) / ".acervo"
    if not (acervo_dir / "config.toml").exists():
        raise HTTPException(400, "Project not initialized")

    from acervo.project import load_project
    from acervo.graph import TopicGraph, _make_id
    from acervo.reindexer import hash_file

    project = load_project(acervo_dir)
    graph = TopicGraph(project.graph_path)
    workspace_root = project.workspace_root

    extensions = set(project.extensions)
    ignore = set(project.config.indexing.ignore)

    def _compute() -> dict:
        from datetime import datetime as dt
        import os

        indexable_files, unsupported_files = _scan_project_files(workspace_root, extensions, ignore)
        file_nodes = graph.get_nodes_by_kind("file")
        graph_paths = {}
        for node in file_nodes:
            p = node.get("attributes", {}).get("path")
            if p:
                graph_paths[p] = node

        result_files = []
        seen_paths = set()

        for full_path in indexable_files:
            rel = full_path.relative_to(workspace_root).as_posix()
            seen_paths.add(rel)
            node = graph_paths.get(rel)

            if node is None:
                # File on disk but not in graph — not indexed
                result_files.append({
                    "path": rel, "status": "new",
                    "indexed_at": None, "stale_since": None,
                })
                continue

            indexed_at = node.get("indexed_at")

            # Already marked stale by the system
            if node.get("stale"):
                result_files.append({
                    "path": rel, "status": "modified",
                    "indexed_at": indexed_at, "stale_since": node.get("stale_since"),
                })
                continue

            # Fast path: compare file mtime against indexed_at timestamp.
            # Only hash if the file was modified after indexation.
            needs_hash = True
            if indexed_at:
                try:
                    mtime = os.path.getmtime(full_path)
                    indexed_ts = dt.fromisoformat(indexed_at).timestamp()
                    if mtime <= indexed_ts:
                        needs_hash = False  # file untouched since indexation
                except Exception:
                    pass

            if not needs_hash:
                result_files.append({
                    "path": rel, "status": "indexed",
                    "indexed_at": indexed_at, "stale_since": None,
                })
                continue

            # Slow path: file mtime is newer, verify with content hash
            stored_hash = node.get("attributes", {}).get("content_hash", "")
            try:
                current_hash = hash_file(full_path)
            except Exception:
                current_hash = ""

            if stored_hash and current_hash == stored_hash:
                result_files.append({
                    "path": rel, "status": "indexed",
                    "indexed_at": indexed_at, "stale_since": None,
                })
            else:
                result_files.append({
                    "path": rel, "status": "modified",
                    "indexed_at": indexed_at, "stale_since": None,
                })

        # Graph nodes with no matching disk file — deleted
        for gpath, node in graph_paths.items():
            if gpath not in seen_paths:
                result_files.append({
                    "path": gpath, "status": "deleted",
                    "indexed_at": node.get("indexed_at"), "stale_since": None,
                })

        # Non-indexable files (e.g. .epub, .pdf) — shown but marked unsupported
        for full_path in unsupported_files:
            rel = full_path.relative_to(workspace_root).as_posix()
            result_files.append({
                "path": rel, "status": "unsupported",
                "indexed_at": None, "stale_since": None,
            })

        summary = {
            "total": len(result_files), "indexed": 0, "modified": 0,
            "new": 0, "deleted": 0, "unsupported": 0,
        }
        for f in result_files:
            summary[f["status"]] += 1

        return {"files": result_files, "summary": summary}

    result = await asyncio.to_thread(_compute)
    return result


class MarkStaleRequest(BaseModel):
    paths: list[str]


@router.post("/projects/{project_id}/files/mark-stale")
async def mark_files_stale(project_id: str, body: MarkStaleRequest):
    """Mark specific files as stale in the graph for re-indexing."""
    repo = get_repo()
    entry = repo.get_project(project_id)
    if not entry:
        raise HTTPException(404, f"Project not found: {project_id}")

    acervo_dir = Path(entry.path) / ".acervo"
    if not (acervo_dir / "config.toml").exists():
        raise HTTPException(400, "Project not initialized")

    from acervo.project import load_project
    from acervo.graph import TopicGraph

    project = load_project(acervo_dir)
    graph = TopicGraph(project.graph_path)

    marked = 0
    for path in body.paths:
        if graph.mark_file_stale(path):
            marked += 1

    if marked:
        graph.save()

    return {"marked": marked}


_reindex_locks: dict[str, bool] = {}


@router.post("/projects/{project_id}/reindex")
async def reindex_project(project_id: str):
    """Re-index stale files with SSE progress streaming."""
    if _reindex_locks.get(project_id):
        raise HTTPException(409, "Reindex already in progress for this project")

    repo = get_repo()
    entry = repo.get_project(project_id)
    if not entry:
        raise HTTPException(404, f"Project not found: {project_id}")

    acervo_dir = Path(entry.path) / ".acervo"
    if not (acervo_dir / "config.toml").exists():
        raise HTTPException(400, "Project not initialized")

    async def generate():
        from acervo.project import load_project
        from acervo.graph import TopicGraph
        from acervo.reindexer import Reindexer
        from acervo.structural_parser import StructuralParser

        _reindex_locks[project_id] = True

        try:
            project = load_project(acervo_dir)
        except Exception as e:
            yield f"event: error\ndata: {json_mod.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _reindex_locks.pop(project_id, None)
            return

        graph = TopicGraph(project.graph_path)
        parser = StructuralParser()
        reindexer = Reindexer(graph, parser, project.workspace_root)

        stale_files = graph.get_stale_files()
        stale_count = len(stale_files)

        yield f"event: reindex_started\ndata: {json_mod.dumps({'stale_count': stale_count})}\n\n"

        if stale_count == 0:
            yield f"event: reindex_complete\ndata: {json_mod.dumps({'reindexed': [], 'count': 0})}\n\n"
            yield "event: done\ndata: {}\n\n"
            _reindex_locks.pop(project_id, None)
            return

        try:
            reindexed = await reindexer.reindex_stale()
            yield f"event: reindex_complete\ndata: {json_mod.dumps({'reindexed': reindexed, 'count': len(reindexed)})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json_mod.dumps({'error': str(e)})}\n\n"
        finally:
            _reindex_locks.pop(project_id, None)
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


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


class NodeCreate(BaseModel):
    label: str
    type: str
    kind: str = "entity"
    layer: str = "PERSONAL"
    facts: list[dict[str, str]] | None = None


class NodeUpdate(BaseModel):
    label: str | None = None
    type: str | None = None
    attributes: dict[str, Any] | None = None


class EdgeCreate(BaseModel):
    source: str
    target: str
    relation: str
    weight: float = 1.0


class EdgeDelete(BaseModel):
    source: str
    target: str
    relation: str


@router.post("/graph/nodes")
async def create_graph_node(request: Request, body: NodeCreate):
    """Create a new node in the graph."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"
    try:
        from acervo.graph import TopicGraph
        graph = TopicGraph(graph_dir)
        facts = None
        if body.facts:
            facts = [(body.label, f.get("fact", ""), f.get("source", "user")) for f in body.facts]
        graph.upsert_entities(
            [(body.label, body.type)],
            None,
            facts,
            source="manual",
        )
        graph.save()
        from acervo.graph import _make_id
        node = graph.get_node(_make_id(body.label))
        return node or {"label": body.label, "type": body.type}
    except ImportError:
        raise HTTPException(status_code=500, detail="Acervo not installed")


@router.patch("/graph/nodes/{node_id}")
async def update_graph_node(request: Request, node_id: str, body: NodeUpdate):
    """Update an existing node's label, type, or attributes."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"
    try:
        from acervo.graph import TopicGraph
        graph = TopicGraph(graph_dir)
        fields = {}
        if body.label is not None:
            fields["label"] = body.label
        if body.type is not None:
            fields["type"] = body.type
        if body.attributes is not None:
            fields["attributes"] = body.attributes
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        ok = graph.update_node(node_id, **fields)
        if not ok:
            raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
        graph.save()
        return graph.get_node(node_id)
    except ImportError:
        raise HTTPException(status_code=500, detail="Acervo not installed")


@router.post("/graph/edges")
async def create_graph_edge(request: Request, body: EdgeCreate):
    """Create a new edge between two existing nodes."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"
    try:
        from acervo.graph import TopicGraph
        graph = TopicGraph(graph_dir)
        ok = graph.add_edge(body.source, body.target, body.relation, body.weight)
        if not ok:
            raise HTTPException(status_code=400, detail="Edge already exists or invalid node IDs")
        graph.save()
        return {"created": True, "source": body.source, "target": body.target, "relation": body.relation}
    except ImportError:
        raise HTTPException(status_code=500, detail="Acervo not installed")


@router.delete("/graph/edges")
async def delete_graph_edge(request: Request, body: EdgeDelete):
    """Delete an edge between two nodes."""
    acervo_dir = _get_acervo_dir(request)
    graph_dir = acervo_dir / "data" / "graph"
    data = _read_graph_files(acervo_dir)
    before = len(data["edges"])
    data["edges"] = [
        e for e in data["edges"]
        if not (
            e.get("source") == body.source
            and e.get("target") == body.target
            and e.get("relation") == body.relation
        )
    ]
    if len(data["edges"]) == before:
        raise HTTPException(status_code=404, detail="Edge not found")
    _write_graph_files(graph_dir, data)
    return {"deleted": True, "source": body.source, "target": body.target, "relation": body.relation}


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
        if not facts:
            issues.append({
                "type": "empty_facts",
                "severity": "info",
                "message": f'Empty facts: "{n.get("label")}" — no facts stored',
                "reason": "0 facts",
                "node_ids": [n.get("id")],
                "nodes": [n],
            })

    # ── Stats ──
    by_source: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    verified_count = 0

    for n in nodes:
        src = n.get("source", "unknown")
        by_source[src] = by_source.get(src, 0) + 1
        typ = n.get("type", "Unknown")
        by_type[typ] = by_type.get(typ, 0) + 1
        kind = n.get("kind", "entity")
        by_kind[kind] = by_kind.get(kind, 0) + 1
        if n.get("attributes", {}).get("verified"):
            verified_count += 1

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
            "verified_count": verified_count,
            "unverified_count": len(nodes) - verified_count,
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
    """Reset conversation state."""
    session = _get_session(request)
    await session.reset()
    # Reset Acervo proxy state (turn count, enrichment cache)
    await _reset_acervo_proxy(session)
    return {"reset": True}


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


async def _reload_proxy_graph(session) -> None:
    """Tell the proxy to reload its graph from disk after indexing."""
    if not session.settings.plugins.acervo.enabled:
        return
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            resp = await client.post(
                f"{base_url}/acervo/reload-graph",
                timeout=aiohttp.ClientTimeout(total=5),
            )
            if resp.status == 200:
                data = await resp.json()
                logger.info("Proxy graph reloaded: %s", data.get("graph"))
            else:
                body = await resp.text()
                logger.warning("Proxy reload-graph failed (%d): %s", resp.status, body)
    except Exception as e:
        logger.warning("Could not reach proxy for reload-graph: %s", e)


async def _switch_acervo_proxy_project(session, project_path: str) -> None:
    """Tell the proxy to switch to a different project's graph."""
    if not session.settings.plugins.acervo.enabled:
        return
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            resp = await client.post(
                f"{base_url}/acervo/switch-project",
                json={"project_path": project_path},
                timeout=aiohttp.ClientTimeout(total=5),
            )
            if resp.status == 200:
                data = await resp.json()
                logger.info("Proxy switched to %s: %s", project_path, data.get("graph"))
            else:
                body = await resp.text()
                logger.warning("Proxy switch-project failed (%d): %s", resp.status, body)
    except Exception as e:
        logger.warning("Could not reach proxy for switch-project: %s", e)


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
    """Proxy to Acervo proxy's /acervo/status endpoint.

    Also ensures the proxy is pointed at the correct active project.
    """
    session = _get_session(request)
    if not session.settings.plugins.acervo.enabled:
        return {"status": "disabled"}
    base_url = session.settings.plugins.acervo.proxy_url.rstrip("/").removesuffix("/v1")
    try:
        import aiohttp
        async with aiohttp.ClientSession() as client:
            async with client.get(f"{base_url}/acervo/status", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                data = await resp.json()

        # Check if proxy is on the right project
        active = get_repo().get_active_project()
        if active:
            proxy_path = Path(data.get("project_path", "")).resolve()
            active_path = Path(active.path).resolve()
            if proxy_path != active_path:
                logger.info("Proxy project mismatch: %s vs %s — switching", proxy_path, active_path)
                await _switch_acervo_proxy_project(session, active.path)
                # Re-fetch status after switch
                async with aiohttp.ClientSession() as client:
                    async with client.get(f"{base_url}/acervo/status", timeout=aiohttp.ClientTimeout(total=3)) as resp:
                        data = await resp.json()

        return data
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
    """Return graph nodes categorized by kind (entity/file/symbol).

    Runtime activation (hot/warm/cold) no longer lives in nodes — it's
    ephemeral per-conversation. This endpoint shows the persistent graph.
    """
    acervo_dir = _get_acervo_dir(request)
    data = _read_graph_files(acervo_dir)
    nodes = data["nodes"]
    edges = data["edges"]

    by_kind: dict[str, list[dict]] = {}

    for n in nodes:
        facts = n.get("facts", [])
        token_est = 5 + len(facts) * 10
        for f in facts:
            token_est += len(f.get("fact", "").split()) // 2

        node_id = n.get("id", "")
        edge_count = sum(
            1 for e in edges
            if e.get("source") == node_id or e.get("target") == node_id
        )

        kind = n.get("kind", "entity")
        entry = {
            "id": node_id,
            "label": n.get("label", ""),
            "type": n.get("type", "entity"),
            "kind": kind,
            "source": n.get("source", "conversation"),
            "verified": n.get("attributes", {}).get("verified", False),
            "token_count": token_est,
            "last_active": n.get("last_active", ""),
            "facts_count": len(facts),
            "edges_count": edge_count,
        }
        by_kind.setdefault(kind, []).append(entry)

    # Sort each group by last_active descending
    for group in by_kind.values():
        group.sort(key=lambda x: x["last_active"], reverse=True)

    total_tokens = sum(n["token_count"] for group in by_kind.values() for n in group)

    return {
        "by_kind": {
            kind: {"nodes": group, "total_tokens": sum(n["token_count"] for n in group)}
            for kind, group in by_kind.items()
        },
        "totals": {
            "nodes": len(nodes),
            "edges": len(edges),
            "total_tokens": total_tokens,
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
        # Reset conversation history
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
