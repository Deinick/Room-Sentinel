"""
Open device WebSockets, so settings changed on the website reach the controller right away.

Server -> device frames on /devices/stream are either an Ack (has "ok") or a
SettingsPush (has "type": "settings"). A device that was offline gets its current
settings as the first frame after it connects.

In-process registry: valid while the API runs as a single worker.
"""

import asyncio
import logging
from typing import Literal, Optional

from fastapi import WebSocket, status
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SettingsPush(BaseModel):
    type: Literal["settings"] = "settings"
    target_temperature: Optional[float]


class _Connection:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        # Acks from the stream loop and pushes from requests share the socket.
        self.lock = asyncio.Lock()

    async def send(self, text: str) -> None:
        async with self.lock:
            await self.websocket.send_text(text)


class DeviceConnections:
    def __init__(self) -> None:
        self._open: dict[str, _Connection] = {}

    def register(self, device_id: str, websocket: WebSocket) -> _Connection:
        """A reconnect replaces the older connection; that one is closed by its own loop failing."""
        conn = _Connection(websocket)
        self._open[device_id] = conn
        return conn

    def unregister(self, device_id: str, conn: _Connection) -> None:
        if self._open.get(device_id) is conn:
            del self._open[device_id]

    async def push_settings(self, device_id: str, target_temperature: Optional[float]) -> bool:
        """Send settings if the device is online. False means it will get them on its next connect."""
        conn = self._open.get(device_id)
        if conn is None:
            return False
        try:
            await conn.send(SettingsPush(target_temperature=target_temperature).model_dump_json())
        except Exception:
            logger.warning("Push to device %r failed; it will sync on reconnect.", device_id, exc_info=True)
            return False
        logger.info("Pushed target_temperature=%s to device %r.", target_temperature, device_id)
        return True

    async def disconnect(self, device_id: str) -> None:
        """Close the device's socket, e.g. after its token was revoked. Its stream loop unregisters it."""
        conn = self._open.get(device_id)
        if conn is None:
            return
        try:
            async with conn.lock:
                await conn.websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="device token revoked")
        except Exception:
            logger.warning("Closing socket of device %r failed.", device_id, exc_info=True)
            return
        logger.info("Closed socket of device %r.", device_id)


connections = DeviceConnections()
