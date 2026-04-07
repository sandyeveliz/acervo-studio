"""Database layer with repository pattern.

Usage:
    from db import get_repo
    repo = get_repo()          # returns the singleton repository
    projects = repo.list_projects()
"""

from db.repository import Repository
from db.sqlite import SQLiteRepository

_instance: Repository | None = None


def get_repo() -> Repository:
    """Return the singleton repository (lazily created)."""
    global _instance
    if _instance is None:
        from pathlib import Path
        db_path = Path(__file__).resolve().parent.parent / "data" / "studio.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _instance = SQLiteRepository(str(db_path))
    return _instance
