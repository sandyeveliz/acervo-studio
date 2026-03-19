"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router
from api.rest_routes import router as rest_router
from api.session import SessionManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init session. Shutdown: cleanup."""
    session = SessionManager()
    await session.init()
    app.state.session = session
    yield
    await session.cleanup()


def create_app() -> FastAPI:
    app = FastAPI(title="AVS-Agents", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
