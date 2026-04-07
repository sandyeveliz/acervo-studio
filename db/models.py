"""Domain models for the database layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Project:
    """A registered Acervo project."""

    id: str
    name: str
    path: str
    active: bool = False
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "active": self.active,
            "created_at": self.created_at.isoformat(),
        }
