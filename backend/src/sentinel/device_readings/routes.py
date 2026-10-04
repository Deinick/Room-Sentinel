"""
The persistent connection a paired ESP32 streams readings over.

    GET /devices/stream  (WebSocket)
    Authorization: Bearer <device token from pairing>

Each text frame is a DeviceReadingIn; each gets an Ack back.
The server also pushes SettingsPush frames (see src.device.live).
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from src.database import async_session_maker
from src.device.live import SettingsPush, connections
from src.device.services import DeviceService
from src.sentinel.profiles import PROFILES
from .schemas import Ack, DeviceReadingIn
from .services import DeviceReadingService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sentinel"])


async def _authenticate(websocket: WebSocket) -> tuple[str, float | None] | None:
    scheme, _, token = websocket.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    async with async_session_maker() as session:
        device = await DeviceService(session).get_by_token(token)
    if device is None:
        return None
    if device.min_temperature is not None or device.max_temperature is not None:
        # The analyzer keeps limits in memory; restore the owner's after a server restart.
        PROFILES.set_limits(device.device_id, device.min_temperature, device.max_temperature)
    return device.device_id, device.target_temperature


@router.websocket("/devices/stream")
async def device_stream(websocket: WebSocket) -> None:
    auth = await _authenticate(websocket)
    if auth is None:
        # Closing before accept rejects the handshake with HTTP 403.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    device_id, target_temperature = auth
    await websocket.accept()
    logger.info("Device %r connected.", device_id)
    pipeline = websocket.app.state.pipeline
    conn = connections.register(device_id, websocket)
    try:
        # Catch up on settings changed while the device was offline.
        await conn.send(SettingsPush(target_temperature=target_temperature).model_dump_json())
        while True:
            raw = await websocket.receive_text()
            try:
                frame = DeviceReadingIn.model_validate_json(raw)
            except ValidationError as exc:
                await conn.send(Ack(ok=False, error=f"invalid frame: {exc.errors()[0]['msg']}").model_dump_json())
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
            await conn.send(Ack(seq=frame.seq, ok=True).model_dump_json())
    except WebSocketDisconnect:
        logger.info("Device %r disconnected.", device_id)
    finally:
        connections.unregister(device_id, conn)
