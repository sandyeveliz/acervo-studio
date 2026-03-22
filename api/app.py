"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router
from api.rest_routes import router as rest_router
from api.session import SessionRegistry


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init session registry. Shutdown: cleanup."""
    registry = SessionRegistry()
    await registry.init()
    app.state.registry = registry
    yield
    await registry.cleanup()


def create_app() -> FastAPI:
    app = FastAPI(title="Acervo Studio", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)
    app.include_router(rest_router)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app
