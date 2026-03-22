"""File tools — CRUD operations on .md files within a workspace folder.

Provides OpenAI-compatible tool definitions and a FileTools executor that
the pipeline's tool-use loop calls when the main LLM requests file operations.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# ── OpenAI-compatible tool definitions ──

TOOL_DEFINITIONS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List markdown (.md) files in the workspace directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Subfolder relative to workspace root. Omit or empty for root.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the full contents of a markdown (.md) file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to workspace root (e.g. 'notes/plan.md').",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a markdown (.md) file with the given content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to workspace root (e.g. 'docs/readme.md').",
                    },
                    "content": {
                        "type": "string",
                        "description": "Full markdown content to write.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a markdown (.md) file from the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to workspace root.",
                    },
                },
                "required": ["path"],
            },
        },
    },
]


class FileTools:
    """Executes file CRUD operations scoped to a workspace directory."""

    def __init__(self, workspace_path: str | Path) -> None:
        self._root = Path(workspace_path).resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    @property
    def tool_definitions(self) -> list[dict]:
        return TOOL_DEFINITIONS

    @property
    def available_tools(self) -> set[str]:
        return {"list_files", "read_file", "write_file", "delete_file"}

    def execute(self, name: str, arguments: dict) -> str:
        """Execute a tool call by name. Returns a result string for the LLM."""
        dispatch = {
            "list_files": self._list_files,
            "read_file": self._read_file,
            "write_file": self._write_file,
            "delete_file": self._delete_file,
        }
        handler = dispatch.get(name)
        if not handler:
            return json.dumps({"error": f"Unknown tool: {name}"})
        try:
            return handler(arguments)
        except Exception as e:
            log.error("File tool '%s' failed: %s", name, e)
            return json.dumps({"error": str(e)})

    # ── Path validation ──

    def _resolve(self, relative_path: str) -> Path:
        """Resolve a relative path within the workspace. Raises on traversal."""
        cleaned = relative_path.replace("\\", "/").strip("/")
        if ".." in cleaned.split("/"):
            raise ValueError(f"Path traversal not allowed: {relative_path}")
        target = (self._root / cleaned).resolve()
        if not str(target).startswith(str(self._root)):
            raise ValueError(f"Path outside workspace: {relative_path}")
        return target

    def _ensure_md(self, path: str) -> str:
        """Ensure path ends with .md extension."""
        if not path.lower().endswith(".md"):
            path = path + ".md"
        return path

    # ── Tool implementations ──

    def _list_files(self, args: dict) -> str:
        subpath = args.get("path", "").strip()
        target = self._resolve(subpath) if subpath else self._root
        if not target.is_dir():
            return json.dumps({"error": f"Not a directory: {subpath}"})

        files: list[str] = []
        for p in sorted(target.rglob("*.md")):
            rel = p.relative_to(self._root)
            files.append(str(rel).replace("\\", "/"))

        return json.dumps({"files": files, "count": len(files)})

    def _read_file(self, args: dict) -> str:
        raw_path = args.get("path", "").strip()
        if not raw_path:
            return json.dumps({"error": "Missing 'path' parameter"})
        raw_path = self._ensure_md(raw_path)
        target = self._resolve(raw_path)
        if not target.is_file():
            return json.dumps({"error": f"File not found: {raw_path}"})
        content = target.read_text(encoding="utf-8")
        return json.dumps({"path": raw_path, "content": content})

    def _write_file(self, args: dict) -> str:
        raw_path = args.get("path", "").strip()
        content = args.get("content", "")
        if not raw_path:
            return json.dumps({"error": "Missing 'path' parameter"})
        raw_path = self._ensure_md(raw_path)
        target = self._resolve(raw_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        existed = target.is_file()
        target.write_text(content, encoding="utf-8")
        action = "updated" if existed else "created"
        log.info("File %s: %s", action, raw_path)
        return json.dumps({"path": raw_path, "action": action, "size": len(content)})

    def _delete_file(self, args: dict) -> str:
        raw_path = args.get("path", "").strip()
        if not raw_path:
            return json.dumps({"error": "Missing 'path' parameter"})
        raw_path = self._ensure_md(raw_path)
        target = self._resolve(raw_path)
        if not target.is_file():
            return json.dumps({"error": f"File not found: {raw_path}"})
        target.unlink()
        log.info("File deleted: %s", raw_path)
        return json.dumps({"path": raw_path, "action": "deleted"})
