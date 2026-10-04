"""
The persistent connection a paired ESP32 streams readings over.

    GET /devices/stream  (WebSocket)
    Authorization: Bearer <device token from pairing>

Each text frame is a DeviceReadingIn; each gets an Ack back.
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from src.database import async_session_maker
from src.device.services import DeviceService
from .schemas import Ack, DeviceReadingIn
from .services import DeviceReadingService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sentinel"])


async def _authenticate(websocket: WebSocket) -> str | None:
    scheme, _, token = websocket.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    async with async_session_maker() as session:
        device = await DeviceService(session).get_by_token(token)
    return device.device_id if device else None


@router.websocket("/devices/stream")
async def device_stream(websocket: WebSocket) -> None:
    device_id = await _authenticate(websocket)
    if device_id is None:
        # Closing before accept rejects the handshake with HTTP 403.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    logger.info("Device %r connected.", device_id)
    pipeline = websocket.app.state.pipeline
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                frame = DeviceReadingIn.model_validate_json(raw)
            except ValidationError as exc:
                await websocket.send_text(Ack(ok=False, error=f"invalid frame: {exc.errors()[0]['msg']}").model_dump_json())
                continue
            if frame.serial != device_id:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="serial does not match token")
                logger.warning("Device %r sent frames as %r; disconnected.", device_id, frame.serial)
                return

            # Short session per frame: the connection lives for days.
            async with async_session_maker() as session:
                reading = await DeviceReadingService(session).ingest(device_id=device_id, frame=frame)
                await session.commit()
            # Stored already; the pipeline only analyzes. It is synchronous and lock-protected.
            await run_in_threadpool(pipeline.process, reading, saved=True)
            await websocket.send_text(Ack(seq=frame.seq, ok=True).model_dump_json())
    except WebSocketDisconnect:
        logger.info("Device %r disconnected.", device_id)
