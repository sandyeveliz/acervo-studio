"""Abstract repository interface.

All storage backends must implement this interface. The rest of the application
depends only on Repository, never on a concrete implementation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from db.models import Project


class Repository(ABC):
    """Storage facade for Acervo Studio."""

    # ── Projects ──

    @abstractmethod
    def list_projects(self) -> list[Project]:
        """Return all registered projects."""

    @abstractmethod
    def get_project(self, project_id: str) -> Project | None:
        """Return a single project by ID, or None."""

    @abstractmethod
    def add_project(self, project: Project) -> Project:
        """Register a new project. Returns the saved project."""

    @abstractmethod
    def remove_project(self, project_id: str) -> bool:
        """Unregister a project. Returns True if it existed."""

    @abstractmethod
    def get_active_project(self) -> Project | None:
        """Return the currently active project, or None."""

    @abstractmethod
    def set_active_project(self, project_id: str | None) -> None:
        """Set a project as active. Pass None to deactivate all."""

    @abstractmethod
    def project_exists_by_path(self, path: str) -> Project | None:
        """Find a project by its filesystem path, or None."""
