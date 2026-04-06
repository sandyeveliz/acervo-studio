"""SQLite implementation of the Repository interface."""

from __future__ import annotations

import sqlite3
import logging
from datetime import datetime
from pathlib import Path

from db.models import Project
from db.repository import Repository

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class SQLiteRepository(Repository):
    """SQLite-backed storage. Thread-safe via check_same_thread=False."""

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._migrate()
        logger.info("SQLite repository opened: %s", db_path)

    def _migrate(self) -> None:
        """Create tables if they don't exist."""
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ── Projects ──

    def list_projects(self) -> list[Project]:
        active_id = self._get_setting("active_project")
        rows = self._conn.execute(
            "SELECT id, name, path, created_at FROM projects ORDER BY created_at"
        ).fetchall()
        return [self._row_to_project(r, active_id) for r in rows]

    def get_project(self, project_id: str) -> Project | None:
        active_id = self._get_setting("active_project")
        row = self._conn.execute(
            "SELECT id, name, path, created_at FROM projects WHERE id = ?",
            (project_id,),
        ).fetchone()
        return self._row_to_project(row, active_id) if row else None

    def add_project(self, project: Project) -> Project:
        self._conn.execute(
            "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
            (project.id, project.name, project.path, project.created_at.isoformat()),
        )
        # Auto-activate if this is the first project
        if self._get_setting("active_project") is None:
            self._set_setting("active_project", project.id)
            project.active = True
        self._conn.commit()
        return project

    def remove_project(self, project_id: str) -> bool:
        cur = self._conn.execute(
            "DELETE FROM projects WHERE id = ?", (project_id,)
        )
        if cur.rowcount == 0:
            return False

        # If we removed the active project, activate the first remaining one
        if self._get_setting("active_project") == project_id:
            first = self._conn.execute(
                "SELECT id FROM projects ORDER BY created_at LIMIT 1"
            ).fetchone()
            self._set_setting(
                "active_project", first["id"] if first else None
            )
        self._conn.commit()
        return True

    def get_active_project(self) -> Project | None:
        active_id = self._get_setting("active_project")
        if not active_id:
            return None
        return self.get_project(active_id)

    def set_active_project(self, project_id: str | None) -> None:
        if project_id is not None:
            row = self._conn.execute(
                "SELECT id FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if not row:
                return
        self._set_setting("active_project", project_id)
        self._conn.commit()

    def project_exists_by_path(self, path: str) -> Project | None:
        normalized = str(Path(path).resolve())
        active_id = self._get_setting("active_project")
        row = self._conn.execute(
            "SELECT id, name, path, created_at FROM projects WHERE path = ?",
            (normalized,),
        ).fetchone()
        return self._row_to_project(row, active_id) if row else None

    # ── Internal ──

    def _get_setting(self, key: str) -> str | None:
        row = self._conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

    def _set_setting(self, key: str, value: str | None) -> None:
        if value is None:
            self._conn.execute("DELETE FROM settings WHERE key = ?", (key,))
        else:
            self._conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )

    @staticmethod
    def _row_to_project(row: sqlite3.Row, active_id: str | None) -> Project:
        return Project(
            id=row["id"],
            name=row["name"],
            path=row["path"],
            active=row["id"] == active_id,
            created_at=datetime.fromisoformat(row["created_at"]),
        )
