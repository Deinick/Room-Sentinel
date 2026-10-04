from pydantic import BaseModel, Field


class DeviceReadingIn(BaseModel):
    """
    One WebSocket text frame from the ESP32, e.g.

        {"serial": "SN-1", "seq": 42, "uptime_ms": 61000,
         "temps": {"Centre": 21.44, "Window": 19.81, "Heater": 34.06, "Door": -127, "Far wall": 21.12}}

    temps holds what the STM32 measured, unchanged; validation marks bad values later.
    """
    serial: str = Field(min_length=1)
    seq: int = Field(ge=0)
    uptime_ms: int = Field(ge=0)
    temps: dict[str, float | None]


class Ack(BaseModel):
    """Sent back for every frame so the device knows what arrived."""
    seq: int | None = None
    ok: bool
    error: str | None = None
