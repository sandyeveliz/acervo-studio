"""WebSocket endpoint — bridges pipeline events to the frontend."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.serializers import StreamThrottle, serialize_event
from core.events import PipelineEvent, StreamChunkReceived

logger = logging.getLogger(__name__)
router = APIRouter()


def _demote_graph_layers(session) -> None:
    """Set all graph nodes to 'cold' status on disk for a fresh conversation."""
    try:
        from pathlib import Path
        import json as json_mod
        acervo_dir = Path(session.settings.plugins.acervo.acervo_dir)
        if not acervo_dir.is_absolute():
            acervo_dir = Path.cwd() / acervo_dir
        nodes_path = acervo_dir / "data" / "graph" / "nodes.json"
        if not nodes_path.exists():
            return
        with open(nodes_path, "r", encoding="utf-8") as f:
            nodes = json_mod.load(f)
        changed = False
        for n in nodes:
            if n.get("status", "") in ("hot", "warm"):
                n["status"] = "cold"
                changed = True
        if changed:
            with open(nodes_path, "w", encoding="utf-8") as f:
                json_mod.dump(nodes, f, ensure_ascii=False, indent=2)
    except Exception:
        pass  # Non-critical


@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket) -> None:
    await websocket.accept()

    registry = websocket.app.state.registry
    session = registry.active
    throttle = StreamThrottle(min_interval_ms=30.0)

    async def _event_handler(event: PipelineEvent) -> None:
        """Forward pipeline events to the WebSocket client."""
        if isinstance(event, StreamChunkReceived) and not throttle.should_send(event):
            return
        try:
            data = serialize_event(event)
            await websocket.send_json(data)
        except (WebSocketDisconnect, RuntimeError):
            pass

    # Clear any previous WebSocket event handlers (e.g. from StrictMode double-mount)
    existing = session.bus._handlers.get(PipelineEvent, [])
    session.bus._handlers[PipelineEvent] = [
        h for h in existing if not getattr(h, "_is_ws_handler", False)
    ]
    _event_handler._is_ws_handler = True  # type: ignore[attr-defined]
    session.bus.subscribe(PipelineEvent, _event_handler)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error", "step": "parse", "error": "Invalid JSON",
                })
                continue

            msg_type = msg.get("type", "")

            if msg_type == "message":
                text = msg.get("text", "").strip()
                if not text:
                    continue
                if session.is_running:
                    await websocket.send_json({
                        "type": "error",
                        "step": "dispatch",
                        "error": "Turn already in progress",
                    })
                    continue

                throttle.reset()

                async def _run_turn(user_text: str) -> None:
                    try:
                        await session.run_turn(user_text)
                    except Exception as exc:
                        logger.exception("Pipeline error")
                        try:
                            await websocket.send_json({
                                "type": "error",
                                "step": "pipeline",
                                "error": str(exc),
                            })
                        except (WebSocketDisconnect, RuntimeError):
                            pass
                    finally:
                        try:
                            await websocket.send_json({"type": "turn_complete"})
                        except (WebSocketDisconnect, RuntimeError):
                            pass

                asyncio.create_task(_run_turn(text))

            elif msg_type == "reset":
                await session.reset()
                # Also reset graph layers and proxy (match REST /session/reset)
                from api.rest_routes import _reset_acervo_proxy
                _demote_graph_layers(session)
                await _reset_acervo_proxy(session)
                await websocket.send_json({"type": "reset_complete"})

            elif msg_type == "get_stats":
                await websocket.send_json(session.get_stats())
                # Send conversation history so the UI can restore messages
                history_msgs = [
                    {"role": m.role, "content": m.content}
                    for m in session.history
                    if m.role != "system"
                ]
                if history_msgs:
                    await websocket.send_json({
                        "type": "history_sync",
                        "messages": history_msgs,
                    })

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    finally:
        if session.bus:
            handlers = session.bus._handlers.get(PipelineEvent, [])
            if _event_handler in handlers:
                handlers.remove(_event_handler)
