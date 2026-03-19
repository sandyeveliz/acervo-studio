"""WebSocket endpoint — bridges pipeline events to the frontend."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.serializers import StreamThrottle, serialize_event
from core.events import PipelineEvent, StreamChunkReceived, StreamCompleted

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket) -> None:
    await websocket.accept()

    # Get session from app state
    session = websocket.app.state.session
    throttle = StreamThrottle(min_interval_ms=30.0)

    async def _event_handler(event: PipelineEvent) -> None:
        """Forward pipeline events to the WebSocket client."""
        # Throttle stream chunks, but always send StreamCompleted
        if isinstance(event, StreamChunkReceived) and not throttle.should_send(event):
            return
        try:
            data = serialize_event(event)
            await websocket.send_json(data)
        except (WebSocketDisconnect, RuntimeError):
            pass

    # Subscribe catch-all handler on PipelineEvent base
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

                # Run pipeline turn in a task so we can keep receiving
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
                await websocket.send_json({"type": "reset_complete"})

            elif msg_type == "get_stats":
                await websocket.send_json(session.get_stats())

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    finally:
        # Remove the handler from the bus
        handlers = session.bus._handlers.get(PipelineEvent, [])
        if _event_handler in handlers:
            handlers.remove(_event_handler)
