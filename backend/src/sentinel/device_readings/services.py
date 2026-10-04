"""Turns a device frame into stored data: the envelope and its temperatures, in one transaction."""

import logging
from datetime import datetime, timezone

from sqlalchemy import insert

from src.sentinel.ingest.validate import to_reading
from src.sentinel.models import Reading
from src.services import BaseService
from .models import DeviceReading, readings_table
from .schemas import DeviceReadingIn

logger = logging.getLogger(__name__)


class DeviceReadingService(BaseService):

    async def ingest(self, *, device_id: str, frame: DeviceReadingIn) -> Reading:
        """
        device_id comes from the authenticated token, never from the frame.
        Adds both rows to the session; the caller commits, then hands the reading to
        the pipeline with saved=True so it is not written twice.
        """
        now = datetime.now(timezone.utc)
        reading = to_reading({"id": device_id, "temps": frame.temps}, now)
        self.session.add(DeviceReading(time=now, device_id=device_id, seq=frame.seq, uptime_ms=frame.uptime_ms))
        rows = [{"time": now, "device_id": device_id, "sensor": name, "temp_c": v.temp_c, "status": v.status}
                for name, v in reading.sensors.items()]
        if rows:
            await self.session.execute(insert(readings_table), rows)
        await self.session.flush()
        return reading
