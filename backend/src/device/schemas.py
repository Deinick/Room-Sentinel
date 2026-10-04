from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class _OrmBase(BaseModel):
    """Shared config: allows building schemas directly from ORM model instances."""
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Device - request bodies
# ---------------------------------------------------------------------------

class DeviceCreate(_OrmBase):
    """Factory provisioning payload (staff only). The secret is flashed into the device and never returned."""
    device_id: str = Field(min_length=1)
    secret: str = Field(min_length=16)


class DeviceCredentials(_OrmBase):
    """How a device proves who it is before it has a device token."""
    device_id: str = Field(min_length=1)
    secret: str = Field(min_length=1)


# ---------------------------------------------------------------------------
# Device - response bodies
# ---------------------------------------------------------------------------

class ReadDevice(_OrmBase):
    device_id: str
    user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Pairing
# ---------------------------------------------------------------------------

class PairingStarted(_OrmBase):
    """Returned to the device; pairing_url is shown as a QR code."""
    code: str
    pairing_url: str
    expires_at: datetime


class PairingInfo(_OrmBase):
    """Shown to the signed-in user so they can check the serial number before confirming."""
    device_id: str
    expires_at: datetime


class DeviceToken(_OrmBase):
    """Delivered to the device exactly once; the device stores it in NVS."""
    device_token: str
