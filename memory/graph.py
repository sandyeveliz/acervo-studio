"""Topic graph — persists entity nodes and edges to JSON.

Structure follows docs/CONTEXT_ENGINE_DESIGN.md.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_PATH = Path("data/graph")


def _make_id(name: str) -> str:
    """Convert a name to a stable node ID."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


class TopicGraph:
    """In-memory graph with JSON persistence."""

    def __init__(self, path: Path = _DEFAULT_PATH) -> None:
        self._path = path
        self._nodes: dict[str, dict] = {}  # id → node
        self._edges: list[dict] = []
        self._session_id = f"s_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self._load()

    def _load(self) -> None:
        self._path.mkdir(parents=True, exist_ok=True)
        nodes_file = self._path / "nodes.json"
        edges_file = self._path / "edges.json"
        if nodes_file.exists():
            try:
                self._nodes = {n["id"]: n for n in json.loads(nodes_file.read_text(encoding="utf-8"))}
            except (json.JSONDecodeError, KeyError):
                self._nodes = {}
        if edges_file.exists():
            try:
                self._edges = json.loads(edges_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                self._edges = []

    def _save(self) -> None:
        self._path.mkdir(parents=True, exist_ok=True)
        nodes_file = self._path / "nodes.json"
        edges_file = self._path / "edges.json"
        nodes_file.write_text(
            json.dumps(list(self._nodes.values()), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        edges_file.write_text(
            json.dumps(self._edges, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def upsert_entities(self, entities: list[tuple[str, str]]) -> tuple[int, int]:
        """Upsert entities and create co_mentioned edges.

        Args:
            entities: list of (name, type) pairs from the extractor.

        Returns:
            (total_nodes, total_edges) after the update.
        """
        now = datetime.now().isoformat(timespec="seconds")
        node_ids: list[str] = []

        for name, etype in entities:
            nid = _make_id(name)
            node_ids.append(nid)

            if nid in self._nodes:
                node = self._nodes[nid]
                node["last_active"] = now
                node["session_count"] = node.get("session_count", 0) + 1
                facts = node.setdefault("facts", [])
                # Don't add duplicate session references
                if not any(f.get("session") == self._session_id for f in facts):
                    facts.append({
                        "fact": f"mencionado en sesión",
                        "date": now[:10],
                        "session": self._session_id,
                    })
            else:
                self._nodes[nid] = {
                    "id": nid,
                    "label": name,
                    "type": etype,
                    "created_at": now,
                    "last_active": now,
                    "session_count": 1,
                    "attributes": {},
                    "facts": [{
                        "fact": "primera mención",
                        "date": now[:10],
                        "session": self._session_id,
                    }],
                }

        # Create co_mentioned edges between all entities in this turn
        for i, src in enumerate(node_ids):
            for tgt in node_ids[i + 1:]:
                if not self._edge_exists(src, tgt, "co_mentioned"):
                    self._edges.append({
                        "source": src,
                        "target": tgt,
                        "relation": "co_mentioned",
                        "weight": 1.0,
                        "created_at": now,
                    })
                else:
                    # Increment weight on existing edge
                    for edge in self._edges:
                        if (
                            edge.get("relation") == "co_mentioned"
                            and {edge["source"], edge["target"]} == {src, tgt}
                        ):
                            edge["weight"] = edge.get("weight", 1.0) + 0.5
                            break

        self._save()

        log.info(
            "graph_update nodes=%d edges=%d",
            len(self._nodes),
            len(self._edges),
        )

        return len(self._nodes), len(self._edges)

    def _edge_exists(self, src: str, tgt: str, relation: str) -> bool:
        pair = {src, tgt}
        return any(
            e.get("relation") == relation and {e["source"], e["target"]} == pair
            for e in self._edges
        )

    @property
    def node_count(self) -> int:
        return len(self._nodes)

    @property
    def edge_count(self) -> int:
        return len(self._edges)
